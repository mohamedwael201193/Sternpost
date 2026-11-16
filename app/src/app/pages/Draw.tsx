import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useReadContract } from 'wagmi'
import { isAddress, parseUnits, zeroAddress, type Address } from 'viem'
import { Gauge } from '../../ui/Gauge'
import { Skeleton } from '../../ui/Skeleton'
import { BtcSignNote, Card, ConnectButton, Empty, NeedsWallet, TxStatus, useIsBtcAccount } from '../kit'
import { useTrove } from '../useTrove'
import { RPC_ERROR_TEXT, useAccount as useAccountData, useViewedAccount } from '../useAccount'
import { MIN_LEFT_S, useDrawSend } from '../useDrawSend'
import { borrowerOpsAbi, governorAbi } from '../../lib/abi'
import { MEZO } from '../../lib/chain'
import { REASONS, WAD, icrPct as toPct, isNoDebtIcr, pct, demoIcrLabel, projectedIcr } from '../../lib/icr'
import { DRAW_WINDOW_S } from '../../lib/sig'
import { addrUrl } from '../../lib/proofs'
import { useLimits } from '../useLimits'
import { Limits } from '../Limits'
import { fmt } from '../../lib/icr'

export default function Draw() {
  const t = useTrove()
  const viewed = useViewedAccount()
  const demo = viewed.demoMode
  // L6: hold the demo preview on a skeleton while wagmi reconnects — the
  // demo numbers are not settled yet. An explicit ?account= preview shows
  // at once.
  const holdDemo = demo && viewed.reconnecting && viewed.source !== 'param'
  const acct = useAccountData(demo ? viewed.address : undefined)
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)
  const [app, setApp] = useState('')
  const [payee, setPayee] = useState('')
  const appAddr = (isAddress(app) ? app : t.address ?? zeroAddress) as Address
  const payeeAddr = (isAddress(payee) ? payee : t.address ?? zeroAddress) as Address
  const wei = useMemo(() => { try { return parseUnits(amount || '0', 18) } catch { return 0n } }, [amount])

  const fee = useReadContract({ address: MEZO.borrowerOperations, abi: borrowerOpsAbi, functionName: 'getBorrowingFee', args: [wei], query: { enabled: wei > 0n } })
  const preview = useReadContract({ address: t.governor, abi: governorAbi, functionName: 'previewDraw', args: [appAddr, wei, payeeAddr], query: { enabled: !!t.governor, refetchInterval: 15_000 } })
  // LOW-1 (round 6): the local projection must never silently price the draw
  // with fee 0 — on a fee-read failure `fee.data ?? 0n` understates the fee
  // and overstates the after-draw ICR. A failed fee read fails the local
  // projection (the on-chain preview, when it returns, still rules).
  const feeError = fee.isError
  const local = !feeError && t.hasTrove && t.price ? projectedIcr(t.coll!, t.price, t.debt!, wei, fee.data ?? 0n) : undefined
  // MED-2 (round 4): TanStack Query v5 RETAINS data on error, so after one
  // successful preview a failed 15 s refetch would leave the stale success
  // in preview.data — the verdict would keep saying "Safe." and the Sign
  // button would stay enabled. Gate everything on isError: on error the
  // verdict, the button and the projection all act as if no preview exists.
  // LOW-1 (round 6): the projection is part of that gate — `icrAfter ??
  // local` fell back to the locally computed number beside the "Preview
  // failed" plate, so the After-draw gauge/number kept showing a stale
  // projection. On error the projection is undefined, full stop.
  const previewError = preview.isError
  const [ok, reason, icrAfter] = previewError ? [undefined, '', undefined] : preview.data ?? [undefined, '', undefined]
  const projected = previewError ? undefined : icrAfter ?? local
  const lim = useLimits(t, appAddr)
  useEffect(() => { if (!touched && lim.safe) setAmount(lim.safe.suggest > 0n ? fmt(lim.safe.suggest, 18, 2).replace(/,/g, '') : '') }, [touched, lim.safe?.suggest])
  const pick = (v: string) => { setTouched(true); setAmount(v) }

  return (
    <div className="space-y-8">
      <header><h1 className="display text-4xl">Draw</h1><p className="text-muted mt-2 max-w-2xl">See exactly where a draw leaves your trove before you sign. The Governor runs the same check on-chain and reverts anything below your floor.</p></header>
      <BtcSignNote className="max-w-2xl" />
      {demo ? (holdDemo ? (
        <Card>
          <div className="space-y-4"><Skeleton className="h-[250px] w-[250px] rounded-full mx-auto" label="Loading trove position" /><Skeleton className="h-4 w-2/3 mx-auto" /></div>
        </Card>
      ) : <DemoDraw acct={acct} viewed={viewed} />) : (
      <NeedsWallet what="draw MUSD">
        {t.error ? <p className="text-sm text-signal" role="alert">{RPC_ERROR_TEXT}</p>
          : !t.hasTrove ? <Empty title="No trove on this wallet">Open one at testnet.mezo.org first.</Empty>
          : !t.governor ? <Empty title="No Governor yet">Create your Governor on Home to set a floor.</Empty> : (
          <div className="grid lg:grid-cols-[1fr_420px] gap-8">
            <Card>
              <div className="grid sm:grid-cols-2 gap-6 justify-items-center">
                {/* LOW-3 (round 6): the own-account gauges must not assert
                    "No debt" on an unknown status — hasTrove counts
                    statusNum === undefined as active (useTrove), so a
                    zero-debt trove whose sys batch is pending/failed would
                    claim "No debt". Gate the label on troveStatus === 1,
                    mirroring the Home Dial (round 5); unknown renders
                    "Unavailable" instead. */}
                <div className="text-center"><Gauge value={toPct(t.icr)} floor={toPct(t.floor) ?? undefined} size={250} label="Current" emptyLabel={isNoDebtIcr(t.icr) ? (t.troveStatus === 1 ? 'No debt' : 'Unavailable') : undefined} /></div>
                <div className="text-center"><Gauge value={toPct(t.icr)} projected={toPct(projected)} floor={toPct(t.floor) ?? undefined} size={250} label="After draw" emptyLabel={isNoDebtIcr(t.icr) ? (t.troveStatus === 1 ? 'No debt' : 'Unavailable') : undefined} /></div>
              </div>
              <div className="grid grid-cols-2 text-center mt-4">
                <div><div className="caps text-[11px] text-muted">Now</div><div className="display text-3xl">{t.icr === undefined ? '—' : isNoDebtIcr(t.icr) ? demoIcrLabel(t.icr, t.troveStatus) : pct(t.icr)}</div></div>
                <div><div className="caps text-[11px] text-muted">After draw + fee</div><div className={`display text-3xl ${ok ? 'text-safe' : 'text-signal'}`} data-testid="draw-after">{projected && wei > 0n ? pct(projected, projected < WAD * 10n ? 1 : 0) : '—'}</div></div>
              </div>
              <Verdict ok={ok} reason={reason} loading={preview.isLoading} error={previewError} />
            </Card>
            <Sign t={t} wei={wei} app={appAddr} payee={payeeAddr} ok={!!ok}
              limits={<Limits t={t} l={lim} onPick={pick} />} fields={{ amount, setAmount: pick, app, setApp, payee, setPayee }} />
          </div>
        )}
      </NeedsWallet>
      )}
    </div>
  )
}

/** Read-only Draw for demo mode: the demo trove's live position, no signing. */
function DemoDraw({ acct, viewed }: { acct: ReturnType<typeof useAccountData>; viewed: ReturnType<typeof useViewedAccount> }) {
  const a = acct.data
  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-8">
      <Card>
        {acct.isLoading ? (
          <div className="space-y-4"><Skeleton className="h-[250px] w-[250px] rounded-full mx-auto" label="Loading trove position" /><Skeleton className="h-4 w-2/3 mx-auto" /></div>
        ) : acct.isError ? (
          <p className="text-sm text-signal" role="alert">{RPC_ERROR_TEXT}</p>
        ) : a ? (
          <>
            <div className="grid sm:grid-cols-1 gap-6 justify-items-center">
              {/* LOW-2 (round 5): the Gauge gets toPct(a.icr) = null for a
                  zero-debt ICR, so without an emptyLabel it showed "—"
                  while "Now" next to it said "No debt" for a known
                  status-1 zero-debt trove — gauge and text now agree.
                  Any other status keeps the "—" default (the "Now" text
                  already says "No trove" / "Unavailable" there). */}
              <div className="text-center"><Gauge value={toPct(a.icr)} floor={toPct(a.floorICR ?? undefined) ?? undefined} size={250} label="Current" emptyLabel={a.troveStatus === 1 && isNoDebtIcr(a.icr) ? 'No debt' : undefined} /></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 text-center mt-4 gap-4">
              {/* MED-1 (round 4) + LOW-2 (round 5): the "Now" number must
                  never claim "No debt" for a no-trove / closed preview,
                  and the Gauge above now carries the same "No debt"
                  emptyLabel for a known status-1 zero-debt trove, so
                  gauge and text agree in both directions. */}
              <div><div className="caps text-[11px] text-muted">Now</div><div className="display text-3xl">{demoIcrLabel(a.icr, a.troveStatus)}</div></div>
              <div><div className="caps text-[11px] text-muted">Floor</div><div className="display text-3xl">{a.floorICR !== null ? pct(a.floorICR) : 'unknown'}</div></div>
              <div><div className="caps text-[11px] text-muted">Debt</div><div className="display text-3xl">{fmt(a.debt)} MUSD</div></div>
              <div><div className="caps text-[11px] text-muted">Collateral</div><div className="display text-3xl">{fmt(a.coll, 18, 4)} BTC</div></div>
            </div>
            <p className="mt-6 text-sm text-muted" role="status">
              Read-only preview of the demo account{' '}
              <a className="ink-link mono text-xs" href={addrUrl(viewed.address)} target="_blank" rel="noreferrer">{viewed.address.slice(0, 6)}…{viewed.address.slice(-4)}</a>.
              Drawing needs the owner wallet — the Governor check below runs on your own trove once you connect.
            </p>
          </>
        ) : <p className="text-sm text-muted">Account not readable.</p>}
      </Card>
      <Card title="Draw from your own trove">
        <p className="text-sm">Connect a wallet on Mezo testnet (chain 31611) to see where a draw leaves your trove before you sign. The Governor runs the same check on-chain and reverts anything below your floor.</p>
        <div className="mt-4"><ConnectButton /></div>
      </Card>
    </div>
  )
}

function Verdict({ ok, reason, loading, error }: { ok?: boolean; reason: string; loading: boolean; error?: boolean }) {
  // MED-2 / L-g (round 4): a failed preview is an error plate, never the
  // "Checking…" stall (never-succeeded case) and never the stale verdict
  // (success-then-error case) — the Sign button is disabled while error is
  // true because ok is forced undefined by the caller.
  if (error) return (
    <div role="alert" className="mt-6 border-l-2 border-signal pl-3">
      <b className="text-signal">Preview failed.</b>{' '}
      <span className="text-sm">{RPC_ERROR_TEXT} The preview retries automatically — do not sign on the last verdict.</span>
    </div>
  )
  if (loading || ok === undefined) return <p className="mt-6 text-sm text-muted">Checking with your Governor…</p>
  return (
    <div role="status" className={`mt-6 border-l-2 pl-3 ${ok ? 'border-safe' : 'border-signal'}`}>
      <b className={ok ? 'text-safe' : 'text-signal'}>{ok ? 'Safe.' : 'Unsafe.'}</b>{' '}
      <span className="text-sm">{ok ? 'Above your floor and inside the app budget (Governor.previewDraw).' : REASONS[reason] ?? reason}</span>
    </div>
  )
}

function Sign({ t, wei, app, payee, ok, fields, limits }: {
  limits: ReactNode
  t: ReturnType<typeof useTrove>; wei: bigint; app: Address; payee: Address; ok: boolean
  fields: { amount: string; setAmount: (s: string) => void; app: string; setApp: (s: string) => void; payee: string; setPayee: (s: string) => void }
}) {
  const { go: send, tx, bundle, err, step, deadline, skew, busy } = useDrawSend(t)
  const btcAcct = useIsBtcAccount()
  const self = app.toLowerCase() === t.address?.toLowerCase()
  const f = 'mono text-sm border border-ink/30 bg-paper px-3 py-2 w-full mt-1'
  const go = () => send(wei, app, payee)
  const sent = tx.phase === 'success' || tx.phase === 'reverted'
  return (
    <Card title="Sign the draw">
      <div className="grid gap-4">
        <label className="caps text-[11px] text-muted">Amount (MUSD)<input className={f} value={fields.amount} onChange={(e) => fields.setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>{limits}
        <label className="caps text-[11px] text-muted">App (submits the draw)<input className={f} value={fields.app} onChange={(e) => fields.setApp(e.target.value.trim())} placeholder="this wallet" /></label>
        <label className="caps text-[11px] text-muted">Payee<input className={f} value={fields.payee} onChange={(e) => fields.setPayee(e.target.value.trim())} placeholder="this wallet" /></label>
        <p className="text-xs text-muted">Two signatures: first a standby repay for the next nonce (valid 24 h), then a withdraw that can only pay your Governor. Mezo's withdraw window is short by design: the Governor rejects deadlines more than 120 s ahead, and this app uses {String(DRAW_WINDOW_S)} s counted from chain time at the moment you sign it. {self ? 'The draw transaction is sent right after the second signature; confirm it in your wallet before the countdown ends.' : 'Hand the bundle to the app before the countdown ends.'}</p>
        <button className="pill self-start" disabled={!ok || t.nonce === undefined || busy || btcAcct} onClick={go}>{self ? 'Sign & send' : 'Sign for app'}</button>
        {step && <p className="text-sm" role="status">{step}</p>}
        {deadline && !sent && !err && <Countdown deadline={deadline} skew={skew} />}
        {err && <p className="text-sm text-signal" role="alert">{err}</p>}
      </div>
      <TxStatus tx={tx} />
      {bundle && <div className="mt-4"><div className="caps text-[11px] text-muted mb-1">Hand this to the app</div><textarea readOnly className="mono text-[11px] w-full h-40 border border-ink/30 bg-paper p-2" value={bundle} /></div>}
    </Card>
  )
}

function Countdown({ deadline, skew }: { deadline: bigint; skew: bigint }) {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)) + skew)
  useEffect(() => { const i = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000)) + skew), 1000); return () => clearInterval(i) }, [skew])
  const left = Number(deadline - now)
  return (
    <p data-testid="countdown" className={`mono text-sm ${left < Number(MIN_LEFT_S) ? 'text-signal' : ''}`}>
      {left > 0 ? `Withdraw signature valid for ${left} s more (chain time).` : 'Withdraw signature has expired; a send now would revert. Press Sign & send again.'}
    </p>
  )
}
