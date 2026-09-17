import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { db } from '../db/index.js';
import { latencyResults } from '../db/schema.js';
import { type LatencyEvent, onLatency } from '../lib/events.js';
import { requireAuth } from '../lib/middleware.js';
import { isTestRunning, runLatencyTest } from '../mihomo/tester.js';

export const latencyRoutes = new Hono();
latencyRoutes.use('*', requireAuth);

const HEARTBEAT_MS = 15_000;

latencyRoutes.get('/status', (c) => c.json({ running: isTestRunning() }));

const testSchema = z.object({
  nodeIds: z.array(z.string()).optional(),
  method: z.enum(['proxy', 'tcp', 'auto']).default('proxy'),
});

/**
 * 发起测速。整批可能要跑几十秒，所以这里立刻返回，
 * 进度和结果通过 /stream 的 SSE 推过去。
 */
latencyRoutes.post('/test', async (c) => {
  if (isTestRunning()) return c.json({ error: '已经有一轮测速在跑了' }, 409);

  const parsed = testSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: '参数不合法' }, 400);

  void runLatencyTest(parsed.data).catch((error: unknown) => {
    console.error('[latency] 测速失败:', error);
  });

  return c.json({ started: true }, 202);
});

latencyRoutes.get('/stream', (c) =>
  streamSSE(c, async (stream) => {
    let closed = false;
    const pending: LatencyEvent[] = [];
    let notify: (() => void) | null = null;

    const unsubscribe = onLatency((event) => {
      pending.push(event);
      notify?.();
      notify = null;
    });

    stream.onAbort(() => {
      closed = true;
      unsubscribe();
      notify?.();
      notify = null;
    });

    try {
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ running: isTestRunning() }) });

      while (!closed) {
        while (pending.length > 0) {
          const event = pending.shift();
          if (event) await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
        if (closed) break;

        // 没事件时定期发心跳，免得反代把空闲连接掐掉
        await Promise.race([
          new Promise<void>((resolve) => {
            notify = resolve;
          }),
          new Promise<void>((resolve) => setTimeout(resolve, HEARTBEAT_MS)),
        ]);
        notify = null;
        if (!closed && pending.length === 0) await stream.writeSSE({ event: 'ping', data: '' });
      }
    } finally {
      unsubscribe();
    }
  }),
);

latencyRoutes.get('/history/:nodeId', (c) => {
  const rows = db
    .select()
    .from(latencyResults)
    .where(eq(latencyResults.nodeId, c.req.param('nodeId')))
    .orderBy(desc(latencyResults.testedAt))
    .limit(50)
    .all();
  return c.json({ results: rows });
});
