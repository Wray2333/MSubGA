import * as Dialog from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Loader2, X } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/utils';

/* --------------------------------- Button -------------------------------- */

type Variant = 'primary' | 'ghost' | 'danger' | 'outline' | 'subtle';
type Size = 'sm' | 'md';

/**
 * 控件高度的唯一来源。
 * Button / Input / Select 全部引这里，避免各处硬编码导致同一行里高低不齐。
 * 触摸设备 44/40px，桌面收紧到 36/28px。
 */
export const CONTROL_HEIGHT = {
  // sm 桌面端原来是 28px，四个汉字塞进去又长又扁像装不下。
  // 汉字比同字号的拉丁字母需要更多纵向空间，抬到 32px 才站得住。
  sm: 'h-10 sm:h-8',
  md: 'h-11 sm:h-9',
} as const;

const VARIANTS: Record<Variant, string> = {
  // 主操作是实心警示红——这套视觉里红是唯一的强调色，要害操作才配用
  // 主操作走渐变，配一点同色辉光
  primary:
    'grad-accent text-accent-fg font-semibold shadow-[0_0_16px_-4px_var(--color-accent)] hover:brightness-110 active:brightness-95',
  outline:
    'border border-border bg-surface/60 text-fg-2 hover:border-accent/60 hover:text-fg hover:bg-surface',
  subtle: 'border border-transparent bg-surface-2 text-fg-2 hover:border-border-strong hover:text-fg',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'border border-danger/40 text-danger hover:bg-danger/15 hover:text-danger',
};

export function Button({
  variant = 'outline',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded transition',
        // 文字不换行、不被压缩，容器再挤也不会把字切掉
        'whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-40',
        CONTROL_HEIGHT[size],
        size === 'sm' ? 'px-3 text-xs' : 'px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className={cn('animate-spin', size === 'sm' ? 'size-3' : 'size-3.5')} />}
      {children}
    </button>
  );
}

/* --------------------------------- 输入类 -------------------------------- */

const FIELD = cn(
  'w-full rounded border border-border bg-surface/70 px-2.5 text-sm text-fg outline-none transition',
  'placeholder:text-muted/70 hover:border-border-strong',
  'focus:border-accent focus:ring-2 focus:ring-accent/15',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(FIELD, CONTROL_HEIGHT.md, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(FIELD, 'py-2 font-mono text-xs leading-relaxed', className)} />;
}

/* 自己画的下拉箭头。用原生的话浏览器会在元素内部额外占一块宽度，
   那块宽度算不进 padding，文字就被压到箭头底下切掉。 */
const SELECT_ARROW =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237d879b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      style={{
        appearance: 'none',
        backgroundImage: SELECT_ARROW,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.625rem center',
        ...rest.style,
      }}
      className={cn(FIELD, CONTROL_HEIGHT.md, 'cursor-pointer pr-8', className)}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      {label && <span className="telemetry block text-muted">{label}</span>}
      {children}
      {error ? (
        <span className="block font-mono text-2xs text-danger">{error}</span>
      ) : (
        hint && <span className="block text-2xs leading-snug text-muted">{hint}</span>
      )}
    </label>
  );
}

export function Checkbox({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      {...rest}
      className={cn('size-4 shrink-0 cursor-pointer accent-[var(--color-accent)] sm:size-3.5', className)}
    />
  );
}

/** 勾选框 + 文字，整体可点 */
export function CheckLabel({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-1.5 text-xs text-fg-2', className)}>
      <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

/* --------------------------------- 展示类 -------------------------------- */

type ChipTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface-2 text-fg-2',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

export function Chip({
  children,
  tone = 'neutral',
  className,
  style,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={style}
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 py-[3px] text-2xs leading-none',
        // 字距只给 0.04em：0.08em 在中文标签上会把容器撑破
        'uppercase tracking-[0.04em] whitespace-nowrap',
        CHIP_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('border border-border bg-surface', className ?? 'p-4')}>
      {children}
    </section>
  );
}

/** 页面标题。标题一档、说明一档，说明不抢视线 */
export function PageHeader({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  count?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relative pb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="mr-auto min-w-0 basis-full sm:basis-auto">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold tracking-[0.02em]">{title}</h1>
            {count !== undefined && (
              <span className="telemetry text-accent tabular">{count}</span>
            )}
          </div>
          {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-accent via-accent-2/60 to-transparent"
      />
    </header>
  );
}

export function SectionTitle({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
        <span aria-hidden className="grad-accent h-3.5 w-[3px] rounded-full" />
        {title}
      </h2>
      {hint && <span className="mr-auto text-2xs text-muted">{hint}</span>}
      {!hint && <span className="mr-auto" />}
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-border py-14 text-center">
      <p className="telemetry-cjk text-fg-2">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-sm px-4 text-xs text-muted">{children}</p>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-20 text-muted', className)}>
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

/* --------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-5xl' }[size];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border border-border bg-surface shadow-2xl shadow-black/60',
            // 手机：贴底的抽屉，从下方滑出，拇指区就能操作
            'inset-x-0 bottom-0 max-h-[92vh] rounded-t-xl border-b-0',
            // 桌面：居中对话框
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:w-[94vw]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border-b',
            width,
          )}
        >
          <div className="mx-auto mt-2 h-0.5 w-10 shrink-0 bg-border-strong sm:hidden" />
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title className="text-[0.9375rem] font-semibold tracking-[0.02em]">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-xs leading-snug text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close className="-mr-1 shrink-0 rounded p-1 text-muted transition hover:bg-surface-2 hover:text-fg">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/40 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------------------------------- Tabs --------------------------------- */

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ children }: { children: ReactNode }) {
  return (
    <TabsPrimitive.List className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'rounded px-3 py-1.5 text-xs text-muted transition',
        'hover:text-fg-2 data-[state=active]:grad-accent data-[state=active]:text-accent-fg',
        'data-[state=active]:font-medium',
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}
