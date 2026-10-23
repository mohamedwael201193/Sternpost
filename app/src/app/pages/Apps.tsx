import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { Card, Empty, NeedsWallet, TxStatus, useTx } from '../kit'
import { useTrove } from '../useTrove'
import { governorAbi } from '../../lib/abi'
import { fmt } from '../../lib/icr'
import { DEPLOY_BLOCK } from '../../lib/chain'
import { addrUrl } from '../../lib/proofs'
import deployments from '../../../../shared/deployments/testnet.json'
import { useSetRequestStatus, useApiList } from '../api'

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
            <Authorize governor={t.governor} preset={params.get('app') ?? ''} presetAmount={params.get('amount')} requestId={params.get('request')} />
            <div className="space-y-6">
              <AuthorizedApps governor={t.governor} me={t.address} />
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

function Authorize({ governor, preset, presetAmount, requestId }: { governor: Address; preset: string; presetAmount: string | null; requestId: string | null }) {
  const [marked, setMarked] = useState<'' | 'ok' | 'fail'>('')
  const [app, setApp] = useState(preset)
  const [budget, setBudget] = useState(presetAmount ? fmt(BigInt(presetAmount)).replace(/,/g, '') : '100')
  const [cap, setCap] = useState('50')
  const [days, setDays] = useState('7')
  const [payee, setPayee] = useState('')
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  const setRequestStatus = useSetRequestStatus()
  useEffect(() => {
    if (tx.phase === 'success' && requestId && !marked) setRequestStatus(requestId, 'approved').then((ok) => setMarked(ok ? 'ok' : 'fail'))
  }, [tx.phase, requestId, marked])
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
      {requestId && <p className="text-xs text-muted mt-2">{marked === 'ok' ? `Request #${requestId} marked approved.` : marked === 'fail' ? `Request #${requestId} was not pending; its status is unchanged.` : `Approving this budget also marks request #${requestId} approved.`}</p>}
    </Card>
  )
}

function RequestList({ borrower }: { borrower?: string }) {
  const [tick, setTick] = useState(0)
  const setRequestStatus = useSetRequestStatus()
  const q = useApiList<{ id: number; app_address: string; amount: string; status: string; reason?: string }>('requests', borrower ? `/v1/requests?borrower=${borrower}&_=${tick}` : null)
  return (
    <Card title="Requests" aside={<span className="caps text-[10px] text-muted">posted by apps via the API</span>}>
      {q.state === 'off' && <p className="text-sm text-muted">Apps can post draw requests through the Sternpost API. It is not configured on this deployment.</p>}
      {q.state === 'error' && <p className="text-sm text-signal">API unreachable.</p>}
      {q.state === 'ok' && !q.items.length && <p className="text-sm text-muted">No pending requests from apps. Budgets you already granted are listed under Authorized apps.</p>}
      {q.items.map((r) => (
        <div key={r.id} className="py-3 border-t border-ink/15 text-sm flex justify-between gap-3">
          <span><span className="mono text-xs">{r.app_address.slice(0, 10)}…</span> asks <b>{fmt(BigInt(r.amount))} MUSD</b>{r.reason && <span className="text-muted"> · {r.reason}</span>}</span>
          {r.status === 'pending' ? (
            <span className="flex gap-2 shrink-0">
              <Link className="pill" to={`/app/apps?app=${r.app_address}&amount=${r.amount}&request=${r.id}`}>Review</Link>
              <button className="pill-ghost" onClick={async () => { await setRequestStatus(r.id, 'rejected'); setTick((n) => n + 1) }}>Reject</button>
            </span>
          ) : <span className="caps text-[11px]">{r.status}</span>}
        </div>
      ))}
    </Card>
  )
}

const D: any = deployments
const NAMES: Record<string, string> = Object.fromEntries(([
  [D.sternpost.SternpostRouter, 'Sternpost Router v2'], [D.sternpost.SternpostRouterV1, 'Sternpost Router v1'],
  [D.sternpost.spendWallet, 'Spend wallet'], [D.liveFlow?.app, 'Demo app'],
] as [string | undefined, string][]).filter(([a]) => a).map(([a, n]) => [a!.toLowerCase(), n]))

/** Every app that currently holds a budget on this Governor, found from AppAuthorized/AppRemoved logs and read live. */
function AuthorizedApps({ governor, me }: { governor: Address; me?: Address }) {
  const client = usePublicClient()
  const logs = useQuery({
    queryKey: ['authorized-apps', governor], enabled: !!client, refetchInterval: 30_000,
    queryFn: async () => {
      const ev = await client!.getContractEvents({ address: governor, abi: governorAbi, eventName: 'AppAuthorized', fromBlock: DEPLOY_BLOCK })
      return [...new Set(ev.map((e) => (e.args as { app: Address }).app.toLowerCase() as Address))]
    },
  })
  const apps = logs.data ?? []
  const pol = useReadContracts({ allowFailure: true, contracts: apps.map((a) => ({ address: governor, abi: governorAbi, functionName: 'appPolicy', args: [a] }) as const), query: { enabled: apps.length > 0 } })
  const rows = apps.map((a, i) => ({ a, p: pol.data?.[i]?.result as readonly [bigint, bigint, bigint, bigint, Address] | undefined })).filter((r) => r.p && r.p[3] > 0n)
  return (
    <Card title="Authorized apps" aside={<span className="caps text-[10px] text-muted">on your Governor</span>}>
      {(logs.isLoading || pol.isLoading) && <p className="text-sm text-muted">Reading your Governor…</p>}
      {logs.error && <p className="text-sm text-signal">Could not read Governor logs from the RPC.</p>}
      {logs.data && !pol.isLoading && !rows.length && <p className="text-sm text-muted">No app holds a budget right now.</p>}
      <ul data-testid="authorized-apps">
        {rows.map(({ a, p }) => <AppRow key={a} governor={governor} app={a} p={p!} self={a === me?.toLowerCase()} onDone={() => pol.refetch()} />)}
      </ul>
    </Card>
  )
}

function AppRow({ governor, app, p, self, onDone }: { governor: Address; app: Address; p: readonly [bigint, bigint, bigint, bigint, Address]; self: boolean; onDone: () => void }) {
  const [budget, spent, perDraw, expiry, payee] = p
  const { writeContractAsync } = useWriteContract()
  const tx = useTx()
  const [sure, setSure] = useState(false)
  const expired = Number(expiry) * 1000 < Date.now()
  const name = self ? 'This wallet (self draws)' : NAMES[app] ?? 'App'
  return (
    <li className="py-3 border-t border-ink/15 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span><b>{name}</b> <a className="ink-link mono text-xs text-muted" href={addrUrl(app)} target="_blank" rel="noreferrer">{app.slice(0, 6)}…{app.slice(-4)}</a></span>
        {!sure ? <button className="pill-ghost text-xs" onClick={() => setSure(true)}>Revoke</button> : (
          <span className="flex gap-2">
            <button className="pill text-xs" onClick={async () => { setSure(false); if (await tx.run(() => writeContractAsync({ address: governor, abi: governorAbi, functionName: 'removeApp', args: [app] }))) onDone() }}>Confirm revoke</button>
            <button className="pill-ghost text-xs" onClick={() => setSure(false)}>Cancel</button>
          </span>)}
      </div>
      <div className="mono text-xs mt-1 text-muted">
        budget {fmt(budget)} · remaining <b className="text-ink">{fmt(budget - spent)}</b> · per draw {fmt(perDraw)} MUSD · {expired ? <b className="text-signal">expired</b> : `expires ${new Date(Number(expiry) * 1000).toLocaleDateString()}`} · payee {payee === zeroAddress ? 'any' : `${payee.slice(0, 6)}…`}
      </div>
      <TxStatus tx={tx} />
    </li>
  )
}
