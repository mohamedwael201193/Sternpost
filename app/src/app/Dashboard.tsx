import { useEffect } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NavLink, Route, Routes, Link } from 'react-router-dom'
import { wagmiConfig } from './wagmi'
import { ConnectButton } from './kit'
import Home from './pages/Home'
import Apps from './pages/Apps'
import Draw from './pages/Draw'
import Pay from './pages/Pay'
import Activity from './pages/Activity'
import Revoke from './pages/Revoke'

const qc = new QueryClient()
const I = (d: string) => <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d={d} /></svg>
const NAV = [
  ['', 'Home', 'M3 11l9-7 9 7v9h-6v-6H9v6H3z'],
  ['apps', 'Apps', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  ['draw', 'Draw', 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3'],
  ['pay', 'Pay', 'M3 7h16v12H3zM3 7l3-3h12v3M15 13h4'],
  ['activity', 'Activity', 'M3 12h4l2-5 4 10 2-5h6'],
  ['revoke', 'Revoke', 'M12 3a9 9 0 100 18 9 9 0 000-18zM7 12h10'],
] as const

export default function Dashboard() {
  // The landing's pre-JS hero background lives in index.html; hide it while the dashboard is mounted.
  useEffect(() => {
    const bg = document.getElementById('hero-bg')
    if (!bg) return
    bg.style.display = 'none'
    return () => { bg.style.display = '' }
  }, [])
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <div className="min-h-screen grain contours-soft grid md:grid-cols-[240px_1fr]">
          <aside className="border-r border-ink/20 bg-paper/70 md:sticky md:top-0 md:h-screen flex md:flex-col">
            <Link to="/" className="display text-[34px] px-7 py-6 md:border-b border-ink/20">Sternpost</Link>
            <nav className="flex md:flex-col gap-1 p-3 md:p-5 overflow-x-auto" aria-label="Dashboard">
              {NAV.map(([to, label, d]) => (
                <NavLink key={label} to={'/app' + (to ? '/' + to : '')} end className={({ isActive }) => `flex items-center gap-4 px-3 py-3 caps text-[13px] ${isActive ? 'text-magenta bg-paper2' : 'hover:text-magenta'}`}>
                  {I(d)}{label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto p-6 hidden md:block text-xs text-muted">Mezo testnet · chain 31611<div className="mt-3"><ConnectButton /></div></div>
          </aside>
          <main className="p-6 md:p-10 max-w-[1200px] w-full">
            <div className="md:hidden mb-4"><ConnectButton /></div>
            <Routes>
              <Route index element={<Home />} />
              <Route path="apps" element={<Apps />} />
              <Route path="draw" element={<Draw />} />
              <Route path="pay" element={<Pay />} />
              <Route path="activity" element={<Activity />} />
              <Route path="revoke" element={<Revoke />} />
            </Routes>
          </main>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
