import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { Card, Empty, NeedsWallet } from '../kit'
import { useTrove } from '../useTrove'
import { governorAbi } from '../../lib/abi'
import { API_URL, DEPLOY_BLOCK, STERNPOST } from '../../lib/chain'
import { fmt, pct } from '../../lib/icr'
import { txUrl } from '../../lib/proofs'

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

const describe = (name: string, a: any): string => {
  switch (name) {
    case 'Drawn': return `App ${a.app.slice(0, 8)}… drew ${fmt(a.amount)} MUSD, ICR after ${pct(a.icrAfter)}`
    case 'AppAuthorized': return `Approved ${a.app.slice(0, 8)}… for ${fmt(a.budget)} MUSD (${fmt(a.perDrawMax)} per draw)`
    case 'AppRemoved': return `Removed app ${a.app.slice(0, 8)}…`
    case 'Revoked': return a.nonceBurned ? `Revoked: nonce burned, now ${a.nonceAfter}` : 'Revoked: Governor frozen'
    case 'Unfrozen': return 'Governor unfrozen'
    case 'PolicySet': return `Floor set to ${pct(a.floorICR)}`
    case 'Healed': return `Healed ${fmt(a.amount)} MUSD, ICR ${pct(a.icrBefore)} → ${pct(a.icrAfter)}`
    case 'GovernorCreated': return `Governor ${String(a.governor ?? '').slice(0, 8)}… created`
    case 'SpendWalletCreated': return `Spend wallet ${String(a.wallet ?? '').slice(0, 8)}… created for agent ${String(a.agent ?? '').slice(0, 8)}…`
    case 'Armed': return `Standby repay armed for ${fmt(a.amount)} MUSD`
    default: return name
  }
}

export default function Activity() {
  const t = useTrove()
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
      return { rows, apiOk: api !== null }
    },
  })
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
            <ol>
              {q.data?.rows.map((l) => (
                <li key={`${l.tx}-${l.logIndex}`} className="py-3 border-t border-ink/15 grid grid-cols-[110px_1fr_auto] gap-4 text-sm items-baseline">
                  <span className="caps text-[11px] text-magenta">{l.event}</span>
                  <span>{describe(l.event, l.args)} <span className="caps text-[10px] text-muted">{[...l.src].join(' + ')}</span></span>
                  <a className="ink-link mono text-xs" href={txUrl(l.tx)} target="_blank" rel="noreferrer">#{String(l.block)}</a>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </NeedsWallet>
    </div>
  )
}
