import type { ReactNode } from 'react'

type BadgeVariant = 'outcome' | 'sentiment' | 'status' | 'plain'

interface BadgeProps {
  children: ReactNode
  className?: string
  variant?: BadgeVariant
  tone?: string
}

const OUTCOME_TONES: Record<string, string> = {
  booked:
    'bg-emerald-100 text-emerald-800 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  declined:
    'bg-rose-100 text-rose-800 ring-rose-200/60 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  no_match:
    'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20',
  transferred:
    'bg-sky-100 text-sky-800 ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  dropped:
    'bg-red-100 text-red-800 ring-red-200/60 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20',
}

const SENTIMENT_TONES: Record<string, string> = {
  positive:
    'bg-emerald-100 text-emerald-800 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  neutral:
    'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20',
  negative:
    'bg-amber-100 text-amber-800 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  frustrated:
    'bg-rose-100 text-rose-800 ring-rose-200/60 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
}

const STATUS_TONES: Record<string, string> = {
  available:
    'bg-emerald-100 text-emerald-800 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  in_negotiation:
    'bg-accent-100 text-accent-800 ring-accent-200 dark:bg-accent-500/10 dark:text-accent-300 dark:ring-accent-400/20',
  booked:
    'bg-sky-100 text-sky-800 ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  expired:
    'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-400/20',
}

const FALLBACK_TONE =
  'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20'

function resolveTone(variant: BadgeVariant | undefined, tone: string | undefined): string {
  if (!variant || variant === 'plain' || !tone) return FALLBACK_TONE
  const table =
    variant === 'outcome' ? OUTCOME_TONES : variant === 'sentiment' ? SENTIMENT_TONES : STATUS_TONES
  return table[tone] ?? FALLBACK_TONE
}

export function Badge({ children, className = '', variant, tone }: BadgeProps) {
  const variantClass = variant && variant !== 'plain' ? resolveTone(variant, tone) : ''
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${variantClass} ${className}`}
    >
      {children}
    </span>
  )
}
