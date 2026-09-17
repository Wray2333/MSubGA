import { PLAINTEXT_TYPES, fingerprintConfig, parseBulk, proxyConfigSchema } from '@msubga/core';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { nodeTags, nodes } from '../db/schema.js';
import { requireAuth } from '../lib/middleware.js';
import { insertCandidates, listNodes } from '../lib/nodeService.js';

export const nodeRoutes = new Hono();
nodeRoutes.use('*', requireAuth);

async function body<T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  schema: T,
): Promise<z.SafeParseReturnType<unknown, z.infer<T>>> {
  return schema.safeParse(await c.req.json().catch(() => ({})));
}

const firstIssue = (error: z.ZodError): string => error.issues[0]?.message ?? '参数不合法';

nodeRoutes.get('/', (c) => c.json({ nodes: listNodes() }));

/* --------------------------------- 导入 --------------------------------- */

const importSchema = z.object({
  text: z.string().min(1, '内容不能为空'),
  defaultPlainType: z.enum(PLAINTEXT_TYPES).default('socks5'),
  namePrefix: z.string().optional(),
});

/** 只解析不入库，把结果连同「库里是否已存在」一起返回给预览界面 */
nodeRoutes.post('/import/preview', async (c) => {
  const parsed = await body(c, importSchema);
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  const { text, defaultPlainType, namePrefix } = parsed.data;
  const result = parseBulk(text, namePrefix ? { defaultPlainType, namePrefix } : { defaultPlainType });

  const fingerprints = result.candidates.map((candidate) => candidate.fingerprint);
  const existing = new Set(
    fingerprints.length
      ? db
          .select({ fingerprint: nodes.fingerprint })
          .from(nodes)
          .where(inArray(nodes.fingerprint, fingerprints))
          .all()
          .map((row) => row.fingerprint)
      : [],
  );

  return c.json({
    decodedBase64: result.decodedBase64,
    duplicatesInBatch: result.duplicatesInBatch,
    failures: result.failures,
    candidates: result.candidates.map((candidate) => ({
      line: candidate.line,
      name: candidate.name,
      type: candidate.config.type,
      server: candidate.config.server,
      port: candidate.config.port,
      existing: existing.has(candidate.fingerprint),
    })),
  });
});

const commitSchema = importSchema.extend({
  /** 用户在预览里勾掉某几条时传剩下的行号；不传就全要 */
  selectedLines: z.array(z.number().int()).optional(),
  /** 行号 -> 改过的名字 */
  names: z.record(z.string(), z.string()).optional(),
  tagIds: z.array(z.string()).default([]),
});

/**
 * 提交入库。这里重新解析一遍原文，而不是直接收前端传回来的配置对象，
 * 免得有人拿构造过的 payload 往库里塞不合法的节点。
 */
nodeRoutes.post('/import', async (c) => {
  const parsed = await body(c, commitSchema);
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  const { text, defaultPlainType, namePrefix, selectedLines, names, tagIds } = parsed.data;
  const result = parseBulk(text, namePrefix ? { defaultPlainType, namePrefix } : { defaultPlainType });

  const wanted = selectedLines ? new Set(selectedLines) : null;
  const candidates = result.candidates
    .filter((candidate) => !wanted || wanted.has(candidate.line))
    .map((candidate) => {
      const override = names?.[String(candidate.line)];
      return override ? { ...candidate, name: override } : candidate;
    });

  return c.json({ ...insertCandidates(candidates, tagIds), failures: result.failures });
});

/* ------------------------------- 单个节点 ------------------------------- */

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  remark: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  config: proxyConfigSchema.optional(),
});

nodeRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const parsed = await body(c, patchSchema);
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  const current = db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!current) return c.json({ error: '节点不存在' }, 404);

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (parsed.data.name !== undefined) patch['name'] = parsed.data.name;
  if (parsed.data.remark !== undefined) patch['remark'] = parsed.data.remark;
  if (parsed.data.enabled !== undefined) patch['enabled'] = parsed.data.enabled;

  if (parsed.data.config) {
    const config = parsed.data.config;
    const fingerprint = fingerprintConfig(config);
    // 改完可能和另一个节点撞上，撞了就不让改，免得库里留下两个一模一样的
    const clash = db.select({ id: nodes.id }).from(nodes).where(eq(nodes.fingerprint, fingerprint)).get();
    if (clash && clash.id !== id) return c.json({ error: '改完之后和已有的另一个节点完全相同' }, 409);

    Object.assign(patch, {
      config,
      fingerprint,
      type: config.type,
      server: config.server,
      port: config.port,
      // 配置变了，之前的测速结果不再算数
      lastDelayMs: null,
      lastStatus: null,
      lastTestedAt: null,
    });
  }

  db.update(nodes).set(patch).where(eq(nodes.id, id)).run();
  return c.json({ ok: true });
});

nodeRoutes.delete('/:id', (c) => {
  db.delete(nodes).where(eq(nodes.id, c.req.param('id'))).run();
  return c.json({ ok: true });
});

/* -------------------------------- 批量操作 ------------------------------- */

nodeRoutes.post('/bulk/delete', async (c) => {
  const parsed = await body(c, z.object({ ids: z.array(z.string()).min(1) }));
  if (!parsed.success) return c.json({ error: '参数不合法' }, 400);
  db.delete(nodes).where(inArray(nodes.id, parsed.data.ids)).run();
  return c.json({ ok: true, deleted: parsed.data.ids.length });
});

nodeRoutes.post('/bulk/enabled', async (c) => {
  const parsed = await body(c, z.object({ ids: z.array(z.string()).min(1), enabled: z.boolean() }));
  if (!parsed.success) return c.json({ error: '参数不合法' }, 400);
  db.update(nodes)
    .set({ enabled: parsed.data.enabled, updatedAt: Date.now() })
    .where(inArray(nodes.id, parsed.data.ids))
    .run();
  return c.json({ ok: true });
});

nodeRoutes.post('/bulk/tags', async (c) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1),
    add: z.array(z.string()).default([]),
    remove: z.array(z.string()).default([]),
  });
  const parsed = await body(c, schema);
  if (!parsed.success) return c.json({ error: '参数不合法' }, 400);

  const { ids, add, remove } = parsed.data;
  db.transaction((tx) => {
    for (const nodeId of ids) {
      for (const tagId of add) {
        tx.insert(nodeTags).values({ nodeId, tagId }).onConflictDoNothing().run();
      }
    }
    if (remove.length) {
      tx.delete(nodeTags)
        .where(and(inArray(nodeTags.nodeId, ids), inArray(nodeTags.tagId, remove)))
        .run();
    }
  });
  return c.json({ ok: true });
});

nodeRoutes.post('/bulk/rename', async (c) => {
  const schema = z.object({
    ids: z.array(z.string()).min(1),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    find: z.string().optional(),
    replace: z.string().optional(),
  });
  const parsed = await body(c, schema);
  if (!parsed.success) return c.json({ error: '参数不合法' }, 400);

  const { ids, prefix, suffix, find, replace } = parsed.data;
  const rows = db.select().from(nodes).where(inArray(nodes.id, ids)).all();
  const now = Date.now();

  db.transaction((tx) => {
    for (const row of rows) {
      let name = row.name;
      if (find) name = name.split(find).join(replace ?? '');
      if (prefix) name = `${prefix}${name}`;
      if (suffix) name = `${name}${suffix}`;
      name = name.trim() || row.name;
      tx.update(nodes).set({ name, updatedAt: now }).where(eq(nodes.id, row.id)).run();
    }
  });
  return c.json({ ok: true, renamed: rows.length });
});
