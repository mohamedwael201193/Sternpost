import { Link } from 'react-router-dom'
import { useWriteContract } from 'wagmi'
import { useState } from 'react'
import { Gauge } from '../../ui/Gauge'
import { Token } from '../../ui/Token'
import { Card, Empty, NeedsWallet, Stat, TxStatus, useTx } from '../kit'
import { useTrove } from '../useTrove'
import { fmt, pct, WAD } from '../../lib/icr'
import { STERNPOST } from '../../lib/chain'
import { factoryAbi } from '../../lib/abi'
import { addrUrl } from '../../lib/proofs'
import { useApiList } from '../api'

const toPct = (v?: bigint) => (v === undefined ? null : v >= 2n ** 200n ? 999 : Number((v * 10000n) / WAD) / 100)

export default function Home() {
  const t = useTrove()
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-8">
      <div>
        <h1 className="display text-4xl mb-6">Trove health</h1>
        <div className="flex justify-center py-4">
          <Gauge value={t.hasTrove ? toPct(t.icr) : null} floor={toPct(t.floor) ?? undefined} size={360} />
        </div>
        <NeedsWallet what="read your trove">
          {!t.loading && !t.hasTrove && <Empty title="No trove on this wallet">Open a trove at <a className="ink-link" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org</a>, then come back to set a floor.</Empty>}
          {t.hasTrove && (
            <Card title="Your trove" className="mt-4">
              <div className="grid grid-cols-3 gap-6 pb-5 border-b border-ink/15">
                <Stat k="Collateral" v={`${fmt(t.coll!, 18, 4)} BTC`} sub={t.price ? `$${fmt((t.coll! * t.price) / WAD)}` : undefined} />
                <Stat k="Debt" v={`${fmt(t.debt!)} MUSD`} />
                <Stat k="Floor" v={t.floor ? pct(t.floor) : '—'} sub={t.governor ? 'enforced by your Governor' : 'no Governor yet'} />
              </div>
              <div className="grid grid-cols-3 gap-4 pt-5">
                {([['BTC', t.balances.btc, 6], ['MUSD', t.balances.musd, 2], ['sMUSD', t.balances.smusd, 2]] as const).map(([s, v, d]) => (
                  <div key={s} className="flex items-center gap-3"><Token sym={s} size={32} /><div><div className="text-sm">{s}</div><div className="mono text-sm">{v === undefined ? '—' : fmt(v, 18, d)}</div></div></div>
                ))}
              </div>
            </Card>
          )}
          {t.hasTrove && !t.governor && <CreateGovernor onDone={t.refetch} />}
        </NeedsWallet>
      </div>
      <aside className="space-y-6">
        <Card title="Governor">
          {t.governor
            ? <div className="text-sm space-y-2"><a className="ink-link mono text-xs break-all" href={addrUrl(t.governor)} target="_blank" rel="noreferrer">{t.governor}</a>
                <div>Status: {t.frozen ? <b className="text-signal">frozen</b> : <b className="text-safe">active</b>}</div>
                <div>Standby heal: {t.standby?.[3] ? `${fmt(t.standby[0])} MUSD armed` : 'not armed'}</div></div>
            : <p className="text-sm text-muted">None yet. Create one to set a floor and hand out bounded budgets.</p>}
        </Card>
        <Requests borrower={t.address} />
      </aside>
    </div>
  )
}

function Requests({ borrower }: { borrower?: string }) {
  const q = useApiList<{ id: number; app_address: string; amount: string; status: string; reason?: string }>('requests', borrower ? `/v1/requests?borrower=${borrower}` : null)
  return (
    <Card title="App requests" aside={<Link className="caps text-[11px] ink-link" to="apps">All</Link>}>
      {q.state === 'off' && <p className="text-sm text-muted">{borrower ? 'Request feed needs the Sternpost API.' : 'Connect a wallet to see requests from apps.'}</p>}
      {q.state === 'ok' && q.items.length === 0 && <p className="text-sm text-muted">No pending requests.</p>}
      {q.state === 'error' && <p className="text-sm text-signal">API unreachable.</p>}
      {q.items.slice(0, 3).map((r) => (
        <div key={r.id} className="flex items-center justify-between py-3 border-t border-ink/15">
          <div><div className="mono text-xs">{r.app_address.slice(0, 8)}…</div><div className="display text-lg">{fmt(BigInt(r.amount))} MUSD</div></div>
          <Link to={`apps?app=${r.app_address}&amount=${r.amount}`} className="pill">Review</Link>
        </div>
      ))}
    </Card>
  )
}

function CreateGovernor({ onDone }: { onDone: () => void }) {
  const [floor, setFloor] = useState(300)
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  const ok = floor >= 150 && floor <= 1000
  return (
    <Card title="Set your floor" className="mt-6">
      <p className="text-sm mb-4">Deploys your own Governor. Any draw that would take the trove below this ratio reverts on-chain.</p>
      <label className="caps text-[11px] text-muted" htmlFor="floor">Collateral floor (%)</label>
      <div className="flex gap-3 mt-2">
        <input id="floor" type="number" min={150} max={1000} value={floor} onChange={(e) => setFloor(+e.target.value)} className="mono border border-ink/30 bg-paper px-3 py-2 w-32" />
        <button className="pill" disabled={!ok || !STERNPOST.factory || tx.phase === 'signing' || tx.phase === 'pending'}
          onClick={async () => { if (await tx.run(() => writeContractAsync({ address: STERNPOST.factory!, abi: factoryAbi, functionName: 'createGovernor', args: [BigInt(floor) * WAD / 100n, BigInt(floor - 30) * WAD / 100n] }))) onDone() }}>
          Create Governor
        </button>
      </div>
      <p className="text-xs text-muted mt-2">Auto-defend triggers 30 points above liquidation risk, below your floor ({floor - 30}%).</p>
      <TxStatus tx={tx} />
    </Card>
  )
}
