import { type ReactElement, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Sidebar } from './components/Sidebar'
import { CallHistoryPage } from './pages/CallHistoryPage'
import { CarrierIntelPage } from './pages/CarrierIntelPage'
import { LoadBoardPage } from './pages/LoadBoardPage'
import { NegotiationPage } from './pages/NegotiationPage'
import { OverviewPage } from './pages/OverviewPage'

type Page = 'overview' | 'calls' | 'loads' | 'carriers' | 'negotiations'

const pages: Record<Page, () => ReactElement> = {
  overview: OverviewPage,
  calls: CallHistoryPage,
  loads: LoadBoardPage,
  carriers: CarrierIntelPage,
  negotiations: NegotiationPage,
}

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('overview')
  const [darkMode, setDarkMode] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const toggleDarkMode = () => {
    setDarkMode((d) => {
      const next = !d
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
        setSidebarCollapsed((c) => !c)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const PageComponent = pages[currentPage]

  return (
    <div className="flex h-full bg-surface-0 text-slate-900 dark:text-slate-100">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        collapsed={sidebarCollapsed}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="page-main"
        >
          <ErrorBoundary key={currentPage}>
            <PageComponent />
          </ErrorBoundary>
        </main>
      </div>
      <Toaster position="top-right" richColors theme={darkMode ? 'dark' : 'light'} />
    </div>
  )
}
