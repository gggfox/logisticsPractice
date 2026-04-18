import type { ReactNode } from 'react'

type PageLayoutMode = 'scroll' | 'fixed'

interface PageLayoutProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  mode?: PageLayoutMode
  children: ReactNode
}

export function PageLayout({
  eyebrow,
  title,
  description,
  actions,
  mode = 'scroll',
  children,
}: PageLayoutProps) {
  const isFixed = mode === 'fixed'
  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${isFixed ? 'overflow-hidden' : ''}`}
      data-page-mode={mode}
    >
      <header className="flex shrink-0 flex-col gap-4 border-b border-surface-border/70 px-6 py-6 sm:flex-row sm:items-end sm:justify-between lg:px-10">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="mt-1 font-display text-4xl font-normal leading-[1.05] tracking-tight text-slate-900 dark:text-slate-50 sm:text-[40px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div
        className={
          isFixed
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-6 lg:px-10'
            : 'flex-1 overflow-y-auto px-6 py-8 lg:px-10'
        }
      >
        {children}
      </div>
    </section>
  )
}
