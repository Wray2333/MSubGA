import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rulesetExtension } from '@msubga/core';
import { eq } from 'drizzle-orm';
import { RULESET_CACHE_DIR } from '../config.js';
import { db } from '../db/index.js';
import { rulesets, type RulesetRow } from '../db/schema.js';

/**
 * 规则集的服务端缓存。
 *
 * 要解决的问题：内置规则集都挂在 raw.githubusercontent.com 上，客户端得先连上代理
 * 才够得着，可规则正是用来决定怎么代理的——手机上表现就是订阅一直加载不出规则。
 * 服务端把正文抓下来存在本地，再由 /sub/:token/rules/... 发出去，客户端只要能
 * 访问订阅链接就能拿到规则。
 *
 * 正文落磁盘不进库：reject.txt 一份就 5.4MB，塞进 SQLite 会让每次
 * `select * from rulesets` 都把几 MB 读进内存。库里只留抓取状态。
 */

/** 超过这个时长就算过期，和生成配置里 provider 的 interval: 86400 对齐 */
const TTL_MS = 24 * 60 * 60 * 1000;
/** 抓取超时。5MB 的 reject.txt 从境外拉回来可能确实慢 */
const FETCH_TIMEOUT_MS = 90_000;
/** 正文上限，挡住填错 URL 指到个大文件上把磁盘撑爆 */
const MAX_BYTES = 64 * 1024 * 1024;

export interface CachedRuleset {
  body: Buffer;
  etag: string;
  cachedAt: number;
  contentType: string;
}

export interface RefreshOutcome {
  id: string;
  name: string;
  ok: boolean;
  /** 上游回 304，本地那份还是最新的 */
  notModified?: boolean;
  size?: number;
  error?: string;
}

mkdirSync(RULESET_CACHE_DIR, { recursive: true });

/** 文件名用 id 而不是名字，避开非 ASCII 文件名在各平台上的差异 */
export function cacheFileName(row: Pick<RulesetRow, 'id' | 'format'>): string {
  return `${row.id.replace(/[^\w.-]+/g, '_')}.${rulesetExtension(row.format)}`;
}

function cachePath(row: Pick<RulesetRow, 'id' | 'format'>): string {
  return join(RULESET_CACHE_DIR, cacheFileName(row));
}

export function contentTypeFor(row: Pick<RulesetRow, 'format'>): string {
  if (row.format === 'mrs') return 'application/octet-stream';
  if (row.format === 'yaml') return 'text/yaml; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function isFresh(row: RulesetRow): boolean {
  return row.cachedAt !== null && Date.now() - row.cachedAt < TTL_MS;
}

/** 响应用的 ETag。抓取时间 + 体积足够表达「内容有没有换过」 */
function makeEtag(cachedAt: number, size: number): string {
  return `"${cachedAt.toString(36)}-${size.toString(36)}"`;
}

/* -------------------------------------------------------------------------- */
/*                                   抓取                                      */
/* -------------------------------------------------------------------------- */

/**
 * 同一个规则集同时被多个请求触发时只抓一次。
 * 一份 Clash 配置里十几条 rule-provider 是客户端并发拉的，没这个去重
 * 会同时开十几个到 GitHub 的连接。
 */
const inflight = new Map<string, Promise<RefreshOutcome>>();

async function readBounded(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error(`正文 ${(declared / 1048576).toFixed(1)}MB，超过 ${MAX_BYTES / 1048576}MB 上限`);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    // content-length 可能缺失或撒谎，边读边卡
    if (total > MAX_BYTES) throw new Error(`正文超过 ${MAX_BYTES / 1048576}MB 上限`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

async function doRefresh(row: RulesetRow, force: boolean): Promise<RefreshOutcome> {
  const base = { id: row.id, name: row.name };
  if (row.kind !== 'remote' || !row.url) {
    return { ...base, ok: false, error: '不是远程规则集，没有可抓取的地址' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      // 有些 CDN 对没有 UA 的请求直接 403
      'User-Agent': 'MSubGA/0.1 (+https://github.com/Wray2333/MSubGA)',
      Accept: '*/*',
    };
    // 只在本地确实有那份文件时才带 If-None-Match，否则 304 回来手上是空的
    if (!force && row.cacheEtag && row.cachedAt !== null) {
      headers['If-None-Match'] = row.cacheEtag;
    }

    const response = await fetch(row.url, { headers, signal: controller.signal, redirect: 'follow' });

    if (response.status === 304) {
      // 内容没变，只把「查过了」记下来，省得下次又白跑一趟
      const now = Date.now();
      db.update(rulesets).set({ cachedAt: now, cacheError: null }).where(eq(rulesets.id, row.id)).run();
      return { ...base, ok: true, notModified: true, size: row.cacheSize ?? undefined };
    }
    if (!response.ok) {
      throw new Error(`上游返回 ${response.status} ${response.statusText}`.trim());
    }

    const body = await readBounded(response);
    if (body.byteLength === 0) {
      throw new Error('上游返回空内容');
    }

    // 先写临时文件再 rename，避免客户端正好读到写了一半的文件
    const target = cachePath(row);
    const temp = `${target}.${createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 8)}.tmp`;
    await writeFile(temp, body);
    await rename(temp, target);

    const now = Date.now();
    db.update(rulesets)
      .set({
        cachedAt: now,
        cacheSize: body.byteLength,
        cacheEtag: response.headers.get('etag'),
        cacheError: null,
      })
      .where(eq(rulesets.id, row.id))
      .run();

    return { ...base, ok: true, size: body.byteLength };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError' || error.name === 'TimeoutError'
          ? `抓取超时（${FETCH_TIMEOUT_MS / 1000}s）`
          : error.message
        : String(error);
    // 失败不清掉旧缓存：有一份过期的规则也比没有强
    db.update(rulesets).set({ cacheError: message }).where(eq(rulesets.id, row.id)).run();
    return { ...base, ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export function refreshRuleset(row: RulesetRow, force = false): Promise<RefreshOutcome> {
  const running = inflight.get(row.id);
  if (running) return running;

  const task = doRefresh(row, force).finally(() => inflight.delete(row.id));
  inflight.set(row.id, task);
  return task;
}

/* -------------------------------------------------------------------------- */
/*                                   读取                                      */
/* -------------------------------------------------------------------------- */

async function readFromDisk(row: RulesetRow): Promise<Buffer | null> {
  try {
    return await readFile(cachePath(row));
  } catch {
    return null;
  }
}

/**
 * 拿到可以直接发给客户端的正文。
 *
 * - 本地没有 → 当场抓，请求会等着（只有第一次订阅会碰到）
 * - 本地有但过期 → 立刻返回旧的，后台顺手续期，不让客户端等
 */
export async function loadRulesetForClient(id: string): Promise<CachedRuleset | null> {
  const row = db.select().from(rulesets).where(eq(rulesets.id, id)).get();
  if (!row || row.kind !== 'remote') return null;

  let body = row.cachedAt === null ? null : await readFromDisk(row);

  if (!body) {
    const outcome = await refreshRuleset(row, true);
    if (!outcome.ok) return null;
    const refreshed = db.select().from(rulesets).where(eq(rulesets.id, id)).get();
    body = refreshed ? await readFromDisk(refreshed) : null;
    if (!body) return null;
    return {
      body,
      etag: makeEtag(refreshed?.cachedAt ?? Date.now(), body.byteLength),
      cachedAt: refreshed?.cachedAt ?? Date.now(),
      contentType: contentTypeFor(row),
    };
  }

  if (!isFresh(row)) {
    // 后台续期，失败也不影响这次响应
    void refreshRuleset(row).catch(() => {});
  }

  const cachedAt = row.cachedAt ?? Date.now();
  return {
    body,
    etag: makeEtag(cachedAt, body.byteLength),
    cachedAt,
    contentType: contentTypeFor(row),
  };
}

/* -------------------------------------------------------------------------- */
/*                                 批量维护                                     */
/* -------------------------------------------------------------------------- */

export function listRemoteRulesets(): RulesetRow[] {
  return db
    .select()
    .from(rulesets)
    .all()
    .filter((row) => row.kind === 'remote' && !!row.url);
}

/** 顺序抓，别把出口带宽和 GitHub 的限流一次打满 */
export async function refreshAllRulesets(force = false): Promise<RefreshOutcome[]> {
  const out: RefreshOutcome[] = [];
  for (const row of listRemoteRulesets()) {
    out.push(await refreshRuleset(row, force));
  }
  return out;
}

/**
 * 启动后台预热：把还没缓存过、或者已经过期的规则集抓一遍。
 * 不阻塞启动，也不让失败影响服务——第一条订阅请求会再触发一次。
 */
export function warmRulesetCache(): void {
  setTimeout(() => {
    void (async () => {
      const pending = listRemoteRulesets().filter((row) => !isFresh(row));
      if (pending.length === 0) return;
      console.log(`[规则缓存] 开始预热 ${pending.length} 个规则集`);
      let failed = 0;
      for (const row of pending) {
        const outcome = await refreshRuleset(row);
        if (!outcome.ok) {
          failed += 1;
          console.warn(`[规则缓存] ${row.name} 抓取失败: ${outcome.error}`);
        }
      }
      console.log(`[规则缓存] 预热完成，${pending.length - failed} 成功 / ${failed} 失败`);
    })();
  }, 3_000).unref?.();
}

export async function dropCachedRuleset(row: Pick<RulesetRow, 'id' | 'format'>): Promise<void> {
  await rm(cachePath(row), { force: true });
}
