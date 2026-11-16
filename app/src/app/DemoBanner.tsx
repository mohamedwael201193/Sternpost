import { Link } from 'react-router-dom'
import { DEMO_ACCOUNT_BADGE } from '../lib/chain'
import { addrUrl } from '../lib/proofs'
import { useViewedAccount } from './useAccount'

/**
 * Thin banner on top of every app page in demo mode (plan §6.3, exact text).
 * Shows the viewed account (demo, or the ?account= preview) and the LAB
 * PROTOTYPE badge while the demo account is the lab fallback.
 */
export function DemoBanner() {
  const viewed = useViewedAccount()
  if (!viewed.demoMode) return null
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border border-brass/60 bg-brass/10 px-4 py-2 text-[13px] leading-relaxed">
      <span>
        {viewed.source === 'param'
          ? 'Read-only demo. These are real testnet values for the previewed account. Connect a wallet to open your own.'
          : 'Read-only demo. These are real testnet values for the public demo account. Connect a wallet to open your own.'}
      </span>
      {viewed.reconnectTimedOut && viewed.source === 'demo' && (
        <span className="text-muted">Wallet reconnect timed out — showing the public demo account.</span>
      )}
      {viewed.isLabPrototype && DEMO_ACCOUNT_BADGE && (
        <span className="caps rounded-sm border border-ink/40 px-2 py-0.5 text-[10px]">{DEMO_ACCOUNT_BADGE}</span>
      )}
      <a className="ink-link mono text-xs text-muted" href={addrUrl(viewed.address)} target="_blank" rel="noreferrer">
        {viewed.source === 'param' ? 'Previewing' : 'Demo account'} {viewed.address.slice(0, 6)}…{viewed.address.slice(-4)} ↗
      </a>
      <Link className="ink-link ml-auto text-xs" to="/app/open">Open a credit account →</Link>
    </div>
  )
}
