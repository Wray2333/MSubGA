import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { ClashProxy, LatencyStatus } from '@msubga/core';
import { MIHOMO_RUN_DIR } from '../config.js';
import { MihomoUnavailableError, resolveMihomoBinary } from './binary.js';

const READY_TIMEOUT_MS = 20_000;
/** 空闲这么久就把内核进程收掉，别让它一直挂着 */
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;
/** 二分定位坏节点时最多允许的配置重载次数，防止整批都是坏节点时把时间耗光 */
const MAX_RELOADS = 40;

export interface LoadResult {
  /** 成功进入内核的代理名 */
  loaded: string[];
  /** 被内核拒绝的代理名及原因 */
  rejected: { name: string; reason: string }[];
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('拿不到空闲端口'))));
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function proxyNames(proxies: readonly ClashProxy[]): string[] {
  return proxies.map((proxy) => String(proxy['name']));
}

/** mihomo 的配置报错通常形如 `proxy 3: unsupport proxy type: xxx` */
function parseProxyIndex(message: string): number | null {
  const match = /proxy\s+(\d+)\s*:/i.exec(message);
  if (!match?.[1]) return null;
  const index = Number.parseInt(match[1], 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * 常驻一个 mihomo 进程，通过它的 external-controller 做真实代理延迟测试。
 *
 * 换一批节点不需要重启进程：写新配置文件后 PUT /configs?force=true 热重载即可。
 */
class MihomoController {
  private process: ChildProcess | null = null;
  private port = 0;
  private secret = '';
  private binaryPath = '';
  private starting: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastError = '';

  get running(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  private get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' };
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.stop(), IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  async ensureRunning(): Promise<void> {
    if (this.running) {
      this.touchIdle();
      return;
    }
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async start(): Promise<void> {
    const binary = await resolveMihomoBinary();
    this.binaryPath = binary.path;
    this.port = await findFreePort();
    this.secret = randomBytes(16).toString('hex');

    mkdirSync(MIHOMO_RUN_DIR, { recursive: true });
    // 空配置：不监听任何入站端口，只把 API 打开。测延迟不需要 inbound。
    this.writeConfig([]);

    const child = spawn(this.binaryPath, ['-d', MIHOMO_RUN_DIR, '-f', this.configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      this.lastError = chunk.toString('utf8').trim().slice(-500);
    });
    child.on('exit', (code, signal) => {
      if (this.process === child) this.process = null;
      if (code !== 0 && code !== null) {
        console.error(`[mihomo] 进程退出 code=${code} signal=${signal} ${this.lastError}`);
      }
    });
    child.on('error', (error) => {
      this.lastError = error.message;
    });

    await this.waitReady();
    this.touchIdle();
  }

  private get configPath(): string {
    return join(MIHOMO_RUN_DIR, 'config.yaml');
  }

  private writeConfig(proxies: readonly ClashProxy[]): void {
    const config = {
      'external-controller': `127.0.0.1:${this.port}`,
      secret: this.secret,
      'log-level': 'warning',
      mode: 'rule',
      ipv6: false,
      'unified-delay': true,
      proxies,
      rules: ['MATCH,DIRECT'],
    };
    writeFileSync(this.configPath, stringify(config, { lineWidth: 0 }), 'utf8');
  }

  private async waitReady(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.running) {
        throw new MihomoUnavailableError(`mihomo 启动即退出: ${this.lastError || '无输出'}`);
      }
      try {
        const response = await fetch(`${this.baseUrl}/version`, { headers: this.headers() });
        if (response.ok) return;
      } catch {
        /* 还没起来，继续等 */
      }
      await sleep(200);
    }
    await this.stop();
    throw new MihomoUnavailableError(`mihomo 在 ${READY_TIMEOUT_MS / 1000}s 内没有就绪: ${this.lastError}`);
  }

  /* ------------------------------ 加载节点 ------------------------------ */

  private async applyConfig(
    proxies: readonly ClashProxy[],
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    this.writeConfig(proxies);
    try {
      const response = await fetch(`${this.baseUrl}/configs?force=true`, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ path: this.configPath }),
      });
      if (response.ok || response.status === 204) return { ok: true };
      const text = await response.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* 不是 JSON 就用原文 */
      }
      return { ok: false, message };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  /**
   * 把一批代理塞进内核。
   *
   * 关键点：一个畸形节点会让整份配置加载失败，导致整批测速全挂。
   * 所以失败时先试着从报错里揪出索引，揪不到再二分定位，
   * 最终返回「哪些进去了、哪些被内核拒了」。
   */
  async loadProxies(proxies: readonly ClashProxy[]): Promise<LoadResult> {
    await this.ensureRunning();
    this.touchIdle();

    if (proxies.length === 0) {
      await this.applyConfig([]);
      return { loaded: [], rejected: [] };
    }

    const first = await this.applyConfig(proxies);
    if (first.ok) return { loaded: proxyNames(proxies), rejected: [] };

    const rejected: { name: string; reason: string }[] = [];
    let remaining = [...proxies];

    const index = parseProxyIndex(first.message);
    if (index !== null && index < remaining.length) {
      const [bad] = remaining.splice(index, 1);
      if (bad) rejected.push({ name: String(bad['name']), reason: first.message });
      const retry = await this.applyConfig(remaining);
      if (retry.ok) return { loaded: proxyNames(remaining), rejected };
    }

    const budget = { left: MAX_RELOADS };
    const good = await this.bisect(remaining, rejected, budget, first.message);
    await this.applyConfig(good);
    return { loaded: proxyNames(good), rejected };
  }

  private async bisect(
    group: readonly ClashProxy[],
    rejected: { name: string; reason: string }[],
    budget: { left: number },
    parentReason: string,
  ): Promise<ClashProxy[]> {
    if (group.length === 0) return [];
    if (budget.left <= 0) {
      console.warn(`[mihomo] 定位坏节点的重载预算用尽，剩余 ${group.length} 个节点跳过测速`);
      for (const proxy of group) {
        rejected.push({ name: String(proxy['name']), reason: '定位坏节点超时，本轮跳过' });
      }
      return [];
    }

    budget.left--;
    const result = await this.applyConfig(group);
    if (result.ok) return [...group];

    if (group.length === 1) {
      rejected.push({ name: String(group[0]!['name']), reason: result.message || parentReason });
      return [];
    }

    const mid = Math.floor(group.length / 2);
    const left = await this.bisect(group.slice(0, mid), rejected, budget, result.message);
    const right = await this.bisect(group.slice(mid), rejected, budget, result.message);
    return [...left, ...right];
  }

  /* ------------------------------- 测延迟 ------------------------------- */

  async delay(
    proxyName: string,
    options: { url: string; timeoutMs: number },
  ): Promise<{ ok: true; delayMs: number } | { ok: false; status: LatencyStatus; error: string }> {
    const params = new URLSearchParams({ url: options.url, timeout: String(options.timeoutMs) });
    const endpoint = `${this.baseUrl}/proxies/${encodeURIComponent(proxyName)}/delay?${params}`;

    try {
      // 比内核超时多给 2s，让内核自己先超时并给出有意义的报错
      const response = await fetch(endpoint, {
        headers: this.headers(),
        signal: AbortSignal.timeout(options.timeoutMs + 2000),
      });
      if (response.ok) {
        const body = (await response.json()) as { delay?: number };
        if (typeof body.delay === 'number') return { ok: true, delayMs: body.delay };
        return { ok: false, status: 'error', error: '内核没有返回延迟值' };
      }
      const text = await response.text();
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* 用原文 */
      }
      return { ok: false, status: classifyError(message), error: message };
    } catch (error) {
      const message = (error as Error).message;
      return { ok: false, status: classifyError(message), error: message };
    }
  }

  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) return;

    if (process.platform === 'win32' && child.pid) {
      // Windows 上 SIGTERM 不一定能收掉子进程树
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
    await sleep(100);
  }
}

export const mihomo = new MihomoController();

function classifyError(message: string): LatencyStatus {
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('deadline') || lower.includes('aborted')) return 'timeout';
  if (lower.includes('refused') || lower.includes('reset')) return 'refused';
  return 'error';
}
