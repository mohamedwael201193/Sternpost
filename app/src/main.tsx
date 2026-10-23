import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-mono/400.css'
import './index.css'
import Landing from './landing/Landing'

// Wallet libraries only load on /app, keeping the landing bundle small.
const Dashboard = lazy(() => import('./app/Dashboard'))

/** Old or guessed top-level links like /pay go to the matching dashboard page, keeping the query string. */
function ToApp() {
  const { pathname, search } = useLocation()
  return <Navigate replace to={`/app${pathname === '/dashboard' ? '' : pathname}${search}`} />
}

function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center p-8 text-center">
      <div>
        <div className="caps text-[11px] tracking-[.24em] text-magenta">404 · Off the chart</div>
        <h1 className="display text-5xl mt-2">No page at {useLocation().pathname}</h1>
        <p className="text-muted mt-3">The link may be old or mistyped.</p>
        <div className="mt-6 flex gap-3 justify-center"><Link className="pill" to="/app">Open the dashboard</Link><Link className="pill-ghost" to="/">Home</Link></div>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app/*" element={<Suspense fallback={<div className="p-10 display text-2xl">Opening the chartroom…</div>}><Dashboard /></Suspense>} />
        {['pay', 'apps', 'activity', 'revoke', 'draw', 'dashboard'].map((p) => <Route key={p} path={`/${p}/*`} element={<ToApp />} />)}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
