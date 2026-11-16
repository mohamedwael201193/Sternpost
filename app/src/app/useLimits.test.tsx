import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * useLimits unit tests (fix round 7, J2 F2 + J3 LOW-5): the fee-slot
 * failure branch (round 6) had zero coverage, and the appPolicy /
 * remainingBudget slots had the same allowFailure hole — a failed slot
 * still yields a floor-only max safe. wagmi's useReadContracts is mocked
 * per slot by status, like useTrove.test.tsx mocks it per batch.
 */
const WALLET = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3' as const
const GOVERNOR = '0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38' as const
const APP = '0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8' as const
const PRICE = 64_608_796_300_000_000_000_000n

type Slot = { status: 'success' | 'failure'; result?: unknown }
const mockState = vi.hoisted(() => ({
  q: { data: undefined as Slot[] | undefined, isLoading: false, isError: false },
}))

vi.mock('wagmi', () => ({
  useReadContracts: () => mockState.q,
}))

import { useLimits } from './useLimits'
import type { Trove } from './useTrove'

// appPolicy tuple: [budget, spent, perDraw, expiry, payee]; expiry > 0 means authorized.
const okPol = (): Slot => ({ status: 'success', result: [1_000_000_000_000_000_000_000n, 0n, 50_000_000_000_000_000_000n, 1790000000n, '0x0000000000000000000000000000000000000000'] })
const okRem = (): Slot => ({ status: 'success', result: 1_000_000_000_000_000_000_000n })
const okFee = (): Slot => ({ status: 'success', result: 5_000_000_000_000_000n })
const failSlot = (): Slot => ({ status: 'failure' })

const TROVE = {
  governor: GOVERNOR,
  hasTrove: true,
  price: PRICE,
  floor: 2_500_000_000_000_000_000n,
  coll: 50_000_000_000_000_000n,
  // Debt 1,000 MUSD against 0.05 BTC at $64,608: ICR ~323%, above the 250%
  // floor, so there IS room above the floor (the demo trove's real 2,016
  // MUSD debt sits at 160%, below the floor, and maxSafeDraw is 0 there).
  debt: 1_000_000_000_000_000_000_000n,
} as unknown as Trove

async function renderLimits(trove: Trove = TROVE) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  function Probe() {
    const l = useLimits(trove, APP as `0x${string}`)
    return (
      <div
        data-limits={JSON.stringify({
          loaded: l.loaded,
          authorized: l.authorized,
          feeError: l.feeError,
          polError: l.polError,
          safe: l.safe ? { max: l.safe.max.toString(), limit: l.safe.limit, suggest: l.safe.suggest.toString() } : null,
        })}
      />
    )
  }
  await act(async () => {
    root.render(<Probe />)
  })
  const out = JSON.parse((container.firstElementChild as HTMLElement).dataset.limits!)
  await act(async () => {
    root.unmount()
  })
  container.remove()
  return out as {
    loaded: boolean
    authorized: boolean
    feeError: boolean
    polError: boolean
    safe: { max: string; limit: string; suggest: string } | null
  }
}

beforeEach(() => {
  mockState.q = { data: [okPol(), okRem(), okFee()], isLoading: false, isError: false }
})

describe('useLimits (round 7, J2 F2 + J3 LOW-5)', () => {
  it('returns a safe max when all three slots succeed', async () => {
    const l = await renderLimits()
    expect(l.loaded).toBe(true)
    expect(l.authorized).toBe(true)
    expect(l.feeError).toBe(false)
    expect(l.polError).toBe(false)
    expect(l.safe).not.toBeNull()
    // Floor room is ~290 MUSD, so the 50 MUSD per-draw cap binds and is
    // suggested whole.
    expect(l.safe!.limit).toBe('cap')
    expect(BigInt(l.safe!.max)).toBe(50_000_000_000_000_000_000n)
    expect(BigInt(l.safe!.suggest)).toBe(50_000_000_000_000_000_000n)
  })

  it('a failed fee slot fails the safe draw (no suggest, no max) and sets feeError', async () => {
    mockState.q = { data: [okPol(), okRem(), failSlot()], isLoading: false, isError: false }
    const l = await renderLimits()
    expect(l.safe).toBeNull()
    expect(l.feeError).toBe(true)
    expect(l.polError).toBe(false)
    expect(l.loaded).toBe(false)
  })

  it('a failed appPolicy slot fails the safe draw instead of yielding a floor-only max', async () => {
    mockState.q = { data: [failSlot(), okRem(), okFee()], isLoading: false, isError: false }
    const l = await renderLimits()
    expect(l.safe).toBeNull()
    expect(l.polError).toBe(true)
    expect(l.feeError).toBe(false)
    expect(l.authorized).toBe(false)
    expect(l.loaded).toBe(false)
  })

  it('a failed remainingBudget slot fails the safe draw instead of yielding a floor-only max', async () => {
    mockState.q = { data: [okPol(), failSlot(), okFee()], isLoading: false, isError: false }
    const l = await renderLimits()
    expect(l.safe).toBeNull()
    expect(l.polError).toBe(true)
    expect(l.loaded).toBe(false)
  })

  it('loaded is false when all three slots failed (q.data is truthy but nothing was read)', async () => {
    mockState.q = { data: [failSlot(), failSlot(), failSlot()], isLoading: false, isError: false }
    const l = await renderLimits()
    expect(l.loaded).toBe(false)
    expect(l.safe).toBeNull()
    expect(l.feeError).toBe(true)
    expect(l.polError).toBe(true)
  })

  it('loaded is false when there is no floor room (no floor), even when the batch succeeds (round 8, J3 L4: loaded was true while safe was undefined)', async () => {
    const l = await renderLimits({ ...TROVE, floor: undefined } as unknown as Trove)
    expect(l.loaded).toBe(false)
    expect(l.safe).toBeNull()
    expect(l.feeError).toBe(false)
    expect(l.polError).toBe(false)
  })
})
