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

/**
 * 延迟读数的配色。
 * 这套视觉里颜色是稀缺资源：只有终端绿和警示红两个语义色，
 * 中间档用白磷光本色，不再引入第三种颜色。
 */
export function delayTone(delayMs: number | null | undefined, status: string | null | undefined): string {
  // 没测过 ≠ 失败，别一上来就标红
  if (status === null || status === undefined) return 'text-muted';
  if (status !== 'ok' || delayMs === null || delayMs === undefined) return 'text-danger';
  if (delayMs < 200) return 'text-terminal';
  if (delayMs < 500) return 'text-fg';
  return 'text-fg-2';
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

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ---------------------------- 标签颜色的可读性 ---------------------------- */

/*
 * 标签颜色是用户在建标签时挑的，存成一个十六进制值，两套主题共用同一份数据。
 * 但它在界面里是当文字色用的（Chip 的 color + borderColor），
 * 而那组预设是照着暗底挑的：#fbbf24 压在白底上只有 1.63:1，等于看不见。
 *
 * 所以渲染时按当前主题把明度拉到够读为止，存的值不动。
 */

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toChannel = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [toChannel(h + 1 / 3), toChannel(h), toChannel(h - 1 / 3)].map((v) =>
    Math.round(v * 255),
  ) as [number, number, number];
}

const toHex = ([r, g, b]: [number, number, number]): string =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/*
 * 参照底色写死成常量，不从 DOM 读。
 * 读 DOM 会踩两个坑：一是 TagChip 在 render 阶段算颜色，而主题是在 effect 里才
 * 落到 <html> 上的，切换那一次读到的是上一套的值；二是缓存会把这个错值钉死。
 *
 * 取 surface-2 而不是 surface：两套主题里它都是对比度最差的那一档
 * （亮色 #e9eff7 比白卡片暗，暗色 #14171e 比 #06070a 的页底亮），
 * 在它上面够读，在页底和卡片上就一定够读。改 token 时要跟着改这里。
 */
const REFERENCE_BG: Record<'light' | 'dark', [number, number, number]> = {
  light: [233, 239, 247], // --color-surface-2
  dark: [20, 23, 30], // --color-surface-2
};

/** 留一点余量，免得算出来正好卡在 4.5 上，换个底色就掉下去 */
const TARGET_RATIO = 4.6;

/**
 * 把标签色调到在当前主题下够读。
 * 亮色主题往暗调，暗色主题往亮调；已经够读的原样返回。
 */
export function readableTagColor(hex: string, theme: 'light' | 'dark'): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const bg = REFERENCE_BG[theme];
  if (contrastRatio(rgb, bg) >= TARGET_RATIO) return hex;

  const [h, s, l] = rgbToHsl(rgb);
  const step = theme === 'light' ? -0.02 : 0.02;
  let lightness = l;
  // 最多走 50 步（明度整个区间），够不到就用走到的最好那一档
  for (let i = 0; i < 50; i++) {
    lightness += step;
    if (lightness <= 0 || lightness >= 1) break;
    const candidate = hslToRgb([h, s, lightness]);
    if (contrastRatio(candidate, bg) >= TARGET_RATIO) return toHex(candidate);
  }
  return toHex(hslToRgb([h, s, theme === 'light' ? 0.22 : 0.82]));
}
