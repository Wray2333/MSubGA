import { Hono } from 'hono';
import { z } from 'zod';
import { SETTING_KEYS, getSetting } from '../lib/settings.js';
import { isPasswordConfigured, setPassword, verifyPassword } from '../lib/auth.js';
import { clearSession, isAuthenticated, issueSession, requireAuth } from '../lib/middleware.js';

/** 设置/修改密码时才校验强度 */
const newPasswordSchema = z.object({ password: z.string().min(6, '密码至少 6 位') });
/** 登录只要求非空：长度规则是给「设密码」用的，拿来卡登录会让「密码不对」变成一句误导的报错 */
const loginSchema = z.object({ password: z.string().min(1, '密码不能为空') });

export const authRoutes = new Hono();

authRoutes.get('/status', (c) =>
  c.json({ configured: isPasswordConfigured(), authenticated: isAuthenticated(c) }),
);

/** 首次启动时设置管理员密码。密码已存在时这个接口直接拒绝，防止被重置 */
authRoutes.post('/setup', async (c) => {
  if (isPasswordConfigured()) return c.json({ error: '密码已设置过了' }, 409);
  const parsed = newPasswordSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);

  setPassword(parsed.data.password);
  issueSession(c);
  return c.json({ ok: true });
});

authRoutes.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: '密码不能为空' }, 400);

  const stored = getSetting(SETTING_KEYS.passwordHash);
  if (!stored) return c.json({ error: '还没有设置管理员密码' }, 409);
  if (!verifyPassword(parsed.data.password, stored)) return c.json({ error: '密码不对' }, 401);

  issueSession(c);
  return c.json({ ok: true });
});

authRoutes.post('/logout', (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

authRoutes.post('/password', requireAuth, async (c) => {
  const schema = z.object({ current: z.string(), next: z.string().min(6, '新密码至少 6 位') });
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);

  const stored = getSetting(SETTING_KEYS.passwordHash);
  if (!stored || !verifyPassword(parsed.data.current, stored)) {
    return c.json({ error: '当前密码不对' }, 401);
  }

  // setPassword 会轮换签名密钥，所有旧会话立刻失效，包括当前这个
  setPassword(parsed.data.next);
  issueSession(c);
  return c.json({ ok: true });
});
