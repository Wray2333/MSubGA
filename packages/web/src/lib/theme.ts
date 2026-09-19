import { createContext, useContext } from 'react';

/**
 * 三档：跟着系统走，或者钉死一种。
 * 默认是 dark——这套界面本来就是照暗色设计的，不想让任何人升级后被动换皮肤。
 */
export type ThemeMode = 'light' | 'dark' | 'system';
/** 实际生效的那一套，system 解析之后只会是这两个之一 */
export type ResolvedTheme = 'light' | 'dark';

/** 和 index.html 里那段首帧脚本共用，改这里要同步改那边 */
export const THEME_STORAGE_KEY = 'msubga.theme';
export const DEFAULT_MODE: ThemeMode = 'dark';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readStoredMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(saved) ? saved : DEFAULT_MODE;
  } catch {
    // 隐私模式 / 禁用存储时读写都会抛，不能让它把整个应用带崩
    return DEFAULT_MODE;
  }
}

export function storeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 存不下就只在本次会话里生效，不值得打扰用户
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode;
}

/** 订阅系统主题变化，只有 mode=system 时才有意义 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia(LIGHT_QUERY);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches ? 'light' : 'dark');
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}

/**
 * 把结果写到 <html> 上。
 * data-theme 驱动 CSS 变量；color-scheme 让浏览器自己画的那些东西
 * （表单控件、原生滚动条、autofill 底色）跟着一起换。
 *
 * 换的这一帧要先把过渡全部掐掉：带 transition 的元素在变量变化后
 * 不会重新解析 var() 驱动的颜色，会卡在上一套配色里直到刷新。
 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  // 读一次布局，逼浏览器把「无过渡」这条规则先应用上，再改变量
  void root.offsetHeight;

  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  // 等两帧：一帧让新颜色落定，再一帧把过渡还回去
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove('theme-switching'));
  });
}

export interface ThemeContextValue {
  /** 用户选的那一档，可能是 system */
  mode: ThemeMode;
  /** 当前真正在用的那套 */
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme 必须在 ThemeProvider 内使用');
  return value;
}
