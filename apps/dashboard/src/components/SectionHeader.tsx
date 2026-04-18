import type { ReactNode } from 'react'

interface SectionHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}

export function SectionHeader({ eyebrow, title, description, actions }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="font-display text-[22px] leading-tight text-slate-900 dark:text-slate-50">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
