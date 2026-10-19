import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { Card, Empty, NeedsWallet } from '../kit'
import { useTrove } from '../useTrove'
import { governorAbi } from '../../lib/abi'
import { DEPLOY_BLOCK } from '../../lib/chain'
import { fmt, pct } from '../../lib/icr'
import { txUrl } from '../../lib/proofs'

const describe = (name: string, a: any): string => {
  switch (name) {
    case 'Drawn': return `App ${a.app.slice(0, 8)}… drew ${fmt(a.amount)} MUSD, ICR after ${pct(a.icrAfter)}`
    case 'AppAuthorized': return `Approved ${a.app.slice(0, 8)}… for ${fmt(a.budget)} MUSD (${fmt(a.perDrawMax)} per draw)`
    case 'AppRemoved': return `Removed app ${a.app.slice(0, 8)}…`
    case 'Revoked': return a.nonceBurned ? `Revoked: nonce burned, now ${a.nonceAfter}` : 'Revoked: Governor frozen'
    case 'Unfrozen': return 'Governor unfrozen'
    case 'PolicySet': return `Floor set to ${pct(a.floorICR)}`
    case 'Healed': return `Healed ${fmt(a.amount)} MUSD, ICR ${pct(a.icrBefore)} → ${pct(a.icrAfter)}`
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
      const logs = await client!.getContractEvents({ address: t.governor!, abi: governorAbi, fromBlock: DEPLOY_BLOCK })
      return logs.reverse()
    },
  })
  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Activity</h1><p className="text-muted mt-2">Every event your Governor emitted, read straight from Mezo testnet.</p></header>
      <NeedsWallet what="see your activity">
        {!t.governor ? <Empty title="No Governor yet">Nothing to log until you create one on Home.</Empty> : (
          <Card>
            {q.isLoading && <p className="text-sm text-muted">Reading logs…</p>}
            {q.error && <p className="text-sm text-signal">Could not read logs from the RPC.</p>}
            {q.data && !q.data.length && <p className="text-sm text-muted">No events yet.</p>}
            <ol>
              {q.data?.map((l) => (
                <li key={`${l.transactionHash}-${l.logIndex}`} className="py-3 border-t border-ink/15 grid grid-cols-[110px_1fr_auto] gap-4 text-sm items-baseline">
                  <span className="caps text-[11px] text-magenta">{l.eventName}</span>
                  <span>{describe(l.eventName, l.args)}</span>
                  <a className="ink-link mono text-xs" href={txUrl(l.transactionHash)} target="_blank" rel="noreferrer">#{String(l.blockNumber)}</a>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </NeedsWallet>
    </div>
  )
}
