import { useReadContract, useWriteContract } from 'wagmi'
import { parseUnits, type Address } from 'viem'
import { TxStatus, useTx } from './kit'
import type { Trove } from './useTrove'
import { governorAbi, routerAbi } from '../lib/abi'
import { ROUTER } from '../lib/chain'

/** Router allowance set by the one-time card: 200 MUSD total, 20 per draw, 60 days, payee = the router itself. */
export const ROUTE_BUDGET = parseUnits('200', 18)
export const ROUTE_PER_DRAW = parseUnits('20', 18)
export const ROUTE_DAYS = 60n
export const ALL_ROUTES = 7 // SAVE | SWAP | LOOP

/** Whether this borrower has authorized the router on their governor and enabled its routes. */
export function useRoutesReady(t: Trove) {
  const on = !!ROUTER && !!t.governor && !!t.address
  const pol = useReadContract({ address: t.governor, abi: governorAbi, functionName: 'appPolicy', args: [ROUTER as Address], query: { enabled: on } })
  const mask = useReadContract({ address: ROUTER, abi: routerAbi, functionName: 'routesOf', args: [t.address as Address], query: { enabled: on } })
  const p = pol.data as readonly [bigint, bigint, bigint, bigint, Address] | undefined
  const now = BigInt(Math.floor(Date.now() / 1000))
  const authorized = !!p && p[4]?.toLowerCase() === ROUTER?.toLowerCase() && p[3] > now && p[0] > p[1]
  const enabled = mask.data === ALL_ROUTES
  return { loaded: pol.isFetched && mask.isFetched, authorized, enabled, ready: authorized && enabled, refetch: () => { pol.refetch(); mask.refetch() } }
}

/** One-time setup so Save / Swap / Loop work from the app: authorize the router, then turn on its routes. Two txs. */
export function EnableRoutes({ t }: { t: Trove }) {
  const r = useRoutesReady(t)
  const { writeContractAsync } = useWriteContract()
  const auth = useTx(), routes = useTx()
  if (!ROUTER || !r.loaded || r.ready) return null
  const busy = [auth.phase, routes.phase].some((p) => p === 'signing' || p === 'pending')
  async function enable() {
    if (!r.authorized) {
      const expiry = BigInt(Math.floor(Date.now() / 1000)) + ROUTE_DAYS * 86400n
      const ok = await auth.run(() => writeContractAsync({ address: t.governor!, abi: governorAbi, functionName: 'authorizeApp', args: [ROUTER!, ROUTE_BUDGET, ROUTE_PER_DRAW, expiry, ROUTER!] }))
      if (!ok) return
    }
    if (!r.enabled) await routes.run(() => writeContractAsync({ address: ROUTER!, abi: routerAbi, functionName: 'setRoutes', args: [ALL_ROUTES] }))
    r.refetch()
  }
  return (
    <div className="mt-3 rounded-xl border border-magenta/40 bg-paper p-3 text-xs" data-testid="enable-routes">
      <p className="caps text-[10px] text-magenta">One-time setup</p>
      <p className="mt-1">Save, Swap and Loop go through the Sternpost router. Allow it once: up to 200 MUSD in total, 20 per draw, for 60 days. Everything it routes lands with you or in your trove.</p>
      <ol className="mt-2 space-y-0.5 text-muted">
        <li>{r.authorized ? '✓' : '1.'} Authorize the router on your Governor</li>
        <li>{r.enabled ? '✓' : '2.'} Turn on Save, Swap and Loop</li>
      </ol>
      <button className="pill mt-3 disabled:opacity-50" disabled={busy || !t.governor} onClick={enable}>Enable routes</button>
      <TxStatus tx={auth} /><TxStatus tx={routes} />
    </div>
  )
}
