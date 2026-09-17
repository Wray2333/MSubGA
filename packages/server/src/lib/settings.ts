import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';

export const SETTING_KEYS = {
  passwordHash: 'auth.passwordHash',
  sessionSecret: 'auth.sessionSecret',
  mihomoPath: 'mihomo.path',
  mihomoVersion: 'mihomo.version',
  latencyTestUrl: 'latency.testUrl',
  latencyTimeoutMs: 'latency.timeoutMs',
  latencyConcurrency: 'latency.concurrency',
  siteBaseUrl: 'site.baseUrl',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const DEFAULTS = {
  [SETTING_KEYS.latencyTestUrl]: 'https://www.gstatic.com/generate_204',
  [SETTING_KEYS.latencyTimeoutMs]: '5000',
  [SETTING_KEYS.latencyConcurrency]: '16',
} as const satisfies Partial<Record<SettingKey, string>>;

export function getSetting(key: SettingKey): string | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? (DEFAULTS as Record<string, string | undefined>)[key];
}

export function setSetting(key: SettingKey, value: string): void {
  db.insert(settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
    .run();
}

export function deleteSetting(key: SettingKey): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}

export function getNumberSetting(key: SettingKey, fallback: number): number {
  const raw = getSetting(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 测速相关配置，tester 和设置页共用 */
export function getLatencySettings(): { testUrl: string; timeoutMs: number; concurrency: number } {
  return {
    testUrl: getSetting(SETTING_KEYS.latencyTestUrl) ?? DEFAULTS[SETTING_KEYS.latencyTestUrl],
    timeoutMs: getNumberSetting(SETTING_KEYS.latencyTimeoutMs, 5000),
    concurrency: Math.max(1, Math.min(64, getNumberSetting(SETTING_KEYS.latencyConcurrency, 16))),
  };
}
