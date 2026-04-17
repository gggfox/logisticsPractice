import { useState } from 'react'
import { Toaster } from 'sonner'
import { Sidebar } from './components/Sidebar'
import { CallHistoryPage } from './pages/CallHistoryPage'
import { CarrierIntelPage } from './pages/CarrierIntelPage'
import { LiveFeedPage } from './pages/LiveFeedPage'
import { LoadBoardPage } from './pages/LoadBoardPage'
import { NegotiationPage } from './pages/NegotiationPage'
import { OverviewPage } from './pages/OverviewPage'

type Page = 'overview' | 'live' | 'calls' | 'loads' | 'carriers' | 'negotiations'

const pages: Record<Page, () => JSX.Element> = {
  overview: OverviewPage,
  live: LiveFeedPage,
  calls: CallHistoryPage,
  loads: LoadBoardPage,
  carriers: CarrierIntelPage,
  negotiations: NegotiationPage,
}

export function App() {
  const [currentPage, setCurrentPage] = useState<Page>('overview')
  const [darkMode, setDarkMode] = useState(false)

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
    document.documentElement.classList.toggle('dark')
  }

  const PageComponent = pages[currentPage]

  return (
    <div className="flex h-full">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
      />
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        <PageComponent />
      </main>
      <Toaster position="top-right" richColors />
    </div>
  )
}
