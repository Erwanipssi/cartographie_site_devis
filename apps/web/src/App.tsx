import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Globe, History, LayoutDashboard, Menu, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthGate, LogoutButton } from './components/AuthGate'
import { api } from './lib/api'
import { Skeleton } from './components/ui'

// Chaque page est chargée à la demande : l'accueil n'attend pas les graphiques des autres pages.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((module) => ({ default: module[name] })))
const AnalysisPage = page(() => import('./pages/AnalysisPage'), 'AnalysisPage')
const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage')
const EvolutionPage = page(() => import('./pages/EvolutionPage'), 'EvolutionPage')
const HistoryPage = page(() => import('./pages/HistoryPage'), 'HistoryPage')
const HomePage = page(() => import('./pages/HomePage'), 'HomePage')
const PdfToFixPage = page(() => import('./pages/PdfToFixPage'), 'PdfToFixPage')
const SchedulesPage = page(() => import('./pages/SchedulesPage'), 'SchedulesPage')
const SiteDetailPage = page(() => import('./pages/SiteDetailPage'), 'SiteDetailPage')

const NAV = [
  { to: '/', label: 'Sites', icon: Globe, end: true },
  { to: '/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/historique', label: 'Historique', icon: History },
  { to: '/planifications', label: 'Planifications', icon: CalendarClock },
]

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
      <Toaster position="bottom-right" toastOptions={{ className: 'font-sans text-sm' }} />
    </AuthGate>
  )
}

function Logo() {
  return (
    <NavLink to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink-950">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-ink-950 text-white">
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
          <path d="M8.5 5.5h3.5a2 2 0 0 1 2 2v4" strokeLinecap="round" />
        </svg>
      </span>
      Cartographie
    </NavLink>
  )
}

/** État des services : un point vert quand tout tourne, sinon ce qui manque. */
function ServiceStatus() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15000 })
  const data = health.data
  const down = data ? [!data.db && 'base', !data.redis && 'Redis', !data.worker && 'worker'].filter(Boolean) : []
  const ok = data && down.length === 0
  return (
    <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-ink-600" title={data ? `SMTP ${data.smtp ? 'configuré' : 'non configuré'}` : undefined}>
      <span className="relative flex h-2 w-2">
        {ok ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-40" /> : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${!data ? 'bg-ink-400' : ok ? 'bg-pine' : 'bg-clay'}`} />
      </span>
      {!data ? 'Connexion…' : ok ? 'Services actifs' : `Arrêté : ${down.join(', ')}`}
    </div>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-0.5">
      {NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <item.icon className="h-4 w-4" aria-hidden />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

function Shell() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  // Accolades : les navigateurs récents font renvoyer une promesse à scrollTo, que React prendrait pour un nettoyage.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-line bg-card px-3 py-5 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <NavLinks />
        <div className="mt-auto space-y-1">
          <ServiceStatus />
          <LogoutButton />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-card/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button type="button" className="btn-ghost h-8 px-2" aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'} onClick={() => setOpen((value) => !value)}>
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </header>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-x-0 top-14 z-20 space-y-3 border-b border-line bg-card p-3 shadow-lg lg:hidden"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <NavLinks onNavigate={() => setOpen(false)} />
            <ServiceStatus />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
        <motion.div key={location.pathname} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </motion.div>
      </main>
    </div>
  )
}

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-32" />
      <Skeleton className="h-64" />
    </div>
  )
}
