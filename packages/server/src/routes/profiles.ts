import { ruleProfileDefinitionSchema, validateProfile } from '@msubga/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ruleProfiles, rulesets, subscriptions } from '../db/schema.js';
import { requireAuth } from '../lib/middleware.js';
import { listNodes, toEvaluable } from '../lib/nodeService.js';

export const profileRoutes = new Hono();
profileRoutes.use('*', requireAuth);

const profileSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  description: z.string().nullable().optional(),
  definition: ruleProfileDefinitionSchema,
});

const firstIssue = (error: z.ZodError): string => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.')}: ${issue.message}` : '参数不合法';
};

/** 校验时要知道库里有哪些规则集，以及当前节点集能不能把每个组填满 */
function validationContext() {
  return {
    rulesetIds: new Set(db.select({ id: rulesets.id }).from(rulesets).all().map((r) => r.id)),
    nodes: listNodes().map(toEvaluable),
  };
}

profileRoutes.get('/', (c) => c.json({ profiles: db.select().from(ruleProfiles).all() }));

profileRoutes.get('/:id', (c) => {
  const profile = db.select().from(ruleProfiles).where(eq(ruleProfiles.id, c.req.param('id'))).get();
  if (!profile) return c.json({ error: '模板不存在' }, 404);
  return c.json({ profile, issues: validateProfile(profile.definition, validationContext()) });
});

/** 只校验不保存，编辑器里实时调 */
profileRoutes.post('/validate', async (c) => {
  const parsed = ruleProfileDefinitionSchema.safeParse(
    (await c.req.json().catch(() => ({}))) as unknown,
  );
  if (!parsed.success) {
    return c.json({
      issues: parsed.error.issues.map((issue) => ({
        level: 'error' as const,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return c.json({ issues: validateProfile(parsed.data, validationContext()) });
});

profileRoutes.post('/', async (c) => {
  const parsed = profileSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  const now = Date.now();
  const row = {
    id: nanoid(),
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    definition: parsed.data.definition,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(ruleProfiles).values(row).run();
  return c.json({ profile: row, issues: validateProfile(row.definition, validationContext()) }, 201);
});

profileRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const current = db.select().from(ruleProfiles).where(eq(ruleProfiles.id, id)).get();
  if (!current) return c.json({ error: '模板不存在' }, 404);
  if (current.builtin) return c.json({ error: '内置模板不能改，复制一份再改' }, 403);

  const parsed = profileSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

  const definition = parsed.data.definition ?? current.definition;
  db.update(ruleProfiles)
    .set({
      name: parsed.data.name ?? current.name,
      description: parsed.data.description ?? current.description,
      definition,
      updatedAt: Date.now(),
    })
    .where(eq(ruleProfiles.id, id))
    .run();

  return c.json({ ok: true, issues: validateProfile(definition, validationContext()) });
});

profileRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  const current = db.select().from(ruleProfiles).where(eq(ruleProfiles.id, id)).get();
  if (!current) return c.json({ error: '模板不存在' }, 404);
  if (current.builtin) return c.json({ error: '内置模板不能删' }, 403);

  const users = db.select().from(subscriptions).where(eq(subscriptions.profileId, id)).all();
  if (users.length > 0) {
    return c.json(
      { error: `还有 ${users.length} 条订阅在用它`, subscriptions: users.map((s) => s.name) },
      409,
    );
  }

  db.delete(ruleProfiles).where(eq(ruleProfiles.id, id)).run();
  return c.json({ ok: true });
});

profileRoutes.post('/:id/duplicate', (c) => {
  const source = db.select().from(ruleProfiles).where(eq(ruleProfiles.id, c.req.param('id'))).get();
  if (!source) return c.json({ error: '模板不存在' }, 404);

  const now = Date.now();
  const copy = {
    ...source,
    id: nanoid(),
    name: `${source.name} 副本`,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(ruleProfiles).values(copy).run();
  return c.json({ profile: copy }, 201);
});
