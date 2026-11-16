import { fmt, pct } from '../lib/icr'
import type { Trove } from './useTrove'
import type { useLimits } from './useLimits'

const WHY = { cap: 'the per-draw cap', budget: 'the budget left', floor: 'your floor' } as const
const str = (v: bigint) => fmt(v, 18, 2).replace(/,/g, '')

/** Max-safe chip plus a plain explanation of the two different limits: the floor (trove health) and the per-draw cap (app policy). */
export function Limits({ t, l, onPick }: { t: Trove; l: ReturnType<typeof useLimits>; onPick: (s: string) => void }) {
  // Round 8 (J2 LOW-4): a retained floor after a Governor-batch failure
  // must not drive the chip or the pre-fill — the floor is unknown, not the
  // last good value. Return null when the Governor batch is unknown.
  if (t.gvError || t.gvSlotError) return null
  // Round 8 (J3 L4): when `safe` is undefined because the policy/fee read
  // failed, the chip and pre-fill silently vanish — render an explicit
  // "unavailable" signal instead of nothing. (No error: the Governor may
  // simply be missing or the app unauthorized — still null, as before.)
  // Round 9 (J3 M3): a failed batch (transport error, retained data) is
  // the same unknown — the line surfaces it.
  if (!l.safe) {
    if (l.feeError || l.polError || l.isError) return <p data-testid="limits-unavailable" className="mt-2 text-xs text-signal">Draw limits unavailable — the policy or fee read failed, so the max safe draw is unknown.</p>
    return null
  }
  const { max, limit } = l.safe
  return (
    <div data-testid="limits" className="mt-2 text-xs space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-full border border-magenta/50 text-magenta px-3 py-1 mono hover:bg-magenta/10" onClick={() => onPick(str(max))}>
          Max safe: {fmt(max)} MUSD
        </button>
        <span className="text-muted">limited by {WHY[limit]}</span>
      </div>
      <p className="text-muted leading-relaxed">
        <b className="text-ink">Floor</b> {t.floor ? pct(t.floor) : '—'}: your ratio must stay at or above it after the draw and Mezo's fee
        ({l.floorRoom !== undefined ? `${fmt(l.floorRoom)} MUSD of room` : '—'}).{' '}
        <b className="text-ink">Per-draw cap</b>: the most this app may take in one draw{l.perDraw !== undefined ? ` (${fmt(l.perDraw)} MUSD` : ''}
        {l.remaining !== undefined ? `, ${fmt(l.remaining)} MUSD budget left)` : l.perDraw !== undefined ? ')' : ''}; you set it on Apps.
        {!l.authorized && ' This app has no budget yet, so the Governor will refuse it.'}
      </p>
    </div>
  )
}
