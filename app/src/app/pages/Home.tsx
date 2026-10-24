import { Link } from 'react-router-dom'
import { useWriteContract } from 'wagmi'
import { forwardRef, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dial } from '../../ui/Dial'
import { Compass } from '../../ui/Compass'
import { RouteLines, type Link as RouteLink } from '../../ui/RouteLines'
import { DrawHero } from '../DrawHero'
import { Token } from '../../ui/Token'
import { Card, Empty, NeedsWallet, TxStatus, useTx } from '../kit'
import { useTrove } from '../useTrove'
import { fmt, pct, WAD } from '../../lib/icr'
import { STERNPOST } from '../../lib/chain'
import { factoryAbi } from '../../lib/abi'
import { addrUrl } from '../../lib/proofs'
import { useApiList } from '../api'

const toPct = (v?: bigint) => (v === undefined ? null : v >= 2n ** 200n ? 999 : Number((v * 10000n) / WAD) / 100)

export default function Home() {
  const t = useTrove()
  const host = useRef<HTMLDivElement>(null)
  const ship = useRef<HTMLDivElement>(null), dial = useRef<HTMLDivElement>(null), form = useRef<HTMLElement>(null)
  const sColl = useRef<HTMLDivElement>(null), sDebt = useRef<HTMLDivElement>(null), sRoute = useRef<HTMLDivElement>(null)
  const links = useMemo<RouteLink[]>(() => [
    { from: ship, fromEdge: 'right', to: dial, toEdge: 'left' },
    { from: ship, fromEdge: 'right', to: form, toEdge: 'left' },
    { from: sColl, fromEdge: 'top', to: ship, toEdge: 'bottom' },
    { from: sDebt, fromEdge: 'right', to: sRoute, toEdge: 'left' },
    { from: sRoute, fromEdge: 'top', to: form, toEdge: 'left' },
  ], [])
  const usd = (v?: bigint) => (v !== undefined && t.price ? `≈ $${fmt((v * t.price) / WAD)}` : '')
  return (
    <div>
      <div ref={host} className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px_260px] xl:grid-rows-[auto_auto]">
        <RouteLines host={host} links={links} />
        {/* Stern + compass */}
        <div ref={ship} className="relative xl:col-span-2 xl:row-start-1 aspect-[820/717] max-h-[440px] -mt-6 pointer-events-none" aria-hidden>
          <picture>
            <source media="(max-width: 700px)" srcSet="/art/stern-ship-640.webp" />
            <img src="/art/stern-ship.webp" alt="" width={820} height={717} fetchPriority="high" className="w-full h-full object-contain object-left" />
          </picture>
          <div className="absolute" style={{ left: '27%', top: '19%', width: '24%' }}><Compass /></div>
        </div>
        {/* Dial */}
        <div className="xl:col-start-3 xl:row-start-1 flex flex-col items-center">
          <div className="caps text-[11px] tracking-[.24em] mb-2">Collateral ratio</div>
          <div ref={dial}><Dial value={t.hasTrove ? toPct(t.icr) : null} floor={toPct(t.floor) ?? undefined} size={240} /></div>
          <div className="text-[11px] text-muted mt-1">Liquidation floor · 110%</div>
        </div>
        {/* Stats */}
        <div className="xl:col-start-1 xl:row-start-2 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 self-start relative z-10 min-w-0">
          <StatCard ref={sColl} icon="M12 3v14M7 8h10M5 14a7 7 0 0014 0M12 17v4" k="Collateral" v={t.coll !== undefined ? `${fmt(t.coll, 18, 6)} BTC` : '—'} sub={usd(t.coll)} />
          <StatCard ref={sDebt} icon="M12 3a9 9 0 100 18 9 9 0 000-18zM15 9l-2 5-4 1 2-5z" k="Debt" v={t.debt !== undefined ? `${fmt(t.debt)} MUSD` : '—'} sub={t.debt !== undefined ? `≈ $${fmt(t.debt)}` : ''} />
          <StatCard ref={sRoute} icon="M4 18c4 0 4-12 8-12s4 12 8 12M4 18h0M20 18h0" k="Spend route"
            v={t.governor ? (t.frozen ? 'Frozen' : 'Governed') : t.isConnected ? 'No Governor' : '—'}
            sub={t.governor ? <span className="text-magenta">Trove → Governor → Payee</span> : 'Floor not set'} />
        </div>
        {/* Hero form */}
        <div className="xl:col-start-2 xl:row-start-2 xl:-mt-56 relative z-10">
          <DrawHero ref={form} t={t} />
        </div>
        {/* Route & Position */}
        <aside className="xl:col-start-3 xl:row-start-2 self-start relative z-10 plate rounded-xl p-5 text-sm space-y-3">
          <div className="caps text-[11px] tracking-[.24em]">Route &amp; Position</div>
          <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${t.isConnected ? 'bg-signal animate-pulse' : 'bg-ink/30'}`} />{t.isConnected ? 'Live · every 15 s' : 'Not connected'}</div>
          <Row k="Plotted course" v={t.governor ? <a className="ink-link text-magenta mono text-xs" href={addrUrl(t.governor)} target="_blank" rel="noreferrer">Governor {t.governor.slice(0, 6)}…{t.governor.slice(-4)}</a> : '—'} />
          <Row k="Collateral" v={t.coll !== undefined ? `${fmt(t.coll, 18, 6)} BTC` : '—'} />
          <Row k="Debt" v={t.debt !== undefined ? `${fmt(t.debt)} MUSD` : '—'} />
          <Row k="Floor" v={t.floor ? pct(t.floor) : '—'} />
          <Row k="Standby heal" v={t.standby?.[3] ? `${fmt(t.standby[0])} MUSD armed` : 'not armed'} />
          <Row k="Mezo nonce" v={t.nonce !== undefined ? String(t.nonce) : '—'} />
        </aside>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-8 mt-14 cv-auto">
        <div>
          <h2 className="display text-3xl mb-4">Ledger</h2>
          <NeedsWallet what="read your trove">
            {!t.loading && !t.hasTrove && <Empty title="No trove on this wallet">Open a trove at <a className="ink-link" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org</a>, then come back to set a floor.</Empty>}
            {t.hasTrove && (
              <Card title="Wallet balances">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {([['BTC', t.balances.btc, 6], ['MUSD', t.balances.musd, 2], ['sMUSD', t.balances.smusd, 2], ['MEZO', t.balances.mezo, 2]] as const).map(([s, v, d]) => (
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
                  <div>Status: {t.frozen ? <b className="text-signal">frozen</b> : <b className="text-safe">active</b>}</div></div>
              : <p className="text-sm text-muted">None yet. Create one to set a floor and hand out bounded budgets.</p>}
          </Card>
          <Requests borrower={t.address} />
        </aside>
      </div>
    </div>
  )
}

const StatCard = forwardRef<HTMLDivElement, { icon: string; k: string; v: ReactNode; sub?: ReactNode }>(function StatCard({ icon, k, v, sub }, ref) {
  return (
    <div ref={ref} className="plate rounded-xl p-4 min-w-0 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-18px_rgba(163,32,79,.6)]">
      <div className="caps text-[10px] tracking-[.2em] flex items-center gap-2">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d={icon} /></svg>{k}
      </div>
      <div className="display text-[clamp(1.15rem,1.6vw,1.5rem)] leading-tight mt-2 break-words">{v}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  )
})

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="border-t border-ink/15 pt-2"><div className="text-[11px] text-muted">{k}</div><div className="mono text-[13px]">{v}</div></div>
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
          <Link to={`/app/apps?app=${r.app_address}&amount=${r.amount}&request=${r.id}`} className="pill">Review</Link>
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
