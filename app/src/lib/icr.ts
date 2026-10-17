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

export type DrawVerdict =
  | { ok: true; icrAfter: bigint }
  | { ok: false; icrAfter: bigint; reason: 'ZERO_AMOUNT' | 'BELOW_FLOOR' | 'OVER_BUDGET' | 'OVER_PER_DRAW' | 'FROZEN' }

export function judgeDraw(p: {
  coll: bigint; price: bigint; debt: bigint; amount: bigint; fee: bigint; floor: bigint
  remaining?: bigint; perDrawMax?: bigint; frozen?: boolean
}): DrawVerdict {
  const icrAfter = projectedIcr(p.coll, p.price, p.debt, p.amount, p.fee)
  if (p.frozen) return { ok: false, reason: 'FROZEN', icrAfter }
  if (p.amount === 0n) return { ok: false, reason: 'ZERO_AMOUNT', icrAfter }
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
  if (v >= 2n ** 200n) return '∞'
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
}
