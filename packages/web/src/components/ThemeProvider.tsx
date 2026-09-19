import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyTheme,
  readStoredMode,
  resolveTheme,
  storeMode,
  ThemeContext,
  watchSystemTheme,
  type ThemeMode,
} from '../lib/theme';

/**
 * 首帧的主题由 index.html 里那段同步脚本定，这里只负责之后的切换和跟随。
 * 初始值直接读同一个存储键，保证和已经画出来的那一帧一致，不会自己再闪一下。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [theme, setTheme] = useState(() => resolveTheme(readStoredMode()));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 只有跟随系统时才需要听系统的变化
  useEffect(() => {
    if (mode !== 'system') return;
    setTheme(resolveTheme('system'));
    return watchSystemTheme(setTheme);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    storeMode(next);
    setTheme(resolveTheme(next));
  }, []);

  const value = useMemo(() => ({ mode, theme, setMode }), [mode, theme, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
