import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-surface-border px-6 py-16 text-center ${className ?? ''}`}
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-slate-500 dark:text-slate-400">
        <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
      </span>
      <div>
        <p className="font-display text-lg text-slate-900 dark:text-slate-50">{title}</p>
        {description ? (
          <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
