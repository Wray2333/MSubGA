import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { SETTING_KEYS, getSetting, setSetting } from './settings.js';

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = 'msubga_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* ----------------------------------- 密码 ---------------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  // 长度不同时 timingSafeEqual 会抛，先挡一道
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isPasswordConfigured(): boolean {
  return Boolean(getSetting(SETTING_KEYS.passwordHash));
}

export function setPassword(password: string): void {
  setSetting(SETTING_KEYS.passwordHash, hashPassword(password));
  // 换密码就换签名密钥，把所有已签发的 session 一次性作废
  rotateSessionSecret();
}

/* ---------------------------------- 会话 ---------------------------------- */

function getSessionSecret(): string {
  let secret = getSetting(SETTING_KEYS.sessionSecret);
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    setSetting(SETTING_KEYS.sessionSecret, secret);
  }
  return secret;
}

export function rotateSessionSecret(): void {
  setSetting(SETTING_KEYS.sessionSecret, randomBytes(32).toString('hex'));
}

function sign(payload: string): string {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

/**
 * 无状态会话：payload 里只有签发和过期时间，用服务端密钥签名。
 * 单用户场景下不需要在库里存会话表，改密码时轮换密钥即可全量失效。
 */
export function createSessionToken(): string {
  const payload = JSON.stringify({ iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = Buffer.from(sign(encoded), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

/** 订阅 URL 里的 token，32 字节随机，可轮换 */
export function generateSubscriptionToken(): string {
  return randomBytes(24).toString('base64url');
}
