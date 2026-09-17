import { connect } from 'node:net';
import type { LatencyStatus } from '@msubga/core';

export interface PingResult {
  delayMs: number | null;
  status: LatencyStatus;
  error?: string;
}

/**
 * 纯 TCP 握手计时。测的是「服务器可不可达」，不是「节点能不能用」——
 * 它不走协议握手，服务器活着但配置错了一样测得出低延迟。
 * 只用于 auto 模式下的粗筛，和内核不可用时的降级。
 */
export function tcpPing(host: string, port: number, timeoutMs: number): Promise<PingResult> {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    let settled = false;

    const finish = (result: PingResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = connect({ host, port, timeout: timeoutMs });

    socket.once('connect', () => {
      const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e6;
      finish({ delayMs: Math.round(elapsed), status: 'ok' });
    });
    socket.once('timeout', () => finish({ delayMs: null, status: 'timeout', error: '连接超时' }));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      const status: LatencyStatus = error.code === 'ECONNREFUSED' ? 'refused' : 'error';
      finish({ delayMs: null, status, error: error.message });
    });
  });
}
