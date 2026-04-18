import { motion } from 'framer-motion'
import {
  Building2,
  Handshake,
  LayoutDashboard,
  type LucideIcon,
  Moon,
  PhoneCall,
  Radio,
  Sun,
  Truck,
} from 'lucide-react'

type Page = 'overview' | 'live' | 'calls' | 'loads' | 'carriers' | 'negotiations'

interface NavItem {
  id: Page
  label: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'live', label: 'Live Feed', icon: Radio },
  { id: 'calls', label: 'Call History', icon: PhoneCall },
  { id: 'loads', label: 'Load Board', icon: Truck },
  { id: 'carriers', label: 'Carriers', icon: Building2 },
  { id: 'negotiations', label: 'Negotiations', icon: Handshake },
]

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  darkMode: boolean
  onToggleDarkMode: () => void
  collapsed: boolean
}

export function Sidebar({
  currentPage,
  onNavigate,
  darkMode,
  onToggleDarkMode,
  collapsed,
}: SidebarProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="relative flex shrink-0 flex-col border-r border-surface-border/70 bg-surface-1/80 backdrop-blur-sm dark:bg-surface-1/60"
      data-testid="sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-surface-border/70 px-4">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 font-display text-[15px] italic leading-none text-accent-400 dark:bg-slate-50 dark:text-slate-900"
          aria-hidden
        >
          Cs
        </div>
        {collapsed ? null : (
          <div className="min-w-0">
            <p className="font-display text-base leading-none text-slate-900 dark:text-slate-50">
              Carrier Sales
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-400">Cockpit</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-4" data-testid="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`sidebar-nav-${item.id}`}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 ${
                isActive
                  ? 'bg-surface-2/80 text-slate-900 dark:bg-surface-2 dark:text-slate-50'
                  : 'text-slate-500 hover:bg-surface-2/60 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50'
              }`}
            >
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent-500"
                />
              ) : null}
              <Icon
                className="h-[18px] w-[18px] shrink-0"
                strokeWidth={isActive ? 2 : 1.75}
                aria-hidden
              />
              {collapsed ? null : <span className="truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-surface-border/70 p-2">
        <button
          type="button"
          onClick={onToggleDarkMode}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-surface-2/60 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:text-slate-400 dark:hover:text-slate-50"
          data-testid="sidebar-theme-toggle"
          aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {darkMode ? (
            <Sun className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          ) : (
            <Moon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          )}
          {collapsed ? null : <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>
      </div>
    </motion.aside>
  )
}
