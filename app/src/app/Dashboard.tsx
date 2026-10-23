import { useEffect } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NavLink, Route, Routes, Link, useLocation } from 'react-router-dom'
import { wagmiConfig } from './wagmi'
import { ConnectButton } from './kit'
import { Token } from '../ui/Token'
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
  ['draw', 'Draw', 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3'],
  ['pay', 'Pay', 'M3 7h16v12H3zM3 7l3-3h12v3M15 13h4'],
  ['apps', 'Apps', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  ['activity', 'Activity', 'M3 12h4l2-5 4 10 2-5h6'],
  ['revoke', 'Revoke', 'M12 3a9 9 0 100 18 9 9 0 000-18zM7 12h10'],
] as const

export default function Dashboard() {
  const home = /^\/app\/?$/.test(useLocation().pathname)
  // The contour background lives in index.html (painted before JS); use its soft dashboard variant while mounted.
  useEffect(() => {
    const bg = document.getElementById('hero-bg')
    if (!bg) return
    bg.className = 'dash-bg contours-soft'
    return () => { bg.className = 'hero-bg contours' }
  }, [])
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <div className="min-h-screen grain grid md:grid-cols-[240px_1fr]">
          <aside className="border-r border-ink/15 bg-paper/60 backdrop-blur-[2px] md:sticky md:top-0 md:h-screen flex md:flex-col">
            <Link to="/" className="flex items-center gap-3 px-6 py-6">
              <svg viewBox="0 0 32 32" className="w-9 h-9 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="16" cy="6" r="2.6" /><path d="M16 8.6V28M10 13h12M5 19c0 5 5 9 11 9s11-4 11-9M5 19l-2 2M5 19l3 1M27 19l2 2M27 19l-3 1" /></svg>
              <span><span className="display text-[30px] leading-none block">Sternpost</span>
                <span className="caps text-[9px] tracking-[.12em] whitespace-nowrap text-magenta block mt-1">Borrow. Spend. Govern.</span>
                <span className="caps text-[8px] text-muted block">on Mezo</span></span>
            </Link>
            <nav className="flex md:flex-col gap-1 p-3 md:px-5 overflow-x-auto" aria-label="Dashboard">
              {NAV.map(([to, label, d]) => (
                <NavLink key={label} to={'/app' + (to ? '/' + to : '')} end className={({ isActive }) => `flex items-center gap-4 px-4 py-3 rounded-xl text-[15px] transition ${isActive ? 'bg-ink text-paper shadow-[0_8px_20px_-10px_rgba(23,19,15,.7)]' : 'hover:text-magenta hover:bg-paper2/70'}`}>
                  {I(d)}{label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto p-5 hidden md:block">
              <a href="https://mezo.org" target="_blank" rel="noreferrer" className="plate rounded-xl p-4 flex flex-col gap-2 hover:border-magenta transition">
                <span className="flex items-center gap-3"><Token sym="MEZO" size={30} /><span className="text-xs leading-tight">Powered by<br /><b className="caps text-[12px]">Mezo</b></span></span>
                <span className="text-[11px] text-muted">Bitcoin-backed. Mezo-secured.</span>
              </a>
              <div className="text-[11px] text-muted mt-4">Sternpost v0.1.0 · <span className="text-magenta">Testnet</span> · chain 31611</div>
            </div>
          </aside>
          <main className="p-6 md:px-10 md:py-8 max-w-[1440px] w-full">
            <header className="flex flex-wrap items-start justify-between gap-6 mb-4">
              {home ? <div>
                <div className="caps text-[11px] tracking-[.24em] text-magenta">Chartroom</div>
                <h1 className="display text-5xl md:text-6xl leading-none mt-1">Dashboard</h1>
                <p className="text-muted mt-2">Borrow MUSD against BTC. Spend. Govern. All on Mezo.</p>
              </div> : <div className="caps text-[11px] tracking-[.24em] text-magenta pt-2">Chartroom</div>}
              <div className="flex items-start gap-6">
                <div className="text-sm hidden sm:block"><div>Sternpost · Chartroom</div><div className="flex items-center gap-2 text-magenta"><span className="w-2 h-2 rounded-full bg-signal" />Testnet live</div></div>
                <ConnectButton />
              </div>
            </header>
            <Routes>
              <Route index element={<Home />} />
              <Route path="apps" element={<Apps />} />
              <Route path="draw" element={<Draw />} />
              <Route path="pay" element={<Pay />} />
              <Route path="activity" element={<Activity />} />
              <Route path="revoke" element={<Revoke />} />
              <Route path="*" element={<div className="border border-dashed border-ink/25 p-10 text-center"><div className="caps text-[11px] text-magenta">404</div><h1 className="display text-4xl mt-1">No such dashboard page</h1><Link className="pill mt-6 inline-flex" to="/app">Back to Home</Link></div>} />
            </Routes>
          </main>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
