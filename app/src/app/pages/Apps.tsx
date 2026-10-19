import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useReadContract, useWriteContract } from 'wagmi'
import { isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { Card, Empty, NeedsWallet, TxStatus, useTx } from '../kit'
import { useTrove } from '../useTrove'
import { governorAbi } from '../../lib/abi'
import { fmt } from '../../lib/icr'
import { useApiList } from '../api'

export default function Apps() {
  const t = useTrove()
  const [params] = useSearchParams()
  const [lookup, setLookup] = useState(params.get('app') ?? '')
  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Apps</h1><p className="text-muted mt-2 max-w-2xl">Give an app a budget it can draw from your trove. It can never take more than the budget, more than one draw cap, or anything below your floor.</p></header>
      <NeedsWallet what="manage app budgets">
        {!t.governor ? <Empty title="No Governor yet">Create your Governor on Home first. Budgets live on it.</Empty> : (
          <div className="grid lg:grid-cols-2 gap-8">
            <Authorize governor={t.governor} preset={params.get('app') ?? ''} presetAmount={params.get('amount')} />
            <div className="space-y-6">
              <Card title="Check an app">
                <input aria-label="App address" placeholder="0x… app address" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} className="mono text-sm border border-ink/30 bg-paper px-3 py-2 w-full" />
                {isAddress(lookup) && <Policy governor={t.governor} app={lookup} />}
              </Card>
              <RequestList borrower={t.address} />
            </div>
          </div>
        )}
      </NeedsWallet>
    </div>
  )
}

function Policy({ governor, app }: { governor: Address; app: Address }) {
  const { data, refetch } = useReadContract({ address: governor, abi: governorAbi, functionName: 'appPolicy', args: [app] })
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  if (!data) return null
  const [budget, spent, perDraw, expiry, payee] = data
  if (expiry === 0n) return <p className="text-sm text-muted mt-4">No budget for this app.</p>
  const expired = Number(expiry) * 1000 < Date.now()
  return (
    <div className="mt-4 text-sm space-y-1">
      <div>Budget <b className="mono">{fmt(budget)}</b> MUSD · spent <b className="mono">{fmt(spent)}</b> · per draw <b className="mono">{fmt(perDraw)}</b></div>
      <div>Expires {new Date(Number(expiry) * 1000).toLocaleString()} {expired && <b className="text-signal">(expired)</b>}</div>
      <div>Payee {payee === zeroAddress ? 'any' : <span className="mono text-xs">{payee}</span>}</div>
      <button className="pill-ghost mt-3" onClick={async () => { await tx.run(() => writeContractAsync({ address: governor, abi: governorAbi, functionName: 'removeApp', args: [app] })); refetch() }}>Remove app</button>
      <TxStatus tx={tx} />
    </div>
  )
}

function Authorize({ governor, preset, presetAmount }: { governor: Address; preset: string; presetAmount: string | null }) {
  const [app, setApp] = useState(preset)
  const [budget, setBudget] = useState(presetAmount ? fmt(BigInt(presetAmount)).replace(/,/g, '') : '100')
  const [cap, setCap] = useState('50')
  const [days, setDays] = useState('7')
  const [payee, setPayee] = useState('')
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  let err = ''
  try {
    if (!isAddress(app)) err = 'Enter the app address.'
    else if (payee && !isAddress(payee)) err = 'Payee must be an address or empty.'
    else if (parseUnits(cap, 18) === 0n || parseUnits(cap, 18) > parseUnits(budget, 18)) err = 'Per-draw cap must be above zero and at most the budget.'
    else if (!(+days > 0)) err = 'Expiry must be in the future.'
  } catch { err = 'Amounts must be numbers.' }
  const f = 'mono text-sm border border-ink/30 bg-paper px-3 py-2 w-full mt-1'
  return (
    <Card title="Approve an app">
      <div className="grid gap-4">
        <label className="caps text-[11px] text-muted">App address<input className={f} value={app} onChange={(e) => setApp(e.target.value.trim())} placeholder="0x…" /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="caps text-[11px] text-muted">Budget (MUSD)<input className={f} value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" /></label>
          <label className="caps text-[11px] text-muted">Per draw<input className={f} value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" /></label>
          <label className="caps text-[11px] text-muted">Days<input className={f} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></label>
        </div>
        <label className="caps text-[11px] text-muted">Payee lock (optional)<input className={f} value={payee} onChange={(e) => setPayee(e.target.value.trim())} placeholder="any payee" /></label>
        {err && <p className="text-xs text-muted">{err}</p>}
        <button className="pill self-start" disabled={!!err || tx.phase === 'signing' || tx.phase === 'pending'} onClick={() => tx.run(() => writeContractAsync({
          address: governor, abi: governorAbi, functionName: 'authorizeApp',
          args: [app as Address, parseUnits(budget, 18), parseUnits(cap, 18), BigInt(Math.floor(Date.now() / 1000) + Math.round(+days * 86400)), (payee || zeroAddress) as Address],
        }))}>Approve</button>
      </div>
      <TxStatus tx={tx} />
    </Card>
  )
}

function RequestList({ borrower }: { borrower?: string }) {
  const q = useApiList<{ id: number; app_address: string; amount: string; status: string; reason?: string }>('requests', borrower ? `/v1/requests?borrower=${borrower}` : null)
  return (
    <Card title="Requests">
      {q.state === 'off' && <p className="text-sm text-muted">Apps can post draw requests through the Sternpost API. It is not configured on this deployment.</p>}
      {q.state === 'error' && <p className="text-sm text-signal">API unreachable.</p>}
      {q.state === 'ok' && !q.items.length && <p className="text-sm text-muted">No requests yet.</p>}
      {q.items.map((r) => (
        <div key={r.id} className="py-3 border-t border-ink/15 text-sm flex justify-between gap-3">
          <span><span className="mono text-xs">{r.app_address.slice(0, 10)}…</span> asks <b>{fmt(BigInt(r.amount))} MUSD</b>{r.reason && <span className="text-muted"> · {r.reason}</span>}</span>
          <span className="caps text-[11px]">{r.status}</span>
        </div>
      ))}
    </Card>
  )
}
