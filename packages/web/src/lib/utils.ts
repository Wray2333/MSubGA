import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 延迟分档着色：绿 < 200ms < 黄 < 500ms < 橙，失败一律红 */
export function delayTone(delayMs: number | null | undefined, status: string | null | undefined): string {
  // 没测过 ≠ 失败，别一上来就标红
  if (status === null || status === undefined) return 'text-muted';
  if (status !== 'ok' || delayMs === null || delayMs === undefined) return 'text-danger';
  if (delayMs < 200) return 'text-ok';
  if (delayMs < 500) return 'text-warn';
  return 'text-orange-400';
}

export const STATUS_LABEL: Record<string, string> = {
  ok: '正常',
  timeout: '超时',
  refused: '拒绝连接',
  error: '出错',
  unsupported: '不支持',
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
