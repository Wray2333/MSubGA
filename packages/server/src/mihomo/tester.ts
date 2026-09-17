import { UDP_BASED_TYPES, nodeToClash, type ClashProxy, type LatencyStatus } from '@msubga/core';
import { eq, inArray, lt } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { latencyResults, nodes, type NodeRow } from '../db/schema.js';
import { emitLatency } from '../lib/events.js';
import { getLatencySettings } from '../lib/settings.js';
import { MihomoUnavailableError } from './binary.js';
import { mihomo } from './controller.js';
import { tcpPing } from './tcpPing.js';

export type TestMethod = 'proxy' | 'tcp' | 'auto';

export interface TestRequest {
  /** 不给就测全部启用的节点 */
  nodeIds?: string[];
  method?: TestMethod;
}

export interface TestSummary {
  total: number;
  ok: number;
  failed: number;
  /** 被内核拒绝、没能参与测速的节点数 */
  skipped: number;
}

/** 内核里的代理名。用 id 而不是用户起的名字，避开 emoji、重名和 URL 编码问题 */
const internalName = (nodeId: string): string => `n-${nodeId}`;

let running = false;
export const isTestRunning = (): boolean => running;

interface Outcome {
  nodeId: string;
  delayMs: number | null;
  status: LatencyStatus;
  error?: string;
}

function persist(outcome: Outcome, method: 'tcp' | 'proxy'): void {
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(latencyResults)
      .values({
        id: nanoid(),
        nodeId: outcome.nodeId,
        testedAt: now,
        method,
        delayMs: outcome.delayMs,
        status: outcome.status,
        error: outcome.error ?? null,
      })
      .run();
    tx.update(nodes)
      .set({ lastDelayMs: outcome.delayMs, lastStatus: outcome.status, lastTestedAt: now })
      .where(eq(nodes.id, outcome.nodeId))
      .run();
  });
}

/** 只保留最近 30 天的明细，避免这张表无限膨胀 */
function pruneHistory(): void {
  db.delete(latencyResults)
    .where(lt(latencyResults.testedAt, Date.now() - 30 * 24 * 60 * 60 * 1000))
    .run();
}

/** 固定并发数的任务池，每完成一个就回调一次，不等整批跑完 */
async function pool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

function loadNodes(nodeIds?: string[]): NodeRow[] {
  if (nodeIds?.length) {
    return db.select().from(nodes).where(inArray(nodes.id, nodeIds)).all();
  }
  return db.select().from(nodes).where(eq(nodes.enabled, true)).all();
}

/* -------------------------------------------------------------------------- */

export async function runLatencyTest(request: TestRequest = {}): Promise<TestSummary> {
  if (running) throw new Error('已经有一轮测速在跑了，等它结束再来');
  running = true;

  const method = request.method ?? 'proxy';
  const { testUrl, timeoutMs, concurrency } = getLatencySettings();

  try {
    const targets = loadNodes(request.nodeIds);
    if (targets.length === 0) {
      emitLatency({ type: 'done', total: 0, ok: 0, failed: 0, skipped: 0 });
      return { total: 0, ok: 0, failed: 0, skipped: 0 };
    }

    emitLatency({ type: 'start', total: targets.length, method: method === 'tcp' ? 'tcp' : 'proxy' });

    let done = 0;
    let ok = 0;
    let failed = 0;
    const report = (outcome: Outcome, persistMethod: 'tcp' | 'proxy'): void => {
      persist(outcome, persistMethod);
      done++;
      if (outcome.status === 'ok') ok++;
      else failed++;
      emitLatency({
        type: 'result',
        nodeId: outcome.nodeId,
        delayMs: outcome.delayMs,
        status: outcome.status,
        error: outcome.error,
        done,
        total: targets.length,
      });
    };

    /* ------------------------------ 纯 TCP ------------------------------ */

    if (method === 'tcp') {
      await pool(targets, concurrency, async (node) => {
        if (UDP_BASED_TYPES.has(node.type)) {
          report(
            { nodeId: node.id, delayMs: null, status: 'unsupported', error: `${node.type} 基于 UDP，TCP 握手测不出来` },
            'tcp',
          );
          return;
        }
        const result = await tcpPing(node.server, node.port, timeoutMs);
        report({ nodeId: node.id, ...result }, 'tcp');
      });
      pruneHistory();
      const summary = { total: targets.length, ok, failed, skipped: 0 };
      emitLatency({ type: 'done', ...summary });
      return summary;
    }

    /* --------------------- auto: 先 TCP 粗筛掉不可达 --------------------- */

    let candidates = targets;
    if (method === 'auto') {
      const alive: NodeRow[] = [];
      await pool(targets, concurrency, async (node) => {
        if (UDP_BASED_TYPES.has(node.type)) {
          alive.push(node);
          return;
        }
        const result = await tcpPing(node.server, node.port, Math.min(timeoutMs, 2000));
        if (result.status === 'ok') alive.push(node);
        else report({ nodeId: node.id, ...result }, 'tcp');
      });
      candidates = alive;
    }

    /* --------------------------- 走内核真实延迟 --------------------------- */

    const nameToNode = new Map<string, NodeRow>();
    const proxies: ClashProxy[] = [];
    for (const node of candidates) {
      const name = internalName(node.id);
      nameToNode.set(name, node);
      proxies.push(nodeToClash({ name, config: node.config }));
    }

    const { loaded, rejected } = await mihomo.loadProxies(proxies);

    for (const item of rejected) {
      const node = nameToNode.get(item.name);
      if (node) {
        report({ nodeId: node.id, delayMs: null, status: 'error', error: `内核拒绝加载: ${item.reason}` }, 'proxy');
      }
    }

    await pool(loaded, concurrency, async (name) => {
      const node = nameToNode.get(name);
      if (!node) return;
      const result = await mihomo.delay(name, { url: testUrl, timeoutMs });
      report(
        result.ok
          ? { nodeId: node.id, delayMs: result.delayMs, status: 'ok' }
          : { nodeId: node.id, delayMs: null, status: result.status, error: result.error },
        'proxy',
      );
    });

    pruneHistory();
    const summary = { total: targets.length, ok, failed, skipped: rejected.length };
    emitLatency({ type: 'done', ...summary });
    return summary;
  } catch (error) {
    const message =
      error instanceof MihomoUnavailableError
        ? error.message
        : `测速失败: ${(error as Error).message}`;
    emitLatency({ type: 'error', message });
    throw error;
  } finally {
    running = false;
  }
}
