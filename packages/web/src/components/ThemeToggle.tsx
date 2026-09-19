import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '../lib/theme';
import { cn } from '../lib/utils';

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: '亮色', icon: Sun },
  { mode: 'dark', label: '暗色', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor },
];

/**
 * 三档分段控件。用 radiogroup 而不是一个「切换」按钮：
 * 「跟随系统」是和亮/暗并列的第三种状态，用开关表达不了，
 * 而且轮换式的切换按钮永远说不清下一下会跳到哪。
 */
export function ThemeToggle({ labels = false, className }: { labels?: boolean; className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="界面主题"
      className={cn(
        'inline-flex items-center gap-0.5 rounded border border-border bg-surface/60 p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ mode: value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => setMode(value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-sm transition',
              // 和 CONTROL_HEIGHT.sm 对齐：触摸端 40px，桌面收到 32px
              labels ? 'h-10 flex-1 px-3 sm:h-8' : 'size-10 sm:size-7',
              active
                ? 'bg-surface-2 text-accent shadow-[inset_0_0_0_1px_var(--color-border)]'
                : 'text-muted hover:bg-surface-2/60 hover:text-fg-2',
            )}
          >
            <Icon className={labels ? 'size-4' : 'size-[15px]'} />
            {labels && <span className="text-xs whitespace-nowrap">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
