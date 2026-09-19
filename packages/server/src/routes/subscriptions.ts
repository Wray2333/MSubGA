import {
  GenerateError,
  SUB_FORMATS,
  nodeSelectionSchema,
  subscriptionOptionsSchema,
} from '@msubga/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema.js';
import { generateSubscriptionToken } from '../lib/auth.js';
import { requireAuth } from '../lib/middleware.js';
import { resolveSubscriptionNodes } from '../lib/nodeService.js';
import { renderSubscription } from '../lib/subscriptionService.js';
import { SETTING_KEYS, getSetting } from '../lib/settings.js';
import { validateConfigWithCore } from '../mihomo/validateConfig.js';

export const subscriptionRoutes = new Hono();
subscriptionRoutes.use('*', requireAuth);

const subscriptionSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  format: z.enum(SUB_FORMATS).default('auto'),
  profileId: z.string().nullable().optional(),
  selection: nodeSelectionSchema,
  options: subscriptionOptionsSchema,
  enabled: z.boolean().default(true),
  expiresAt: z.number().int().nullable().optional(),
});

const firstIssue = (error: z.ZodError): string => error.issues[0]?.message ?? '参数不合法';

function subscriptionUrl(token: string, fallbackOrigin: string): string {
  const base = (getSetting(SETTING_KEYS.siteBaseUrl) || fallbackOrigin).replace(/\/+$/, '');
  return `${base}/sub/${token}`;
}

/** 列表里顺带算出每条订阅当前实际包含多少节点 */
subscriptionRoutes.get('/', (c) => {
  const origin = new URL(c.req.url).origin;
  const rows = db.select().from(subscriptions).all();
  return c.json({
    subscriptions: rows.map((row) => ({
      ...row,
      url: subscriptionUrl(row.token, origin),
      nodeCount: resolveSubscriptionNodes(row.selection).length,
    })),
  });
});

subscriptionRoutes.post('/', async (c) => {
  const parsed = subscriptionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);
  if (parsed.data.format !== 'base64' && !parsed.data.profileId) {
    return c.json({ error: '输出 Clash 配置需要选一个规则模板' }, 400);
  }

  const now = Date.now();
  const row = {
    id: nanoid(),
    token: generateSubscriptionToken(),
    name: parsed.data.name,
    format: parsed.data.format,
    profileId: parsed.data.profileId ?? null,
    selection: parsed.data.selection,
    options: parsed.data.options,
    enabled: parsed.data.enabled,
    expiresAt: parsed.data.expiresAt ?? null,
    hitCount: 0,
    lastAccessAt: null,
    lastAccessUa: null,
    lastAccessIp: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(subscriptions).values(row).run();
  return c.json({ subscription: { ...row, url: subscriptionUrl(row.token, new URL(c.req.url).origin) } }, 201);
});

subscriptionRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const current = db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
  if (!current) return c.json({ error: '订阅不存在' }, 404);

  const parsed = subscriptionSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  const next = { ...current, ...parsed.data };
  if (next.format !== 'base64' && !next.profileId) {
    return c.json({ error: '输出 Clash 配置需要选一个规则模板' }, 400);
  }

  db.update(subscriptions)
    .set({
      name: next.name,
      format: next.format,
      profileId: next.profileId ?? null,
      selection: next.selection,
      options: next.options,
      enabled: next.enabled,
      expiresAt: next.expiresAt ?? null,
      updatedAt: Date.now(),
    })
    .where(eq(subscriptions.id, id))
    .run();
  return c.json({ ok: true });
});

subscriptionRoutes.delete('/:id', (c) => {
  db.delete(subscriptions).where(eq(subscriptions.id, c.req.param('id'))).run();
  return c.json({ ok: true });
});

/** 链接泄露时换一个 token，旧链接立刻失效 */
subscriptionRoutes.post('/:id/rotate-token', (c) => {
  const id = c.req.param('id');
  const token = generateSubscriptionToken();
  const result = db
    .update(subscriptions)
    .set({ token, updatedAt: Date.now() })
    .where(eq(subscriptions.id, id))
    .run();
  if (result.changes === 0) return c.json({ error: '订阅不存在' }, 404);
  return c.json({ token, url: subscriptionUrl(token, new URL(c.req.url).origin) });
});

subscriptionRoutes.get('/:id/preview', (c) => {
  const row = db.select().from(subscriptions).where(eq(subscriptions.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: '订阅不存在' }, 404);

  const requested = c.req.query('target');
  const target = requested === 'base64' ? 'base64' : row.format === 'base64' ? 'base64' : 'clash';

  try {
    const rendered = renderSubscription(row, target, { requestOrigin: new URL(c.req.url).origin });
    return c.json({
      target: rendered.target,
      proxyCount: rendered.proxyCount,
      body: rendered.body,
      plain: rendered.plain,
    });
  } catch (error) {
    if (error instanceof GenerateError) return c.json({ error: error.message }, 422);
    throw error;
  }
});

/** 用真正的内核校验一遍生成结果，这是「客户端一定加载得进去」的最后保证 */
subscriptionRoutes.post('/:id/verify', async (c) => {
  const row = db.select().from(subscriptions).where(eq(subscriptions.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: '订阅不存在' }, 404);

  try {
    const rendered = renderSubscription(row, 'clash', { requestOrigin: new URL(c.req.url).origin });
    return c.json(await validateConfigWithCore(rendered.body));
  } catch (error) {
    if (error instanceof GenerateError) return c.json({ ok: false, output: error.message });
    throw error;
  }
});
