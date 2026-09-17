import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { tags } from '../db/schema.js';
import { requireAuth } from '../lib/middleware.js';

export const tagRoutes = new Hono();
tagRoutes.use('*', requireAuth);

const tagSchema = z.object({
  name: z.string().min(1, '标签名不能为空').max(32),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色要是 #RRGGBB').default('#64748b'),
});

tagRoutes.get('/', (c) => c.json({ tags: db.select().from(tags).all() }));

tagRoutes.post('/', async (c) => {
  const parsed = tagSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);

  const existing = db.select().from(tags).where(eq(tags.name, parsed.data.name)).get();
  if (existing) return c.json({ error: '同名标签已存在', tag: existing }, 409);

  const tag = { id: nanoid(), ...parsed.data, createdAt: Date.now() };
  db.insert(tags).values(tag).run();
  return c.json({ tag }, 201);
});

tagRoutes.patch('/:id', async (c) => {
  const parsed = tagSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  db.update(tags).set(parsed.data).where(eq(tags.id, c.req.param('id'))).run();
  return c.json({ ok: true });
});

tagRoutes.delete('/:id', (c) => {
  // node_tags 上有 on delete cascade，关联关系会自动清掉
  db.delete(tags).where(eq(tags.id, c.req.param('id'))).run();
  return c.json({ ok: true });
});
