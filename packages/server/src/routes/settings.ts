import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../lib/middleware.js';
import {
  SETTING_KEYS,
  getLatencySettings,
  getSetting,
  isRulesetProxyEnabled,
  setSetting,
} from '../lib/settings.js';
import { MihomoUnavailableError, describeBinary, downloadMihomo, probeVersion } from '../mihomo/binary.js';
import { mihomo } from '../mihomo/controller.js';

export const settingsRoutes = new Hono();
settingsRoutes.use('*', requireAuth);

settingsRoutes.get('/', (c) =>
  c.json({
    latency: getLatencySettings(),
    siteBaseUrl: getSetting(SETTING_KEYS.siteBaseUrl) ?? '',
    rulesetProxy: isRulesetProxyEnabled(),
    mihomo: { ...describeBinary(), running: mihomo.running },
  }),
);

const patchSchema = z.object({
  latencyTestUrl: z.string().url('测速 URL 格式不对').optional(),
  latencyTimeoutMs: z.number().int().min(500).max(60_000).optional(),
  latencyConcurrency: z.number().int().min(1).max(64).optional(),
  siteBaseUrl: z.string().optional(),
  rulesetProxy: z.boolean().optional(),
  mihomoPath: z.string().optional(),
});

settingsRoutes.patch('/', async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, 400);
  const data = parsed.data;

  if (data.latencyTestUrl) setSetting(SETTING_KEYS.latencyTestUrl, data.latencyTestUrl);
  if (data.latencyTimeoutMs) setSetting(SETTING_KEYS.latencyTimeoutMs, String(data.latencyTimeoutMs));
  if (data.latencyConcurrency) setSetting(SETTING_KEYS.latencyConcurrency, String(data.latencyConcurrency));
  if (data.siteBaseUrl !== undefined) {
    setSetting(SETTING_KEYS.siteBaseUrl, data.siteBaseUrl.replace(/\/+$/, ''));
  }

  if (data.rulesetProxy !== undefined) {
    setSetting(SETTING_KEYS.rulesetProxy, String(data.rulesetProxy));
  }

  if (data.mihomoPath !== undefined) {
    const path = data.mihomoPath.trim();
    if (path) {
      if (!existsSync(path)) return c.json({ error: `路径不存在: ${path}` }, 400);
      try {
        const version = await probeVersion(path);
        setSetting(SETTING_KEYS.mihomoPath, path);
        setSetting(SETTING_KEYS.mihomoVersion, version);
      } catch (error) {
        return c.json({ error: (error as Error).message }, 400);
      }
    } else {
      setSetting(SETTING_KEYS.mihomoPath, '');
    }
    // 换了内核就把旧进程收掉，下次测速会用新的重新拉起来
    await mihomo.stop();
  }

  return c.json({ ok: true });
});

settingsRoutes.post('/mihomo/download', async (c) => {
  try {
    await mihomo.stop();
    const binary = await downloadMihomo();
    return c.json({ ok: true, ...binary });
  } catch (error) {
    const message =
      error instanceof MihomoUnavailableError ? error.message : `下载失败: ${(error as Error).message}`;
    return c.json({ error: message }, 502);
  }
});
