'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ---------------------------------- Card ---------------------------------- */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border bg-[var(--surface)] shadow-[var(--shadow-sm)]',
        padded && 'p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------- Button --------------------------------- */

type ButtonProps = {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md';
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary:
      'bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)] border-transparent shadow-[var(--shadow-sm)]',
    secondary:
      'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] border-[var(--border-strong)]',
    ghost: 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface-2)] border-transparent',
    danger: 'bg-[var(--danger)] text-white hover:opacity-90 border-transparent',
    success: 'bg-[var(--success)] text-white hover:opacity-90 border-transparent',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Badge --------------------------------- */

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
    brand: 'bg-[var(--brand-soft)] text-[var(--brand)] border-transparent',
    success: 'bg-[var(--success-soft)] text-[var(--success)] border-transparent',
    warning: 'bg-[var(--warning-soft)] text-[var(--warning)] border-transparent',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)] border-transparent',
    info: 'bg-[var(--info-soft)] text-[var(--info)] border-transparent',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps the status strings used across the app to a consistent colour. */
export function statusTone(status: string): Tone {
  const map: Record<string, Tone> = {
    NEW: 'neutral',
    RESEARCHED: 'info',
    DRAFTING: 'info',
    GENERATING: 'info',
    PENDING_APPROVAL: 'warning',
    NEEDS_APPROVAL: 'warning',
    ACTIVE: 'brand',
    ENGAGED: 'success',
    REPLIED: 'success',
    APPROVED: 'success',
    SENT: 'success',
    WON: 'success',
    COMPLETED: 'neutral',
    STOPPED: 'neutral',
    REJECTED: 'neutral',
    LOST: 'danger',
    FAILED: 'danger',
    BOUNCED: 'danger',
    UNSUBSCRIBED: 'danger',
    POSITIVE: 'success',
    NEUTRAL: 'neutral',
    NEGATIVE: 'danger',
    HIGH: 'danger',
    MEDIUM: 'warning',
    LOW: 'neutral',
    PASS: 'success',
    REVISE: 'warning',
    BLOCK: 'danger',
    VERIFIED: 'success',
    UNVERIFIED: 'warning',
    CONTRADICTED: 'danger',
  };
  return map[status] ?? 'neutral';
}

export function humanStatus(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/* ---------------------------------- Input --------------------------------- */

const fieldBase =
  'w-full rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm outline-none transition-colors ' +
  'border-[var(--border-strong)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 ' +
  'disabled:opacity-60';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldBase, 'resize-y leading-relaxed', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldBase, 'cursor-pointer', props.className)} />;
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[var(--text)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

/* ---------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10 backdrop-blur-sm">
      <div
        className={cn(
          'animate-fade-in w-full rounded-xl border bg-[var(--surface)] shadow-[var(--shadow-lg)]',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------- Feedback -------------------------------- */

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-[var(--info-soft)] text-[var(--info)]',
    success: 'bg-[var(--success-soft)] text-[var(--success)]',
    warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
  };
  return (
    <div className={cn('rounded-lg px-3.5 py-3 text-[13px] leading-relaxed', tones[tone])}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      <div className="opacity-90">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-[var(--text-subtle)]">{icon}</div>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

/* ---------------------------------- Stat ---------------------------------- */

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  const accents: Record<Tone, string> = {
    neutral: 'text-[var(--text)]',
    brand: 'text-[var(--brand)]',
    success: 'text-[var(--success)]',
    warning: 'text-[var(--warning)]',
    danger: 'text-[var(--danger)]',
    info: 'text-[var(--info)]',
  };
  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium tracking-wide text-[var(--text-muted)] uppercase">
            {label}
          </p>
          <p className={cn('mt-1.5 text-[26px] leading-none font-semibold', accents[tone])}>
            {value}
          </p>
          {sub && <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{sub}</p>}
        </div>
        {icon && <div className="shrink-0 text-[var(--text-subtle)]">{icon}</div>}
      </div>
    </Card>
  );
}

/* ---------------------------------- Table --------------------------------- */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b px-3 py-2.5 text-left text-[12px] font-semibold tracking-wide text-[var(--text-muted)] uppercase',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('border-b px-3 py-3 align-middle', className)}>{children}</td>;
}
