/** Pure ICR math mirrored from SternpostGovernor.projectedICR, all values as 1e18 fixed point. */
export const WAD = 10n ** 18n

export function icr(collBtc: bigint, price: bigint, debt: bigint): bigint {
  if (debt === 0n) return 2n ** 255n
  return (collBtc * price) / debt
}

/** Mezo borrowing fee is charged on top of every draw; `feeBps` is passed in from chain reads. */
export function projectedIcr(collBtc: bigint, price: bigint, debt: bigint, amount: bigint, fee: bigint): bigint {
  return icr(collBtc, price, debt + amount + fee)
}

/**
 * Fold a getEntireDebtAndColl tuple into the trove's collateral and debt.
 * Mezo already folds pending redistribution amounts into the first three returns, so the last three
 * slots (pendingCollateral, pendingPrincipal, pendingInterest) must NOT be added again — doing so
 * double-counts them (Classic bug C1–C3).
 */
export function troveTotals(t: readonly bigint[]): { coll: bigint; debt: bigint } {
  return { coll: t[0], debt: t[1] + t[2] }
}

export type DrawVerdict =
  | { ok: true; icrAfter: bigint }
  | { ok: false; icrAfter: bigint; reason: 'ZERO_AMOUNT' | 'BELOW_FLOOR' | 'OVER_BUDGET' | 'OVER_PER_DRAW' | 'FROZEN' | 'TROVE_CLOSED' | 'RECOVERY_MODE' }

export function judgeDraw(p: {
  coll: bigint; price: bigint; debt: bigint; amount: bigint; fee: bigint; floor: bigint
  remaining?: bigint; perDrawMax?: bigint; frozen?: boolean
  /** TroveManager status: 1 = active; anything else means the trove is closed. */
  troveStatus?: number; recoveryMode?: boolean
}): DrawVerdict {
  const icrAfter = projectedIcr(p.coll, p.price, p.debt, p.amount, p.fee)
  if (p.frozen) return { ok: false, reason: 'FROZEN', icrAfter }
  if (p.amount === 0n) return { ok: false, reason: 'ZERO_AMOUNT', icrAfter }
  if (p.troveStatus !== undefined && p.troveStatus !== 1) return { ok: false, reason: 'TROVE_CLOSED', icrAfter }
  if (p.recoveryMode) return { ok: false, reason: 'RECOVERY_MODE', icrAfter }
  if (p.perDrawMax !== undefined && p.amount > p.perDrawMax) return { ok: false, reason: 'OVER_PER_DRAW', icrAfter }
  if (p.remaining !== undefined && p.amount > p.remaining) return { ok: false, reason: 'OVER_BUDGET', icrAfter }
  if (icrAfter < p.floor) return { ok: false, reason: 'BELOW_FLOOR', icrAfter }
  return { ok: true, icrAfter }
}

/** Largest draw that keeps ICR >= floor, ignoring the fee (caller subtracts a margin). */
export function maxSafeDraw(coll: bigint, price: bigint, debt: bigint, floor: bigint): bigint {
  if (floor === 0n) return 0n
  const cap = (coll * price) / floor
  return cap > debt ? cap - debt : 0n
}

export function pct(v: bigint, digits = 0): string {
  // A zero-debt ICR is 2**255 by construction (see icr() above): it means the
  // trove owes nothing, so label it "No debt" — a bare infinity symbol explains nothing.
  if (v >= 2n ** 200n) return 'No debt'
  const n = Number((v * 10000n) / WAD) / 100
  return `${n.toFixed(digits)}%`
}

export function fmt(v: bigint, decimals = 18, digits = 2): string {
  const n = Number(v) / 10 ** decimals
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits > 2 ? 0 : digits })
}

export const REASONS: Record<string, string> = {
  ZERO_AMOUNT: 'Enter an amount above zero.',
  BELOW_FLOOR: 'This draw would push your trove below your safety floor. The Governor reverts it on-chain.',
  OVER_BUDGET: "This app's remaining budget is smaller than the draw.",
  OVER_PER_DRAW: "This is larger than the app's per-draw cap.",
  FROZEN: 'Your Governor is frozen after a revoke. Unfreeze before new draws.',
  APP_NOT_AUTHORIZED: 'This app has no budget on your Governor.',
  APP_EXPIRED: "This app's authorization has expired.",
  PAYEE_NOT_ALLOWED: 'The payee is not the one you approved for this app.',
  TROVE_CLOSED: 'This trove is closed (redeemed, liquidated, or closed by the owner). Draws are blocked.',
  RECOVERY_MODE: 'Mezo is in Recovery Mode (system health below 150%). Draws are paused until it recovers.',
}

export type DrawLimit = 'floor' | 'cap' | 'budget'
/**
 * Largest draw the Governor will accept: the per-draw cap, the app's remaining budget, and the floor
 * room after Mezo's fee (feePerWad = fee on 1 MUSD), less a 1% margin for price moves. Rounded down to cents.
 */
export function safeDraw(p: { floorRoom: bigint; feePerWad: bigint; perDraw?: bigint; remaining?: bigint }): { max: bigint; limit: DrawLimit; suggest: bigint } {
  const byFloor = ((p.floorRoom * WAD) / (WAD + p.feePerWad)) * 99n / 100n
  let max = byFloor, limit: DrawLimit = 'floor'
  if (p.perDraw !== undefined && p.perDraw < max) { max = p.perDraw; limit = 'cap' }
  if (p.remaining !== undefined && p.remaining < max) { max = p.remaining; limit = 'budget' }
  const cent = 10n ** 16n
  max = (max / cent) * cent
  // Suggest the full cap/budget when that binds; when only the floor binds, suggest half the room.
  const suggest = limit === 'floor' ? ((max / 2n) / cent) * cent : max
  return { max, limit, suggest }
}
