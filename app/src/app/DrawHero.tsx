import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useReadContract } from 'wagmi'
import { motion, useReducedMotion } from 'motion/react'
import { parseUnits, type Address } from 'viem'
import { Link } from 'react-router-dom'
import { Token } from '../ui/Token'
import { ConnectButton, TxStatus } from './kit'
import type { Trove } from './useTrove'
import { useDrawSend } from './useDrawSend'
import { borrowerOpsAbi, governorAbi } from '../lib/abi'
import { MEZO } from '../lib/chain'
import { REASONS, WAD, fmt, maxSafeDraw, pct, projectedIcr } from '../lib/icr'
import { DRAW_WINDOW_S } from '../lib/sig'

const toPct = (v?: bigint) => (v === undefined ? undefined : v >= 2n ** 200n ? 999 : Number((v * 10000n) / WAD) / 100)
const LO = 100, HI = 500
const pos = (p?: number) => (p === undefined ? 0 : (Math.min(Math.max(p, LO), HI) - LO) / (HI - LO) * 100)

/** The dashboard hero: a single self-submitted draw with a live ratio preview and one Sign & send. */
export const DrawHero = forwardRef<HTMLElement, { t: Trove }>(function DrawHero({ t }, ref) {
  const reduce = useReducedMotion()
  const [amount, setAmount] = useState('10')
  const wei = useMemo(() => { try { return parseUnits(amount || '0', 18) } catch { return 0n } }, [amount])
  const self = (t.address ?? '0x0000000000000000000000000000000000000000') as Address
  const fee = useReadContract({ address: MEZO.borrowerOperations, abi: borrowerOpsAbi, functionName: 'getBorrowingFee', args: [wei], query: { enabled: wei > 0n } })
  const preview = useReadContract({ address: t.governor, abi: governorAbi, functionName: 'previewDraw', args: [self, wei, self], query: { enabled: !!t.governor && wei > 0n, refetchInterval: 15_000 } })
  const [ok, reason, icrAfter] = preview.data ?? [undefined, '', undefined]
  const local = t.hasTrove && t.price ? projectedIcr(t.coll!, t.price, t.debt!, wei, fee.data ?? 0n) : undefined
  const after = icrAfter ?? local
  const avail = t.hasTrove && t.price && t.floor ? maxSafeDraw(t.coll!, t.price, t.debt!, t.floor) : undefined
  const d = useDrawSend(t)
  const ready = t.isConnected && t.hasTrove && !!t.governor
  const cur = toPct(t.icr), aft = wei > 0n ? toPct(after) : cur, flo = toPct(t.floor)

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
          <input id="hero-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            className="display text-4xl bg-transparent outline-none w-full min-w-0" aria-describedby="hero-avail" />
          <span className="caps text-[12px]">MUSD</span>
        </div>
        <div id="hero-avail" className="flex justify-between mt-2 text-xs">
          <span className="text-muted">Fee {fee.data !== undefined ? `${fmt(fee.data, 18, 4)} MUSD` : '—'}</span>
          <span className="text-right"><span className="text-muted">Available above floor </span>
            {avail !== undefined
              ? <button className="mono text-magenta ink-link" onClick={() => setAmount(fmt(avail, 18, 2).replace(/,/g, ''))}>{fmt(avail)} MUSD</button>
              : <span className="mono">—</span>}
          </span>
        </div>

        <div className="caps text-[10px] text-muted mt-5">Live ratio preview</div>
        <div className="relative mt-2 h-2.5 rounded-full bg-ink/10 overflow-visible" role="img" aria-label={`Current ${cur ?? '—'}%, after draw ${aft ?? '—'}%, floor ${flo ?? '—'}%`}>
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ink via-[#A3204F] to-[#FF4D86]"
            initial={reduce ? false : { width: 0 }} animate={{ width: `${pos(cur)}%` }} transition={{ duration: 1, ease: [.2, .8, .2, 1] }} />
          {aft !== undefined && cur !== undefined && aft < cur && (
            <motion.div className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,rgba(23,19,15,.35)_0_3px,transparent_3px_6px)] rounded-r-full"
              animate={{ left: `${pos(aft)}%`, width: `${pos(cur) - pos(aft)}%` }} transition={{ type: 'spring', stiffness: 140, damping: 20 }} />
          )}
          {flo !== undefined && <div className="absolute -top-1.5 -bottom-1.5 w-[2px] bg-signal" style={{ left: `${pos(flo)}%` }} title="Floor" />}
        </div>
        <dl className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 mt-3 text-sm">
          <dt>Current</dt><dd className="mono text-magenta">{flo !== undefined ? `floor ${flo.toFixed(0)}%` : ''}</dd><dd className="mono text-right">{t.icr ? pct(t.icr) : '—'}</dd>
          <dt>After draw</dt><dd /><dd className={`mono text-right ${ok === false ? 'text-signal' : 'text-magenta'}`} data-testid="hero-after">{after && wei > 0n ? pct(after) : '—'}</dd>
        </dl>
        {ready && ok === false && <p role="status" className="mt-2 text-xs text-signal">Unsafe: {REASONS[reason] ?? reason}</p>}

        <div className="mt-5 flex items-center gap-4">
          {!t.isConnected ? <ConnectButton className="pill flex-1 justify-center py-3.5 text-[13px]" />
            : !ready ? <Link to="/app/draw" className="pill flex-1 justify-center py-3.5">{!t.hasTrove ? 'Open a trove on Mezo first' : 'Set your floor below'}</Link>
            : <button className="pill flex-1 justify-center py-3.5 text-[13px] disabled:opacity-50" disabled={!ok || d.busy || wei === 0n} onClick={() => d.go(wei, self, self)}>
                {d.busy ? 'Signing…' : 'Sign & send'} <span aria-hidden>→</span>
              </button>}
          <Ring deadline={d.deadline} skew={d.skew} active={!!d.deadline && !d.sent && !d.err} />
        </div>
        {d.step && <p className="text-xs mt-3" role="status">{d.step}</p>}
        {d.err && <p className="text-xs mt-3 text-signal" role="alert">{d.err}</p>}
        <TxStatus tx={d.tx} />
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
