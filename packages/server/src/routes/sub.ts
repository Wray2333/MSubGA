import { GenerateError } from '@msubga/core';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { subscriptions, type SubscriptionRow } from '../db/schema.js';
import { allow } from '../lib/ratelimit.js';
import { loadRulesetForClient } from '../lib/rulesetCache.js';
import { contentDisposition, pickTarget, renderSubscription } from '../lib/subscriptionService.js';

export const publicSubRoutes = new Hono();

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown';
}

/** token 有效才算数；不存在 / 已禁用 / 已过期一视同仁，免得这个接口被拿来枚举 */
function findLiveSubscription(token: string): SubscriptionRow | null {
  const row = db.select().from(subscriptions).where(eq(subscriptions.token, token)).get();
  if (!row || !row.enabled || (row.expiresAt !== null && row.expiresAt < Date.now())) return null;
  return row;
}

/**
 * 公开的订阅出口，不走登录，只认 URL 里的 token。
 * 不存在 / 已禁用 / 已过期一律返回 404，不区分——免得这个接口被拿来枚举有效 token。
 */
publicSubRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');

  if (!allow(`sub:${token}`)) {
    return c.text('请求太频繁', 429, { 'Retry-After': '60' });
  }

  const row = findLiveSubscription(token);
  if (!row) return c.text('Not Found', 404);

  const userAgent = c.req.header('user-agent') ?? '';
  const target = pickTarget(row, userAgent, c.req.query('target'));

  let rendered;
  try {
    rendered = renderSubscription(row, target, { requestOrigin: new URL(c.req.url).origin });
  } catch (error) {
    if (error instanceof GenerateError) {
      // 给客户端一个能看懂的错误，而不是一份加载不了的空配置
      return c.text(`订阅生成失败: ${error.message}`, 503);
    }
    throw error;
  }

  db.update(subscriptions)
    .set({
      hitCount: sql`${subscriptions.hitCount} + 1`,
      lastAccessAt: Date.now(),
      lastAccessUa: userAgent.slice(0, 200),
      lastAccessIp: clientIp(c),
    })
    .where(eq(subscriptions.id, row.id))
    .run();

  return c.body(rendered.body, 200, {
    'Content-Type': rendered.contentType,
    'Content-Disposition': contentDisposition(rendered.filename),
    'Profile-Update-Interval': String(row.options.updateIntervalHours),
    'Cache-Control': 'no-store',
  });
});

/**
 * 规则集出口：把服务端缓存好的规则正文发给客户端。
 *
 * 生成 Clash 配置时 rule-provider 的 url 就指到这里，客户端不用自己去
 * raw.githubusercontent.com 拉——那个地址本来就要先有代理才够得着。
 *
 * 用订阅 token 做入口而不是单独开一个公开接口，是为了不让它变成一个
 * 谁都能用的通用下载代理；同时 id 只能从库里查，请求里给不了任意 URL。
 */
publicSubRoutes.get('/:token/rules/:file', async (c) => {
  const token = c.req.param('token');

  // 一份配置里十几条 provider 是并发拉的，桶给得比订阅出口宽
  if (!allow(`rules:${token}`, 120, 120)) {
    return c.text('请求太频繁', 429, { 'Retry-After': '60' });
  }

  if (!findLiveSubscription(token)) return c.text('Not Found', 404);

  // 文件名是 <规则集 id>.<扩展名>，去掉扩展名拿 id
  const file = c.req.param('file');
  const id = file.replace(/\.[^.]*$/, '');
  if (!id) return c.text('Not Found', 404);

  const cached = await loadRulesetForClient(id);
  if (!cached) {
    // 规则集不存在，或者服务端自己也没抓到。内核看到非 200 会保留上一份规则
    return c.text('规则集暂时不可用', 503, { 'Cache-Control': 'no-store' });
  }

  if (c.req.header('if-none-match') === cached.etag) {
    return c.body(null, 304, { ETag: cached.etag });
  }

  return c.body(new Uint8Array(cached.body), 200, {
    'Content-Type': cached.contentType,
    'Content-Length': String(cached.body.byteLength),
    ETag: cached.etag,
    // 客户端自己也存一天，和 provider 的 interval 对齐
    'Cache-Control': 'public, max-age=86400',
    'Last-Modified': new Date(cached.cachedAt).toUTCString(),
  });
});
