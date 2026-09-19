import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@uiw/react-codemirror';
import { useMemo } from 'react';
import { useTheme } from './theme';

/**
 * 亮色下的编辑器外壳。
 *
 * CodeMirror 自带的 light 主题是白底 + 蓝色选区，和这套界面的冷灰完全不是一路，
 * 尤其行号槽和当前行高亮会显得很脏。语法高亮交给 CodeMirror 的默认配色（够读），
 * 这里只把「外壳」——底色、行号槽、选区、光标、当前行——换成我们的 token。
 */
const lightShell = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-fg)',
    },
    '.cm-content': { caretColor: 'var(--color-accent)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-accent)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface-2)',
      color: 'var(--color-muted)',
      border: 'none',
      borderRight: '1px solid var(--color-border)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--color-surface-2)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-surface-2)',
      color: 'var(--color-fg-2)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--selection-bg)',
    },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--color-accent) 16%, transparent)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-surface-2)',
      border: '1px solid var(--color-border)',
      color: 'var(--color-muted)',
    },
  },
  { dark: false },
);

/** 三个编辑器（模板 / 规则集 / 订阅预览）共用，避免各写一份走散 */
export function useEditorTheme() {
  const { theme } = useTheme();
  return useMemo(() => (theme === 'dark' ? oneDark : lightShell), [theme]);
}
