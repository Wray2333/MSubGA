import { EventEmitter } from 'node:events';
import type { LatencyMethod, LatencyStatus } from '@msubga/core';

export type LatencyEvent =
  | { type: 'start'; total: number; method: LatencyMethod }
  | {
      type: 'result';
      nodeId: string;
      delayMs: number | null;
      status: LatencyStatus;
      error?: string;
      done: number;
      total: number;
    }
  | { type: 'done'; total: number; ok: number; failed: number; skipped: number }
  | { type: 'error'; message: string };

const emitter = new EventEmitter();
// 测速时每个节点一条事件，同时开多个页面也不该触发 Node 的监听器泄漏告警
emitter.setMaxListeners(50);

const CHANNEL = 'latency';

export function emitLatency(event: LatencyEvent): void {
  emitter.emit(CHANNEL, event);
}

export function onLatency(listener: (event: LatencyEvent) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}
