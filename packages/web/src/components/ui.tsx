import * as Dialog from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Loader2, X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

/* --------------------------------- Button -------------------------------- */

type Variant = 'primary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-black hover:brightness-110 disabled:bg-surface-2 disabled:text-muted',
  outline: 'border border-border bg-transparent hover:bg-surface-2',
  ghost: 'bg-transparent hover:bg-surface-2',
  danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
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
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

/* --------------------------------- 输入类 -------------------------------- */

const FIELD =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none ' +
  'placeholder:text-muted focus:border-accent disabled:opacity-60';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(FIELD, 'h-8', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(FIELD, 'font-mono text-xs leading-relaxed', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(FIELD, 'h-8 cursor-pointer', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Checkbox({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      {...rest}
      className={cn('h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)]', className)}
    />
  );
}

/* --------------------------------- 展示类 -------------------------------- */

export function Badge({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      style={style}
      className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-none', className)}
    >
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-border bg-surface p-4', className)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-sm text-muted">{children}</div>;
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16 text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
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
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[92vw] -translate-x-1/2 -translate-y-1/2',
            'flex-col rounded-xl border border-border bg-bg shadow-2xl',
            wide ? 'max-w-5xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-0.5 text-xs text-muted">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
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
    <TabsPrimitive.List className="mb-3 inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="rounded px-3 py-1 text-xs text-muted transition data-[state=active]:bg-surface-2 data-[state=active]:text-fg"
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}
