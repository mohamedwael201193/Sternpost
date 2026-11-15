import { useEffect, useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom'
import { wagmiConfig } from './wagmi'
import { ConnectButton } from './kit'
import { Token } from '../ui/Token'
import { NetBadge } from '../ui/NetBadge'
import Home from './pages/Home'
import Draw from './pages/Draw'
import Pay from './pages/Pay'
import Activity from './pages/Activity'
import Revoke from './pages/Revoke'
import Apps from './pages/Apps'
import Watch from './pages/Watch'
import Open from './pages/Open'
import Close from './pages/Close'

const qc = new QueryClient()
const I = (d: string) => <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d={d} /></svg>

/**
 * Shell navigation (plan §6.2). Muster roll (3.10) and Try-to-break-it (3.12)
 * have no verified data source yet, so their links are REMOVED, not stubbed —
 * a missing link beats a placeholder page.
 * Crew routes to the real Apps page (authorize + budgets); Watch, Open and
 * Close are real pages built from verified deployment + contract data.
 */
const NAV_MAIN = [
  ['', 'Bridge', 'M3 11l9-7 9 7v9h-6v-6H9v6H3z'],
  ['open', 'Open account', 'M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5'],
  ['crew', 'Crew', 'M4 6h16M4 12h16M4 18h10'],
  ['pay', 'Pay', 'M3 7h16v12H3zM3 7l3-3h12v3M15 13h4'],
  ['watch', 'Watch', 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 3'],
  ['logbook', 'Logbook', 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5'],
] as const

const NAV_CLASSIC = [
  ['classic', 'Classic', 'M3 11l9-7 9 7v9h-6v-6H9v6H3z'],
] as const

const NAV_EXIT = [
  ['close', 'Close / Revoke', 'M12 3a9 9 0 100 18 9 9 0 000-18zM7 12h10'],
] as const

const ALL_NAV = [...NAV_MAIN, ...NAV_CLASSIC, ...NAV_EXIT] as const

const PAGE_META: Record<string, { eyebrow: string; title: string; sub: string }> = {
  '': { eyebrow: 'Chartroom', title: 'Bridge', sub: 'Credit your agents can use. Your Bitcoin stays yours. Your crew spends. The ship defends itself.' },
  open: { eyebrow: 'Open account', title: 'Open a credit account', sub: 'Open a trove on Mezo, create your Governor on Bridge, then give your crew budgets — the live path today.' },
  crew: { eyebrow: 'Crew', title: 'Crew', sub: 'Agent session keys, signed on by you, spendable up to the budget you set.' },
  pay: { eyebrow: 'Pay', title: 'Pay', sub: 'Your agent pays x402 services by borrowing exactly the price, the moment it pays.' },
  watch: { eyebrow: 'Watch', title: 'Watch', sub: 'Buffer and Recovery Mode — live on testnet. Shield is in progress.' },
  logbook: { eyebrow: 'Logbook', title: 'Logbook', sub: 'Every on-chain event of this account, and the proof behind every claim.' },
  classic: { eyebrow: 'Classic', title: 'Classic', sub: 'The trove you already have. Every draw needs your signature, because Mezo allows one signature at a time.' },
  draw: { eyebrow: 'Classic', title: 'Draw', sub: 'Draw MUSD against the trove you already have.' },
  revoke: { eyebrow: 'Classic', title: 'Revoke', sub: 'Revoke an app or freeze the Governor.' },
  close: { eyebrow: 'Close / Revoke', title: 'Close / Revoke', sub: 'Revoke agents, or close the account and take everything back.' },
}

/** Scroll reset on in-app navigation (shell-owned, ported from task/quick-wins 2ea4a0f): the shell mounts
 * once for /app/*, so every inner route change scrolls the window back to the top —
 * headings must never arrive cut off. Mounted inside Dashboard, never in main.tsx. */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

/** Footer chain switcher (plan §6.2). Testnet is live; mainnet is a capped pilot, not started, and read-only — no mainnet deployment exists yet, so selecting it shows that plainly and switches nothing. */
function ChainSwitcher() {
  const [view, setView] = useState<'testnet' | 'mainnet'>('testnet')
  return (
    <div>
      <div className="flex border border-ink/25" role="group" aria-label="Chain">
        <button
          type="button"
          onClick={() => setView('testnet')}
          aria-pressed={view === 'testnet'}
          className={`caps flex-1 px-2 py-2 text-[10px] transition ${view === 'testnet' ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
        >
          Testnet 31611
        </button>
        <button
          type="button"
          onClick={() => setView('mainnet')}
          aria-pressed={view === 'mainnet'}
          className={`caps flex-1 px-2 py-2 text-[10px] transition ${view === 'mainnet' ? 'bg-magenta text-paper' : 'text-muted hover:text-ink'}`}
        >
          Mainnet 31612
        </button>
      </div>
      {view === 'mainnet' ? (
        <p role="note" className="mt-2 text-[11px] leading-relaxed text-muted">
          Mainnet: capped pilot, not started — read-only and fork-tested. No mainnet deployment exists yet, so there is no pilot data to show.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">Live on Mezo testnet. Every number is labelled with its network.</p>
      )}
    </div>
  )
}

function SidebarNav({ section, items }: { section?: string; items: readonly (readonly [string, string, string])[] }) {
  return (
    <>
      {section ? <div className="caps px-9 pt-4 text-[9px] text-muted">{section}</div> : null}
      <nav className="flex flex-col gap-1 py-2 px-5" aria-label={section ?? 'Dashboard'}>
        {items.map(([to, label, d]) => (
          <NavLink
            key={label}
            to={'/app' + (to ? '/' + to : '')}
            end
            className={({ isActive }) =>
              `flex items-center gap-4 px-4 py-3 text-[15px] transition ${isActive ? 'bg-ink text-paper' : 'hover:text-magenta hover:bg-paper2/70'}`
            }
          >
            {I(d)}
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}

export default function Dashboard() {
  const location = useLocation()
  const seg = location.pathname.replace(/^\/app\/?/, '').split('/')[0]
  const meta = PAGE_META[seg] ?? { eyebrow: 'Chartroom', title: 'Sternpost', sub: '' }
  const home = seg === ''
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
        <ScrollToTop />
        <div className="min-h-screen grain grid lg:grid-cols-[240px_1fr] overflow-x-clip">
          <aside className="hidden lg:flex flex-col border-r border-ink/15 bg-paper/60 backdrop-blur-[2px] sticky top-0 h-screen">
            <Link to="/" className="flex items-center gap-3 px-6 py-6">
              <svg viewBox="0 0 32 32" className="w-9 h-9 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="16" cy="6" r="2.6" /><path d="M16 8.6V28M10 13h12M5 19c0 5 5 9 11 9s11-4 11-9M5 19l-2 2M5 19l3 1M27 19l2 2M27 19l-3 1" /></svg>
              <span className="min-w-0"><span className="display text-[30px] leading-none block">Sternpost</span>
                <span className="caps text-[9px] tracking-[.08em] leading-snug text-magenta block mt-1">Borrow. Spend. Govern. on Mezo</span></span>
            </Link>
            <SidebarNav items={NAV_MAIN} />
            <SidebarNav section="Classic" items={NAV_CLASSIC} />
            <SidebarNav section="Exit" items={NAV_EXIT} />
            <div className="mt-auto p-5">
              <a href="https://t.me/sternpost_bot" target="_blank" rel="noreferrer" className="mb-3 block border border-ink/25 bg-paper/70 px-4 py-3 text-xs leading-relaxed transition hover:border-magenta">
                <span className="caps block text-[10px] text-magenta">@sternpost_bot</span>
                <span className="text-muted">Approvals and shield alerts on Telegram.</span>
              </a>
              <a href="https://mezo.org" target="_blank" rel="noreferrer" className="plate p-4 flex flex-col gap-2 hover:border-magenta transition">
                <span className="flex items-center gap-3"><Token sym="MEZO" size={30} /><span className="text-xs leading-tight">Powered by<br /><b className="caps text-[12px]">Mezo</b></span></span>
                <span className="text-[11px] text-muted">Bitcoin-backed. Mezo-secured.</span>
              </a>
              <div className="mt-4"><ChainSwitcher /></div>
              <div className="text-[11px] text-muted mt-4">Sternpost v0.9 · <span className="text-magenta">Testnet</span> · chain 31611</div>
            </div>
          </aside>
          <main className="min-w-0 px-4 pt-4 pb-28 sm:px-6 lg:px-10 lg:py-8 max-w-[1440px] w-full">
            <div className="lg:hidden flex items-center justify-between gap-3 mb-4">
              <Link to="/" className="flex items-center gap-2 min-w-0" aria-label="Sternpost home">
                <svg viewBox="0 0 32 32" className="w-7 h-7 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="16" cy="6" r="2.6" /><path d="M16 8.6V28M10 13h12M5 19c0 5 5 9 11 9s11-4 11-9" /></svg>
                <span className="display text-2xl leading-none">Sternpost</span>
              </Link>
              <NetBadge network="testnet" />
            </div>
            <header className="flex flex-wrap items-start justify-between gap-4 lg:gap-6 mb-4">
              {home ? <div>
                <div className="caps text-[11px] tracking-[.24em] text-magenta">Chartroom</div>
                <h1 className="display text-4xl sm:text-5xl lg:text-6xl leading-none mt-1">Bridge</h1>
                <p className="text-muted mt-2">Credit your agents can use. Your Bitcoin stays yours. Your crew spends. The ship defends itself.</p>
              </div> : <div>
                <div className="caps text-[11px] tracking-[.24em] text-magenta pt-2">{meta.eyebrow}</div>
                <h1 className="display text-4xl sm:text-5xl leading-none mt-1">{meta.title}</h1>
                {meta.sub ? <p className="text-muted mt-2 max-w-2xl">{meta.sub}</p> : null}
              </div>}
              <div className="flex items-start gap-6 ml-auto">
                <div className="text-sm hidden lg:block"><div>Sternpost · Chartroom</div><div className="flex items-center gap-2 text-magenta"><span className="w-2 h-2 rounded-full bg-signal" />Testnet live</div></div>
                <ConnectButton />
              </div>
            </header>
            <Routes>
              <Route index element={<Home />} />
              <Route path="open" element={<Open />} />
              <Route path="crew" element={<Apps />} />
              <Route path="pay" element={<Pay />} />
              <Route path="watch" element={<Watch />} />
              <Route path="logbook" element={<Activity />} />
              <Route path="classic" element={<Draw />} />
              <Route path="draw" element={<Draw />} />
              <Route path="revoke" element={<Revoke />} />
              <Route path="apps" element={<Navigate replace to="/app/crew" />} />
              <Route path="activity" element={<Navigate replace to="/app/logbook" />} />
              <Route path="close" element={<Close />} />
              <Route path="*" element={<div className="border border-dashed border-ink/25 p-10 text-center"><div className="caps text-[11px] text-magenta">404</div><h1 className="display text-4xl mt-1">No such dashboard page</h1><Link className="pill mt-6 inline-flex" to="/app">Back to Bridge</Link></div>} />
            </Routes>
          </main>
          <nav aria-label="Dashboard (mobile)" data-testid="bottom-nav" className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex overflow-x-auto border-t border-ink/15 bg-paper/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
            {ALL_NAV.map(([to, label, d]) => (
              <NavLink key={label} to={'/app' + (to ? '/' + to : '')} end className={({ isActive }) => `flex shrink-0 flex-col items-center gap-1 px-3 py-2.5 text-[10px] ${isActive ? 'text-magenta' : 'text-ink/70'}`}>
                {I(d)}<span className="whitespace-nowrap">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
