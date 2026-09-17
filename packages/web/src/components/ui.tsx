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

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg font-medium hover:brightness-110 active:brightness-95',
  outline: 'border border-border bg-surface text-fg-2 hover:border-border-strong hover:text-fg',
  subtle: 'bg-surface-2 text-fg-2 hover:text-fg hover:brightness-110',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'border border-danger/35 text-danger hover:bg-danger/12',
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
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition',
        'disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2 text-2xs' : 'h-9 px-3 text-sm',
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
  'w-full rounded-md border border-border bg-bg px-2.5 text-sm text-fg outline-none transition',
  'placeholder:text-muted/70 hover:border-border-strong',
  'focus:border-accent focus:ring-2 focus:ring-accent/20',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(FIELD, 'h-9', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(FIELD, 'py-2 font-mono text-xs leading-relaxed', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(FIELD, 'h-9 cursor-pointer pr-7', className)}>
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
      {label && <span className="block text-2xs font-medium tracking-wide text-muted">{label}</span>}
      {children}
      {error ? (
        <span className="block text-2xs text-danger">{error}</span>
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
      className={cn('size-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)]', className)}
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
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent/12 text-accent',
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
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
        'inline-flex items-center rounded px-1.5 py-0.5 text-2xs leading-none whitespace-nowrap',
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
    <section className={cn('rounded-xl border border-border bg-surface', className ?? 'p-4')}>
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
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="mr-auto min-w-0">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {count !== undefined && <span className="text-xs text-muted tabular">{count}</span>}
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
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
      <h2 className="text-[0.9375rem] font-medium">{title}</h2>
      {hint && <span className="mr-auto text-2xs text-muted">{hint}</span>}
      {!hint && <span className="mr-auto" />}
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border py-14 text-center">
      <p className="text-sm text-fg-2">{title}</p>
      {children && <p className="mt-1 text-xs text-muted">{children}</p>}
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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[94vw] -translate-x-1/2 -translate-y-1/2',
            'flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl shadow-black/50',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              <Dialog.Title className="text-[0.9375rem] font-semibold">{title}</Dialog.Title>
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
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/40 px-5 py-3">
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
    <TabsPrimitive.List className="inline-flex gap-0.5 rounded-lg bg-surface p-0.5">
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'rounded-[0.3rem] px-3 py-1.5 text-xs text-muted transition',
        'hover:text-fg-2 data-[state=active]:bg-surface-2 data-[state=active]:text-fg',
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}
