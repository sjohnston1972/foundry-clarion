// Vendored verbatim from Foundry Workspace (skills-foundry).
// Source: skills-foundry/src/components/ui.tsx @ 673b50c (repo HEAD 29ed077
// at vendoring time). Do not hand-edit to fix a failing drift test — re-vendor
// deliberately instead. See CLAUDE.md §14 and test/design-drift.test.ts.
// --- vendored verbatim below ---
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { TriangleAlert, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Card({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHead({
  title,
  hint,
  right,
  className,
}: {
  title: ReactNode
  hint?: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div>
        <h3 className="font-display text-[15px] font-semibold leading-tight text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'outline', size = 'md', className, ...props }: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap'
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-9 px-4 text-sm' }
  const variants = {
    primary:
      'text-white shadow-sm hover:brightness-95 bg-[var(--color-accent)] border border-transparent',
    outline: 'border border-line bg-surface text-ink-2 hover:bg-canvas',
    ghost: 'text-muted hover:bg-canvas hover:text-ink',
    danger: 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  }
  return <button className={cn(base, sizes[size], variants[variant], className)} {...props} />
}

export function Badge({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode
  className?: string
  tone?: 'neutral' | 'accent'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium',
        tone === 'accent'
          ? 'border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'border-line bg-canvas text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
      <div
        className={cn(
          'tabular mt-1 text-2xl font-semibold',
          accent ? 'text-[var(--color-accent)]' : 'text-ink',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'size-5 animate-spin rounded-full border-2 border-line border-t-[var(--color-accent)]',
        className,
      )}
    />
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="font-display text-sm font-semibold text-ink-2">{title}</div>
      {hint && <div className="max-w-sm text-sm text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Loader({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <Spinner /> {label || 'Loading…'}
    </div>
  )
}

/** Pulsing placeholder block — compose into table/grid shapes so heavy pages
 *  render their layout immediately instead of a centred spinner + layout shift. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-canvas', className)} aria-hidden />
}

/** A card of skeleton rows — the default loading state for table pages. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-5 py-4">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

/** Shown when a data fetch fails — replaces the "infinite spinner on error"
 *  pattern (a Loader that never resolves because `data` is undefined). */
export function ErrorState({ label, onRetry }: { label?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <TriangleAlert className="size-6 text-amber-500" />
      <div className="max-w-sm text-sm text-muted">{label || 'Couldn’t load this. Please try again.'}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas"
        >
          <RefreshCw className="size-3.5" /> Retry
        </button>
      )}
    </div>
  )
}
