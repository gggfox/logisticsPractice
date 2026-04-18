import { Bell, Command, Search } from 'lucide-react'

interface TopbarProps {
  onToggleSidebar: () => void
}

export function Topbar({ onToggleSidebar }: TopbarProps) {
  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-surface-border/70 bg-surface-1/60 px-4 backdrop-blur-sm lg:px-6"
      data-testid="topbar"
    >
      <button
        type="button"
        onClick={onToggleSidebar}
        className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-surface-2 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:text-slate-400 dark:hover:text-slate-50 md:inline-flex"
        aria-label="Toggle sidebar"
        data-testid="topbar-toggle-sidebar"
      >
        <span aria-hidden className="flex flex-col gap-[3px]">
          <span className="h-[2px] w-4 rounded-full bg-current" />
          <span className="h-[2px] w-4 rounded-full bg-current" />
          <span className="h-[2px] w-4 rounded-full bg-current" />
        </span>
      </button>

      <button
        type="button"
        className="group flex h-9 max-w-xs flex-1 items-center gap-2 rounded-lg border border-surface-border/70 bg-surface-1 px-3 text-sm text-slate-500 shadow-sm transition hover:border-accent-500/40 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:text-slate-400 dark:hover:text-slate-50"
        aria-label="Search (not yet implemented)"
      >
        <Search className="h-4 w-4" strokeWidth={1.75} />
        <span className="flex-1 text-left">Search loads, carriers, calls…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-surface-border px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-400 sm:inline-flex">
          <Command className="h-3 w-3" strokeWidth={2} />K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-surface-2 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:text-slate-400 dark:hover:text-slate-50"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent-500" />
        </button>
        <div
          className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent-500 to-accent-700 font-display text-[13px] text-white"
          aria-label="Account"
        >
          AL
        </div>
      </div>
    </header>
  )
}
