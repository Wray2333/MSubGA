import { RULESET_BEHAVIORS, RULESET_FORMATS } from '@msubga/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ruleProfiles, rulesets } from '../db/schema.js';
import { requireAuth } from '../lib/middleware.js';
import {
  dropCachedRuleset,
  listRemoteRulesets,
  refreshRuleset,
} from '../lib/rulesetCache.js';

export const rulesetRoutes = new Hono();
rulesetRoutes.use('*', requireAuth);

const rulesetSchema = z
  .object({
    name: z.string().min(1, '名称不能为空'),
    description: z.string().nullable().optional(),
    kind: z.enum(['remote', 'inline']),
    behavior: z.enum(RULESET_BEHAVIORS),
    format: z.enum(RULESET_FORMATS),
    url: z.string().url('URL 格式不对').nullable().optional(),
    content: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'remote' && !value.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: '远程规则集必须填 URL' });
    }
    if (value.kind === 'inline' && !value.content?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['content'], message: '内联规则集不能为空' });
    }
    if (value.kind === 'inline' && value.format === 'mrs') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['format'],
        message: 'mrs 是二进制格式，只能用于远程规则集',
      });
    }
  });

const firstIssue = (error: z.ZodError): string => error.issues[0]?.message ?? '参数不合法';

rulesetRoutes.get('/', (c) => c.json({ rulesets: db.select().from(rulesets).all() }));

rulesetRoutes.post('/', async (c) => {
  const parsed = rulesetSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  const now = Date.now();
  const row = {
    id: nanoid(),
    ...parsed.data,
    description: parsed.data.description ?? null,
    url: parsed.data.url ?? null,
    content: parsed.data.content ?? null,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(rulesets).values(row).run();
  return c.json({ ruleset: row }, 201);
});

rulesetRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const current = db.select().from(rulesets).where(eq(rulesets.id, id)).get();
  if (!current) return c.json({ error: '规则集不存在' }, 404);
  if (current.builtin) {
    return c.json({ error: '内置规则集不能改，复制一份再改' }, 403);
  }

  const parsed = rulesetSchema.safeParse({ ...current, ...(await c.req.json().catch(() => ({}))) });
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  // 换了地址或格式，之前缓存的正文就对不上了，连同状态一起清掉
  const invalidated = parsed.data.url !== current.url || parsed.data.format !== current.format;
  if (invalidated) await dropCachedRuleset(current);

  db.update(rulesets)
    .set({
      ...parsed.data,
      description: parsed.data.description ?? null,
      url: parsed.data.url ?? null,
      content: parsed.data.content ?? null,
      ...(invalidated
        ? { cachedAt: null, cacheSize: null, cacheEtag: null, cacheError: null }
        : {}),
      updatedAt: Date.now(),
    })
    .where(eq(rulesets.id, id))
    .run();
  return c.json({ ok: true });
});

rulesetRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const current = db.select().from(rulesets).where(eq(rulesets.id, id)).get();
  if (!current) return c.json({ error: '规则集不存在' }, 404);
  if (current.builtin) return c.json({ error: '内置规则集不能删' }, 403);

  // 被模板引用着就不让删，否则那些模板会直接生成不出配置
  const users = db
    .select({ id: ruleProfiles.id, name: ruleProfiles.name, definition: ruleProfiles.definition })
    .from(ruleProfiles)
    .all()
    .filter((profile) =>
      profile.definition.rules.some((rule) => rule.type === 'ruleset' && rule.rulesetId === id),
    );

  if (users.length > 0) {
    return c.json(
      { error: `还有 ${users.length} 个规则模板在用它`, profiles: users.map((p) => p.name) },
      409,
    );
  }

  db.delete(rulesets).where(eq(rulesets.id, id)).run();
  await dropCachedRuleset(current);
  return c.json({ ok: true });
});

/** 复制一份可编辑的副本，内置规则集只能这样改 */
rulesetRoutes.post('/:id/duplicate', (c) => {
  const source = db.select().from(rulesets).where(eq(rulesets.id, c.req.param('id'))).get();
  if (!source) return c.json({ error: '规则集不存在' }, 404);

  const now = Date.now();
  const copy = {
    ...source,
    id: nanoid(),
    name: `${source.name} 副本`,
    builtin: false,
    cachedAt: null,
    cacheSize: null,
    cacheEtag: null,
    cacheError: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(rulesets).values(copy).run();
  return c.json({ ruleset: copy }, 201);
});

/* -------------------------------------------------------------------------- */
/*                                 缓存维护                                     */
/* -------------------------------------------------------------------------- */

/** 手动把某个规则集重新抓一遍，忽略 TTL 和 ETag */
rulesetRoutes.post('/:id/refresh', async (c) => {
  const row = db.select().from(rulesets).where(eq(rulesets.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: '规则集不存在' }, 404);
  if (row.kind !== 'remote') return c.json({ error: '内联规则集不需要缓存' }, 400);

  const outcome = await refreshRuleset(row, true);
  return c.json(outcome, outcome.ok ? 200 : 502);
});

/** 全量刷新。顺序抓，十几 MB 一次拉完要一会儿 */
rulesetRoutes.post('/refresh', async (c) => {
  const rows = listRemoteRulesets();
  const results = [];
  for (const row of rows) {
    results.push(await refreshRuleset(row, true));
  }
  return c.json({
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    results,
  });
});
