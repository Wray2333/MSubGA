import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, createSessionToken, verifySessionToken } from './auth.js';
import { SETTING_KEYS, getSetting } from './settings.js';

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

/**
 * 判断当前站点是不是 HTTPS，决定会话 cookie 要不要打 Secure 标记。
 *
 * 以「设置 → 站点 → 对外访问地址」为准。跑在反代后面时服务自己只看得到 http，
 * 靠请求协议判断会漏掉 Secure；而依赖反代传 X-Forwarded-Proto 又等于要求对方
 * 按特定方式配置。对外地址本来就要填，拿它来判断最可靠，也不用麻烦反代那边。
 */
function isHttps(c: Context): boolean {
  const baseUrl = getSetting(SETTING_KEYS.siteBaseUrl);
  if (baseUrl) return baseUrl.startsWith('https://');

  const forwarded = c.req.header('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

export function issueSession(c: Context): void {
  setCookie(c, SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: THIRTY_DAYS_SECONDS,
    // 自托管经常跑在纯 http 上，只有确实走了 https 才加 Secure。
    // 反代后面服务自己只看到 http，得认 nginx 传过来的 X-Forwarded-Proto，
    // 否则 HTTPS 站点的会话 cookie 会少掉 Secure 标记。
    secure: isHttps(c),
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
