import { describe, expect, it } from 'vitest'
import { WAD, icr, judgeDraw, maxSafeDraw, pct } from './icr'

const price = 100_000n * WAD // $100k BTC
const coll = WAD // 1 BTC
const debt = 25_000n * WAD

describe('icr math', () => {
  it('computes collateral ratio', () => {
    expect(pct(icr(coll, price, debt))).toBe('400%')
  })
  it('treats zero debt as infinite', () => {
    expect(pct(icr(coll, price, 0n))).toBe('∞')
  })
  it('accepts a draw that stays above the floor', () => {
    const v = judgeDraw({ coll, price, debt, amount: 1_000n * WAD, fee: 0n, floor: 3n * WAD })
    expect(v.ok).toBe(true)
  })
  it('rejects a draw that crosses the floor with BELOW_FLOOR', () => {
    const v = judgeDraw({ coll, price, debt, amount: 10_000n * WAD, fee: 0n, floor: 3n * WAD })
    expect(v).toMatchObject({ ok: false, reason: 'BELOW_FLOOR' })
  })
  it('counts the borrowing fee against the floor', () => {
    const amount = maxSafeDraw(coll, price, debt, 3n * WAD)
    expect(judgeDraw({ coll, price, debt, amount, fee: 0n, floor: 3n * WAD }).ok).toBe(true)
    expect(judgeDraw({ coll, price, debt, amount, fee: WAD, floor: 3n * WAD }).ok).toBe(false)
  })
  it('enforces budgets, per-draw caps, freeze and zero', () => {
    const base = { coll, price, debt, fee: 0n, floor: WAD }
    expect(judgeDraw({ ...base, amount: 0n })).toMatchObject({ reason: 'ZERO_AMOUNT' })
    expect(judgeDraw({ ...base, amount: 5n * WAD, perDrawMax: WAD })).toMatchObject({ reason: 'OVER_PER_DRAW' })
    expect(judgeDraw({ ...base, amount: 5n * WAD, remaining: WAD })).toMatchObject({ reason: 'OVER_BUDGET' })
    expect(judgeDraw({ ...base, amount: WAD, frozen: true })).toMatchObject({ reason: 'FROZEN' })
  })
})
