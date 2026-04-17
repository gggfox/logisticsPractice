type Page = 'overview' | 'live' | 'calls' | 'loads' | 'carriers' | 'negotiations'

const navItems: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'live', label: 'Live Feed', icon: '🔴' },
  { id: 'calls', label: 'Call History', icon: '📞' },
  { id: 'loads', label: 'Load Board', icon: '🚚' },
  { id: 'carriers', label: 'Carriers', icon: '🏢' },
  { id: 'negotiations', label: 'Negotiations', icon: '💰' },
]

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  darkMode: boolean
  onToggleDarkMode: () => void
}

export function Sidebar({ currentPage, onNavigate, darkMode, onToggleDarkMode }: SidebarProps) {
  return (
    <aside
      className="flex w-64 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      data-testid="sidebar"
    >
      <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6 dark:border-gray-800">
        <span className="text-2xl">🤖</span>
        <h1 className="text-lg font-bold text-brand-700 dark:text-brand-400">Carrier Sales</h1>
      </div>

      <nav className="flex-1 space-y-1 p-4" data-testid="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`sidebar-nav-${item.id}`}
            onClick={() => onNavigate(item.id)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              currentPage === item.id
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4 dark:border-gray-800">
        <button
          type="button"
          onClick={onToggleDarkMode}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <span>{darkMode ? '☀️' : '🌙'}</span>
          {darkMode ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>
    </aside>
  )
}
