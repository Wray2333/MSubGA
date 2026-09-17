import { GenerateError } from '@msubga/core';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { subscriptions } from '../db/schema.js';
import { allow } from '../lib/ratelimit.js';
import { contentDisposition, pickTarget, renderSubscription } from '../lib/subscriptionService.js';

export const publicSubRoutes = new Hono();

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown';
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

  const row = db.select().from(subscriptions).where(eq(subscriptions.token, token)).get();
  if (!row || !row.enabled || (row.expiresAt !== null && row.expiresAt < Date.now())) {
    return c.text('Not Found', 404);
  }

  const userAgent = c.req.header('user-agent') ?? '';
  const target = pickTarget(row, userAgent, c.req.query('target'));

  let rendered;
  try {
    rendered = renderSubscription(row, target);
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
