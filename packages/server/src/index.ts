import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { BASE_URL_ENV, HOST, INITIAL_PASSWORD, PORT, WEB_DIST_DIR } from './config.js';
import { runMigrations } from './db/index.js';
import { seedBuiltins } from './db/seed.js';
import { isPasswordConfigured, setPassword } from './lib/auth.js';
import { SETTING_KEYS, getSetting, setSetting } from './lib/settings.js';
import { serveWebDist } from './lib/static.js';
import { mihomo } from './mihomo/controller.js';
import { authRoutes } from './routes/auth.js';
import { latencyRoutes } from './routes/latency.js';
import { nodeRoutes } from './routes/nodes.js';
import { profileRoutes } from './routes/profiles.js';
import { rulesetRoutes } from './routes/rulesets.js';
import { settingsRoutes } from './routes/settings.js';
import { publicSubRoutes } from './routes/sub.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { tagRoutes } from './routes/tags.js';

function bootstrap(): void {
  runMigrations();
  seedBuiltins();

  if (INITIAL_PASSWORD && !isPasswordConfigured()) {
    setPassword(INITIAL_PASSWORD);
    console.log('[msubga] 已按 MSUBGA_PASSWORD 设置管理员密码');
  }

  // 只在设置页还没填过的时候写入，避免每次重启都把用户改过的值冲掉
  if (BASE_URL_ENV && !getSetting(SETTING_KEYS.siteBaseUrl)) {
    setSetting(SETTING_KEYS.siteBaseUrl, BASE_URL_ENV.replace(/\/+$/, ''));
    console.log(`[msubga] 对外访问地址: ${BASE_URL_ENV}`);
  }
}

const app = new Hono();
app.use('*', logger());

app.get('/healthz', (c) => c.json({ ok: true }));

app.route('/api/auth', authRoutes);
app.route('/api/nodes', nodeRoutes);
app.route('/api/tags', tagRoutes);
app.route('/api/latency', latencyRoutes);
app.route('/api/rulesets', rulesetRoutes);
app.route('/api/profiles', profileRoutes);
app.route('/api/subscriptions', subscriptionRoutes);
app.route('/api/settings', settingsRoutes);

// 公开订阅出口，不走登录
app.route('/sub', publicSubRoutes);

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: '接口不存在' }, 404) : c.text('Not Found', 404),
);

app.onError((error, c) => {
  console.error('[msubga] 未处理的错误:', error);
  return c.json({ error: '服务端内部错误' }, 500);
});

bootstrap();

if (existsSync(WEB_DIST_DIR)) {
  app.use('*', serveWebDist(WEB_DIST_DIR));
} else {
  console.log('[msubga] 没找到前端产物，开发模式下请另开 vite dev server');
}

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`[msubga] 已启动: http://${HOST}:${info.port}`);
  if (!isPasswordConfigured()) {
    console.log('[msubga] 还没设置管理员密码，打开页面按提示设置，或用 MSUBGA_PASSWORD 环境变量');
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[msubga] 收到 ${signal}，正在关闭…`);
  // 先收掉 mihomo 子进程，否则它会变成孤儿进程留在后台
  await mihomo.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export { app };
