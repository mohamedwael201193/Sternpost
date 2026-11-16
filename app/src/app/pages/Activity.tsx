import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { Card, Empty, NeedsWallet } from '../kit'
import { Skeleton } from '../../ui/Skeleton'
import { useTrove } from '../useTrove'
import { RPC_ERROR_TEXT, useAccount, useViewedAccount } from '../useAccount'
import { useAccountLogs } from '../useLogs'
import { governorAbi } from '../../lib/abi'
import { API_URL, DEPLOY_BLOCK, STERNPOST } from '../../lib/chain'
import { fmt, pct } from '../../lib/icr'
import { addrUrl, txUrl } from '../../lib/proofs'

type Row = { tx: `0x${string}`; logIndex: number; block: bigint; event: string; args: any; src: Set<'chain' | 'api'> }
const big = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : v]))

/** Ask the API indexer to catch up (it rate-limits to one sync per 10s), then read its rows for this Governor and the user's factory events. */
async function apiRows(governor: string, me: string): Promise<Row[]> {
  if (!API_URL) return []
  await fetch(`${API_URL}/v1/indexer/sync`, { method: 'POST' }).catch(() => null)
  const get = async (c: string) => ((await (await fetch(`${API_URL}/v1/activity?contract=${c.toLowerCase()}&limit=200`)).json()).activity ?? []) as any[]
  const [g, f] = await Promise.all([get(governor), STERNPOST.factory ? get(STERNPOST.factory) : Promise.resolve([])])
  const mine = f.filter((r) => [r.args?.borrower, r.args?.owner].some((x) => x?.toLowerCase() === me.toLowerCase()))
  return [...g, ...mine].map((r) => ({ tx: r.tx_hash, logIndex: Number(r.log_index), block: BigInt(r.block_number), event: r.event, args: big(r.args), src: new Set(['api' as const]) }))
}

const LABEL: Record<string, string> = {
  Drawn: 'Draw', Armed: 'Standby', AppAuthorized: 'App approved', AppRemoved: 'App removed', Revoked: 'Revoke',
  Unfrozen: 'Unfreeze', PolicySet: 'Floor', Healed: 'Heal', GovernorCreated: 'Setup', SpendWalletCreated: 'Spend wallet',
  Shielded: 'Shield', SessionOpened: 'Session', SessionRevoked: 'Session revoked', TroveOpened: 'Trove opened',
}
const RANK = ['Drawn', 'Healed', 'Revoked', 'AppAuthorized', 'AppRemoved', 'PolicySet', 'Unfrozen', 'GovernorCreated', 'SpendWalletCreated', 'Armed']
type Group = { tx: `0x${string}`; block: bigint; rows: Row[]; src: Set<string> }
/** One entry per transaction: a draw that also re-arms the standby is one action, not two. */
export function groupByTx(rows: Row[]): Group[] {
  const m = new Map<string, Group>()
  for (const r of rows) {
    const k = r.tx.toLowerCase()
    const g = m.get(k) ?? { tx: r.tx, block: r.block, rows: [], src: new Set() }
    g.rows.push(r); r.src.forEach((x) => g.src.add(x)); m.set(k, g)
  }
  const rank = (e: string) => { const i = RANK.indexOf(e); return i < 0 ? 99 : i }
  for (const g of m.values()) g.rows.sort((a, b) => rank(a.event) - rank(b.event) || a.logIndex - b.logIndex)
  return [...m.values()].sort((a, b) => (a.block === b.block ? 0 : a.block < b.block ? 1 : -1))
}

const describe = (name: string, a: any): string => {
  switch (name) {
    // Two Drawn shapes: the Governor's (app, payee, …) and the TroveAccount's (agent, payee, …) — v2 and v3.
    case 'Drawn': return a.app
      ? `App ${a.app.slice(0, 8)}… drew ${fmt(a.amount)} MUSD, ICR after ${pct(a.icrAfter)}`
      : `Agent ${String(a.agent ?? '').slice(0, 8)}… drew ${fmt(a.amount)} MUSD to ${String(a.payee ?? '').slice(0, 8)}…, ICR after ${pct(a.icrAfter)}`
    case 'AppAuthorized': return `Approved ${a.app.slice(0, 8)}… for ${fmt(a.budget)} MUSD (${fmt(a.perDrawMax)} per draw)`
    case 'AppRemoved': return `Removed app ${a.app.slice(0, 8)}…`
    case 'Revoked': return a.nonceBurned ? `Revoked: nonce burned, now ${a.nonceAfter}` : 'Revoked: Governor frozen'
    case 'Unfrozen': return 'Governor unfrozen'
    case 'PolicySet': return `Floor set to ${pct(a.floorICR)}`
    case 'Healed': return `Healed ${fmt(a.amount)} MUSD, ICR ${pct(a.icrBefore)} → ${pct(a.icrAfter)}`
    case 'GovernorCreated': return `Governor ${String(a.governor ?? '').slice(0, 8)}… created`
    case 'SpendWalletCreated': return `Spend wallet ${String(a.wallet ?? '').slice(0, 8)}… created for agent ${String(a.agent ?? '').slice(0, 8)}…`
    case 'Armed': return `standby repay re-armed for ${fmt(a.amount)} MUSD`
    case 'Shielded': return `Shield by ${String(a.keeper ?? '').slice(0, 8)}… repaid ${fmt(a.repaid)} MUSD${a.collAdded > 0n ? `, added ${fmt(a.collAdded, 18, 6)} BTC` : ''}, ICR ${pct(a.icrBefore)} → ${pct(a.icrAfter)}`
    case 'SessionOpened': return `Session opened for ${String(a.agent ?? '').slice(0, 8)}…`
    case 'TroveOpened': return `Trove opened: ${fmt(a.coll, 18, 6)} BTC, ${fmt(a.debt)} MUSD debt, ICR ${pct(a.icr)}`
    default: return name
  }
}

export default function Activity() {
  const t = useTrove()
  const viewed = useViewedAccount()
  const demo = viewed.demoMode
  // Demo mode: the logbook reads the demo account's own events from the chain (plan §6.2 ['logs', address]).
  const acct = useAccount(demo ? viewed.address : undefined)
  const logs = useAccountLogs(demo ? viewed.address : undefined, acct.data?.version)
  const client = usePublicClient()
  const q = useQuery({
    queryKey: ['activity', t.governor],
    enabled: !!t.governor && !!client,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [logs, api] = await Promise.all([
        client!.getContractEvents({ address: t.governor!, abi: governorAbi, fromBlock: DEPLOY_BLOCK }),
        apiRows(t.governor!, t.address!).catch(() => null),
      ])
      const m = new Map<string, Row>()
      for (const l of logs) m.set(`${l.transactionHash.toLowerCase()}-${l.logIndex}`, { tx: l.transactionHash, logIndex: l.logIndex, block: l.blockNumber, event: l.eventName, args: l.args, src: new Set(['chain']) })
      for (const r of api ?? []) { const k = `${r.tx.toLowerCase()}-${r.logIndex}`; const e = m.get(k); if (e) e.src.add('api'); else m.set(k, r) }
      const rows = [...m.values()].sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block < b.block ? 1 : -1))
      return { rows: groupByTx(rows), apiOk: api !== null }
    },
  })
  if (demo) {
    const rows = logs.data?.rows ?? []
    return (
      <div className="space-y-8">
        <header><h1 className="display text-4xl">Activity</h1><p className="text-muted mt-2">Every event the demo account emitted, read from Mezo testnet.</p></header>
        <Card>
          {logs.isLoading && <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>}
          {logs.isError && <p className="text-sm text-signal">{RPC_ERROR_TEXT}</p>}
          {logs.data && !rows.length && <p className="text-sm text-muted">No events yet on this account.</p>}
          <ol data-testid="activity">
            {rows.map((r) => (
              <li key={`${r.tx}-${r.logIndex}`} className="py-3 border-t border-ink/15 grid grid-cols-1 sm:grid-cols-[120px_1fr_auto] gap-x-4 gap-y-1 text-sm items-baseline">
                <span className="caps text-[11px] text-magenta">{LABEL[r.event] ?? r.event}</span>
                <span className="min-w-0 break-words">{describe(r.event, r.args)}</span>
                <span className="mono text-xs text-muted whitespace-nowrap">block {String(r.block)} · <a className="ink-link text-magenta" href={txUrl(r.tx)} target="_blank" rel="noreferrer" aria-label={`Transaction ${r.tx} on the Mezo explorer`}>tx {r.tx.slice(0, 8)}… ↗</a></span>
              </li>
            ))}
          </ol>
          {logs.data && <p className="text-xs text-muted mt-3">Scanned from block {String(logs.data.fromBlock)} · account <a className="ink-link mono" href={addrUrl(viewed.address)} target="_blank" rel="noreferrer">{viewed.address.slice(0, 6)}…{viewed.address.slice(-4)}</a></p>}
        </Card>
      </div>
    )
  }
  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Activity</h1><p className="text-muted mt-2">Every event your Governor emitted, read from Mezo testnet and merged with the Sternpost indexer.</p></header>
      <NeedsWallet what="see your activity">
        {!t.governor ? <Empty title="No Governor yet">Nothing to log until you create one on Home.</Empty> : (
          <Card>
            {q.isLoading && <p className="text-sm text-muted">Reading logs…</p>}
            {q.error && <p className="text-sm text-signal">Could not read logs from the RPC.</p>}
            {q.data && !q.data.rows.length && <p className="text-sm text-muted">No events yet.</p>}
            {q.data && !q.data.apiOk && <p className="text-xs text-muted mb-2">Indexer unreachable; showing chain logs only.</p>}
            <ol data-testid="activity">
              {q.data?.rows.map((g) => {
                const [head, ...rest] = g.rows
                return (
                  <li key={g.tx} className="py-3 border-t border-ink/15 grid grid-cols-1 sm:grid-cols-[120px_1fr_auto] gap-x-4 gap-y-1 text-sm items-baseline">
                    <span className="caps text-[11px] text-magenta">{LABEL[head.event] ?? head.event}</span>
                    <span className="min-w-0 break-words">
                      {describe(head.event, head.args)}{rest.map((r) => `; ${describe(r.event, r.args)}`).join('')}{' '}
                      <span className="caps text-[9px] text-muted">{[...g.src].join(' + ')}</span>
                    </span>
                    <span className="mono text-xs text-muted whitespace-nowrap">block {String(g.block)} · <a className="ink-link text-magenta" href={txUrl(g.tx)} target="_blank" rel="noreferrer" aria-label={`Transaction ${g.tx} on the Mezo explorer`}>tx {g.tx.slice(0, 8)}… ↗</a></span>
                  </li>
                )
              })}
            </ol>
          </Card>
        )}
      </NeedsWallet>
    </div>
  )
}
