import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useReadContract } from 'wagmi'
import { motion, useReducedMotion } from 'motion/react'
import { parseUnits, type Address } from 'viem'
import { Link } from 'react-router-dom'
import { Token } from '../ui/Token'
import { BtcSignNote, ConnectButton, TxStatus, useIsBtcAccount } from './kit'
import type { Trove } from './useTrove'
import { useDrawSend, type Route } from './useDrawSend'
import { RPC_ERROR_TEXT } from './useAccount'
import { EnableRoutes, useRoutesReady } from './EnableRoutes'
import { useLimits } from './useLimits'
import { Limits } from './Limits'
import { borrowerOpsAbi, governorAbi } from '../lib/abi'
import { MEZO, ROUTER } from '../lib/chain'
import { REASONS, WAD, fmt, icrPct as toPct, isNoDebtIcr, demoIcrLabel, pct, projectedIcr } from '../lib/icr'
import { DRAW_WINDOW_S } from '../lib/sig'

const ROUTES: [Route, string, string][] = [
  ['keep', 'Keep', 'MUSD goes to your wallet.'],
  ['save', 'Save', 'MUSD goes into Mezo sMUSD savings; the shares are yours.'],
  ['swap', 'Swap', 'MUSD is swapped to BTC (1% max slippage) and sent to your wallet.'],
  ['loop', 'Loop', 'MUSD is swapped to BTC (1% max slippage) and added back as collateral. The app asks you to re-arm the standby right after.'],
]
const LO = 100, HI = 500
const pos = (p?: number | null) => (p === undefined || p === null ? 0 : (Math.min(Math.max(p, LO), HI) - LO) / (HI - LO) * 100)

/** The dashboard hero: a single self-submitted draw with a live ratio preview and one Sign & send. */
export const DrawHero = forwardRef<HTMLElement, { t: Trove }>(function DrawHero({ t }, ref) {
  const reduce = useReducedMotion()
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)
  const [route, setRoute] = useState<Route>('keep')
  const wei = useMemo(() => { try { return parseUnits(amount || '0', 18) } catch { return 0n } }, [amount])
  const self = (t.address ?? '0x0000000000000000000000000000000000000000') as Address
  const fee = useReadContract({ address: MEZO.borrowerOperations, abi: borrowerOpsAbi, functionName: 'getBorrowingFee', args: [wei], query: { enabled: wei > 0n } })
  const preview = useReadContract({ address: t.governor, abi: governorAbi, functionName: 'previewDraw', args: [self, wei, self], query: { enabled: !!t.governor && wei > 0n, refetchInterval: 15_000 } })
  // MED-2 (round 4): TanStack Query v5 RETAINS data on error — same fail-open
  // as Draw.tsx. Gate the verdict and the Sign button on isError so a failed
  // refetch never leaves a stale "Safe." with an enabled button. The error
  // plate only applies while a preview is actually running (wei > 0n).
  // LOW-1 (round 6): the projection is part of that gate — `icrAfter ??
  // local` fell back to the locally computed number beside the "Preview
  // failed" plate, so the After-draw bar/number kept showing a stale
  // projection. On error the projection is undefined, full stop. The fee
  // read gets the same treatment: on a fee-read failure the local projection
  // and the debt-after figure must not silently price the draw with fee 0.
  const previewError = preview.isError && wei > 0n
  const [ok, reason, icrAfter] = previewError ? [undefined, '', undefined] : preview.data ?? [undefined, '', undefined]
  const feeError = fee.isError
  // Round 7 (J2 F3): a fee read still LOADING is the same unknown as a
  // failed one — while fee.data is undefined the per-amount getBorrowingFee
  // query has not answered, so the local projection and the debt-after
  // figure wait instead of pricing the draw with fee 0 for ~one RPC
  // round-trip per keystroke. The on-chain icrAfter still rules once the
  // preview returns.
  const local = !feeError && fee.data !== undefined && t.hasTrove && t.price ? projectedIcr(t.coll!, t.price, t.debt!, wei, fee.data) : undefined
  const after = previewError ? undefined : icrAfter ?? local
  const lim = useLimits(t, t.address)
  // Start from a value the Governor will accept instead of a fixed number that may exceed the cap.
  useEffect(() => { if (!touched && lim.safe) setAmount(lim.safe.suggest > 0n ? fmt(lim.safe.suggest, 18, 2).replace(/,/g, '') : '') }, [touched, lim.safe?.suggest])
  const over = lim.safe && wei > lim.safe.max ? wei - lim.safe.max : 0n
  const debtAfter = !feeError && fee.data !== undefined && t.debt !== undefined && wei > 0n ? t.debt + wei + fee.data : undefined
  const d = useDrawSend(t)
  const routesReady = useRoutesReady(t)
  const blocked = route !== 'keep' && !routesReady.ready
  const btcAcct = useIsBtcAccount()
  const ready = t.isConnected && t.hasTrove && !!t.governor
  // Round 7 (hasTrove definition): hasTrove is false while the trove
  // status is unknown — the "Open a trove" link would flash for a real
  // zero-debt trove whose sys batch is still in flight. Hold on a disabled
  // button until the status is known or the core read proves coll 0.
  // Round 8 (J3 L5 + M5 + L6 + M2): a failed core read is NOT "checking"
  // (it failed — the hero must surface the error, below), a status value
  // outside the known 0–4 enum is NOT "checking" either (it settled
  // unknown — the hero must say "Unavailable", below), and a coll-0 /
  // debt>0 trove is NOT "no trove" (liquidatable, not non-existent).
  const statusOutOfRange = t.troveStatus !== undefined && (t.troveStatus < 0 || t.troveStatus > 4)
  const troveUnknown = !t.hasTrove && !t.troveStatusKnown && t.coll !== 0n && !statusOutOfRange && !t.error
  const noTroveKnown = !t.hasTrove && !t.coreSlotError && ((t.troveStatusKnown && t.troveStatus !== 1) || (t.coll === 0n && t.debt === 0n))
  // Round 8 (J3 M2): while governorOf is in flight a debt>0 trove has no
  // Governor yet — hold the "Set your floor below" CTA, which would lead
  // to Draw's false "No Governor yet" empty.
  const govUnknown = t.hasTrove && !t.governor && t.govLoading
  // Round 8 (J2 LOW-4): a retained floor after a Governor-batch failure
  // must not drive the gauge marker, the "floor X%" label or the "below
  // floor" suffix — the floor is unknown, not the last good value.
  const floorForDisplay = t.gvError || t.gvSlotError ? undefined : t.floor
  const cur = toPct(t.icr), aft = wei > 0n ? toPct(after) : cur, flo = toPct(floorForDisplay)

  return (
    <section ref={ref} aria-labelledby="draw-hero" className="glow-card rounded-2xl bg-[#FBF6EC] shadow-[0_30px_70px_-30px_rgba(163,32,79,.55)]">
      <div className="rounded-2xl bg-[#FBF6EC] p-6">
        <header className="flex items-center justify-between">
          <h2 id="draw-hero" className="caps text-[15px] tracking-[.28em] flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" /></svg>
            Draw MUSD
          </h2>
          <Link to="/app/draw" className="caps text-[10px] ink-link text-muted" title="Advanced: pay an app or another payee">Advanced</Link>
        </header>
        <p className="caps text-[10px] text-muted mt-2">Borrow MUSD against your BTC collateral</p>

        <label htmlFor="hero-amount" className="caps text-[10px] text-muted mt-5 block">Amount</label>
        <div className="mt-1 flex items-center gap-3 rounded-xl border border-ink/25 bg-paper px-4 py-3 focus-within:border-magenta focus-within:shadow-[0_0_0_3px_rgba(229,25,94,.15)] transition">
          <Token sym="MUSD" size={34} />
          <input id="hero-amount" inputMode="decimal" value={amount} onChange={(e) => { setTouched(true); setAmount(e.target.value.replace(/[^0-9.]/g, '')) }} placeholder="0.00"
            className="display text-4xl bg-transparent outline-none w-full min-w-0" aria-describedby="hero-avail" />
          <span className="caps text-[12px]">MUSD</span>
        </div>
        <div id="hero-avail" className="flex justify-between mt-2 text-xs">
          <span className="text-muted" data-testid="hero-fee">Mezo fee {feeError ? 'unavailable' : fee.data !== undefined && wei > 0n ? `${fmt(fee.data, 18, 4)} MUSD${lim.feeError ? '' : ` (${(Number((lim.feePerWad * 10000n) / WAD) / 100).toFixed(2)}%)`}` : '—'}</span>
          {over > 0n && <span className="text-signal" data-testid="hero-over">{fmt(over)} MUSD over max safe</span>}
        </div>
        <Limits t={t} l={lim} onPick={(v) => { setTouched(true); setAmount(v) }} />

        <div className="caps text-[10px] text-muted mt-5">Live ratio preview</div>
        <div className="relative mt-2 h-2.5 rounded-full bg-ink/10 overflow-visible" role="img" aria-label={`Current ${cur ?? '—'}%, after draw ${aft ?? '—'}%, floor ${flo ?? '—'}%`}>
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ink via-[#A3204F] to-[#FF4D86]"
            initial={reduce ? false : { width: 0 }} animate={{ width: `${pos(cur)}%` }} transition={{ duration: 1, ease: [.2, .8, .2, 1] }} />
          {aft != null && cur != null && aft < cur && (
            <motion.div className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,rgba(23,19,15,.35)_0_3px,transparent_3px_6px)] rounded-r-full"
              animate={{ left: `${pos(aft)}%`, width: `${pos(cur) - pos(aft)}%` }} transition={{ type: 'spring', stiffness: 140, damping: 20 }} />
          )}
          {flo != null && <div className="absolute -top-1.5 -bottom-1.5 w-[2px] bg-signal" style={{ left: `${pos(flo)}%` }} title="Floor" />}
        </div>
        <dl className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 mt-3 text-sm">
          {/* LOW-3 (round 6): the "Current" number must not assert "No debt"
              on an unknown status — hasTrove counts statusNum === undefined
              as active (useTrove), so a zero-debt own trove whose sys batch
              is pending/failed would claim "No debt" on the Home page
              itself. Gate the no-debt label on troveStatus === 1, mirroring
              the Home Dial (round 5). */}
          <dt>Current</dt><dd className="mono text-magenta">{flo != null ? `floor ${flo.toFixed(0)}%` : ''}</dd><dd className="mono text-right" data-testid="hero-current">{!t.icr ? '—' : isNoDebtIcr(t.icr) ? demoIcrLabel(t.icr, t.troveStatus) : pct(t.icr)}</dd>
          <dt>After draw</dt><dd /><dd className={`mono text-right ${ok === false ? 'text-signal' : 'text-magenta'}`} data-testid="hero-after">{after && wei > 0n ? `${pct(after, after < WAD * 10n ? 1 : 0)}${floorForDisplay && after < floorForDisplay ? ' · below floor' : ''}` : '—'}</dd>
          <dt>Debt after</dt><dd /><dd className="mono text-right" data-testid="hero-debt-after">{debtAfter !== undefined ? `${fmt(debtAfter)} MUSD` : '—'}</dd>
        </dl>
        {ROUTER && (
          <fieldset className="mt-5">
            <legend className="caps text-[10px] text-muted">Then</legend>
            <div role="radiogroup" className="mt-1 grid grid-cols-4 gap-1 rounded-xl border border-ink/20 p-1" data-testid="hero-route">
              {ROUTES.map(([k, label, hint]) => (
                <button key={k} type="button" role="radio" aria-checked={route === k} title={hint} onClick={() => setRoute(k)}
                  className={`rounded-lg py-2 text-xs caps transition ${route === k ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}>{label}</button>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-1">{ROUTES.find((r) => r[0] === route)![2]}</p>
            {ready && route !== 'keep' && <EnableRoutes t={t} />}
          </fieldset>
        )}
        {/* LOW-2 (round 6): the query is disabled at wei === 0n, so TanStack
            retains the last verdict after the amount is cleared — the stale
            "Unsafe" line kept rendering beside an empty amount field. Gate
            it on wei > 0n, like the error plate below it.
            Asymmetry, decided consciously: Draw.tsx shows its "Preview
            failed" plate at wei === 0n because its preview query runs
            regardless of amount (enabled: !!governor) — the plate is
            truthful there, the preview genuinely failed. The hero query
            only runs at wei > 0n, so at wei === 0n there is no preview to
            fail and no verdict to show. Each plate matches whether its own
            query actually ran. */}
        {ready && wei > 0n && ok === false && <p role="status" className="mt-2 text-xs text-signal">Unsafe: {REASONS[reason] ?? reason}{reason === 'OVER_PER_DRAW' && lim.perDraw !== undefined ? ` The cap is ${fmt(lim.perDraw)} MUSD.` : ''}</p>}
        {/* MED-2 / L-g (round 4): a failed preview is an error plate, never a
            stale verdict — and the Sign button below is disabled while ok is
            forced undefined by the error gate above. */}
        {ready && previewError && <p role="alert" className="mt-2 text-xs text-signal">Preview failed: {RPC_ERROR_TEXT} The preview retries automatically — do not sign on the last verdict.</p>}

        <div className="mt-5 flex items-center gap-4">
          {!t.isConnected ? <ConnectButton className="pill flex-1 justify-center py-3.5 text-[13px]" />
            // Round 8 (J3 L5): a failed core/Governor read surfaces the RPC
            // error in the hero itself — "Checking your trove…" would stall
            // forever on a read that already failed (Home's top plate
            // explains, the hero itself never did).
            : !ready ? (t.error ? <p role="alert" className="text-sm text-signal flex-1">{RPC_ERROR_TEXT}</p>
              : troveUnknown || govUnknown
              ? <button className="pill flex-1 justify-center py-3.5 text-[13px] disabled:opacity-50" disabled>Checking your trove…</button>
              : statusOutOfRange
              ? <button className="pill flex-1 justify-center py-3.5 text-[13px] disabled:opacity-50" disabled>Trove status Unavailable</button>
              : <Link to="/app/draw" className="pill flex-1 justify-center py-3.5">{noTroveKnown ? 'Open a trove on Mezo first' : 'Set your floor below'}</Link>)
            : <button className="pill flex-1 justify-center py-3.5 text-[13px] disabled:opacity-50" disabled={!ok || d.busy || wei === 0n || btcAcct || blocked} onClick={() => d.go(wei, self, self, route)}>
                {d.busy ? 'Signing…' : 'Sign & send'} <span aria-hidden>→</span>
              </button>}
          <Ring deadline={d.deadline} skew={d.skew} active={!!d.deadline && !d.sent && !d.err} />
        </div>
        {d.step && <p className="text-xs mt-3" role="status">{d.step}</p>}
        {d.err && <p className="text-xs mt-3 text-signal" role="alert">{d.err}</p>}
        <BtcSignNote className="mt-3" />
        <TxStatus tx={d.tx} />
        {d.rearmTx.phase !== 'idle' && <p className="caps text-[10px] text-muted mt-3">Re-arm standby</p>}
        <TxStatus tx={d.rearmTx} />
        {d.rearmTx.phase === 'success' && <p className="text-xs mt-2 text-safe" role="status">Standby re-armed at your new nonce. defend() can protect you again.</p>}
      </div>
    </section>
  )
})

/** Countdown ring: shows the full withdraw window before signing, then counts down in chain time. */
function Ring({ deadline, skew, active }: { deadline?: bigint; skew: bigint; active: boolean }) {
  const total = Number(DRAW_WINDOW_S)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000) + Number(skew))
  useEffect(() => { if (!active) return; const i = setInterval(() => setNow(Math.floor(Date.now() / 1000) + Number(skew)), 1000); return () => clearInterval(i) }, [active, skew])
  const left = active && deadline ? Math.max(0, Number(deadline) - now) : total
  const C = 2 * Math.PI * 22
  return (
    <div className="flex items-center gap-2 shrink-0" data-testid="hero-countdown">
      <span className="text-[11px] text-muted leading-tight text-right">Tx valid<br />for</span>
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 50 50" className="w-full h-full -rotate-90" aria-hidden>
          <circle cx="25" cy="25" r="22" fill="none" stroke="#17130F" strokeOpacity=".12" strokeWidth="2.5" />
          <circle cx="25" cy="25" r="22" fill="none" stroke={left < 45 ? '#FF004D' : '#E5195E'} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - left / total)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
        </svg>
        <span className="absolute inset-0 grid place-items-center mono text-sm">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
      </div>
    </div>
  )
}
