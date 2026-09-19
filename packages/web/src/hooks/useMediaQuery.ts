import { useEffect, useState } from 'react';

/**
 * 订阅媒体查询。
 * 表格转卡片这类切换必须在 JS 层做：CSS 的 hidden/block 会把两套结构都渲染出来，
 * 上百个节点时等于白白多渲染一遍。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind 的 sm 断点是 640px，这里和它保持一致，避免两套断点打架 */
export const useIsMobile = (): boolean => useMediaQuery('(max-width: 639px)');
