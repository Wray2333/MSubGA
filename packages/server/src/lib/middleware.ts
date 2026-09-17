import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, createSessionToken, verifySessionToken } from './auth.js';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export function issueSession(c: Context): void {
  setCookie(c, SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: THIRTY_DAYS_SECONDS,
    // 自托管经常跑在纯 http 上，只有确实走了 https 才加 Secure
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

export function clearSession(c: Context): void {
  setCookie(c, SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export function isAuthenticated(c: Context): boolean {
  return verifySessionToken(getCookie(c, SESSION_COOKIE));
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!isAuthenticated(c)) return c.json({ error: '未登录' }, 401);
  await next();
};
