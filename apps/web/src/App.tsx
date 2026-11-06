import { NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { AuthGate, LogoutButton } from './components/AuthGate'
import { AnalysisPage } from './pages/AnalysisPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { PdfToFixPage } from './pages/PdfToFixPage'
import { DashboardPage } from './pages/DashboardPage'
import { EvolutionPage } from './pages/EvolutionPage'
import { SchedulesPage } from './pages/SchedulesPage'
import { SiteDetailPage } from './pages/SiteDetailPage'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 font-medium transition-colors ${isActive ? 'bg-paper text-ink-950' : 'text-ink-600 hover:text-ink-950'}`

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/analyses/:id" element={<AnalysisPage />} />
          <Route path="/analyses/:id/sites/:analysisSiteId" element={<SiteDetailPage />} />
          <Route path="/analyses/:id/pdf-a-traiter" element={<PdfToFixPage />} />
          <Route path="/analyses/:id/sites/:analysisSiteId/evolution" element={<EvolutionPage />} />
          <Route path="/tableau-de-bord" element={<DashboardPage />} />
          <Route path="/historique" element={<HistoryPage />} />
          <Route path="/planifications" element={<SchedulesPage />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}

function Shell() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
          <NavLink to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink-950">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
              <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
              <path d="M8.5 5.5h3.5a2 2 0 0 1 2 2v4" strokeLinecap="round" />
            </svg>
            Cartographie
          </NavLink>
          <nav className="flex gap-1 text-sm">
            <NavLink to="/" end className={linkClass}>
              Sites
            </NavLink>
            <NavLink to="/tableau-de-bord" className={linkClass}>
              Tableau de bord
            </NavLink>
            <NavLink to="/historique" className={linkClass}>
              Historique
            </NavLink>
            <NavLink to="/planifications" className={linkClass}>
              Planifications
            </NavLink>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
