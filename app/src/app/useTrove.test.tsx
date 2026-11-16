import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * useTrove unit tests (fix round 3): the L8 zero-debt hasTrove rule and the
 * L1/L2/L3/L5 error split (coreError / govError / gvError). wagmi reads are
 * mocked per batch by the first contract's functionName.
 */
const WALLET = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3' as const
const GOVERNOR = '0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38' as const
const PRICE = 64_608_796_300_000_000_000_000n
const NO_DEBT_ICR = (2n ** 255n).toString()

type Batch = { data?: { result?: unknown; status?: string }[]; isLoading?: boolean; isError?: boolean }
const mockState = vi.hoisted(() => ({
  gov: { data: undefined, isLoading: false, isError: false } as { data?: unknown; isLoading: boolean; isError: boolean },
  core: { data: undefined, isLoading: false, isError: false } as Batch,
  gv: { data: undefined, isLoading: false, isError: false } as Batch,
  sys: { data: undefined, isLoading: false, isError: false } as Batch,
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: WALLET, isConnected: true }),
  useReadContract: () => mockState.gov,
  useReadContracts: (a: { contracts?: { functionName?: string }[] }) => {
    const fn = a?.contracts?.[0]?.functionName
    if (fn === 'getEntireDebtAndColl') return mockState.core
    if (fn === 'floorICR') return mockState.gv
    if (fn === 'getTroveStatus') return mockState.sys
    return { data: undefined, isLoading: false, isError: false }
  },
  useBalance: () => ({ data: undefined }),
}))

import { useTrove } from './useTrove'

const coreData = (coll: bigint, principal: bigint, interest: bigint) => [
  { result: [coll, principal, interest, 0n, 0n, 0n] },
  { result: PRICE },
  { result: 0n },
  { result: 0n },
  { result: 0n },
  { result: 0n },
]
const sysData = (status: number) => [{ result: status }, { result: false }, { result: 2_320_369_306_368_630_978n }]
const gvData = () => [
  { result: 2_500_000_000_000_000_000n },
  { result: false },
  { result: [0n, 0n, 0n, false] },
  { result: 1_600_000_000_000_000_000n },
]

async function renderTrove() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  function Probe() {
    const t = useTrove()
    return (
      <div
        data-trove={JSON.stringify({
          hasTrove: t.hasTrove,
          troveStatusKnown: t.troveStatusKnown,
          troveStatus: t.troveStatus ?? null,
          icr: t.icr?.toString() ?? null,
          error: t.error,
          coreError: t.coreError,
          govError: t.govError,
          gvError: t.gvError,
          gvSlotError: t.gvSlotError,
          sysSlotError: t.sysSlotError,
          governor: t.governor ?? null,
          loading: t.loading,
          govLoading: t.govLoading,
          gvLoading: t.gvLoading,
          coreSlotError: t.coreSlotError,
          recoverySlotError: t.recoverySlotError,
          tcrSlotError: t.tcrSlotError,
        })}
      />
    )
  }
  await act(async () => {
    root.render(<Probe />)
  })
  const out = JSON.parse((container.firstElementChild as HTMLElement).dataset.trove!)
  await act(async () => {
    root.unmount()
  })
  container.remove()
  return out as {
    hasTrove: boolean
    troveStatusKnown: boolean
    troveStatus: number | null
    icr: string | null
    error: boolean
    coreError: boolean
    govError: boolean
    gvError: boolean
    gvSlotError: boolean
    sysSlotError: boolean
    governor: string | null
    loading: boolean
    govLoading: boolean
    gvLoading: boolean
    coreSlotError: boolean
    recoverySlotError: boolean
    tcrSlotError: boolean
  }
}

beforeEach(() => {
  mockState.gov = { data: GOVERNOR, isLoading: false, isError: false }
  mockState.core = {
    data: coreData(50_000_000_000_000_000n, 2_016_156_232_562_500_000_000n, 52_322_888_132_253_551n),
    isLoading: false,
    isError: false,
  }
  mockState.gv = { data: gvData(), isLoading: false, isError: false }
  mockState.sys = { data: sysData(1), isLoading: false, isError: false }
})

describe('useTrove hasTrove (L8)', () => {
  it('a normal trove counts, with a finite ICR', async () => {
    const t = await renderTrove()
    expect(t.hasTrove).toBe(true)
    expect(t.icr).toBe('1602234950480101128')
    expect(t.error).toBe(false)
  })

  it('a zero-debt trove with an active status counts, with ICR 2**255 ("No debt")', async () => {
    mockState.core = { data: coreData(50_000_000_000_000_000n, 0n, 0n), isLoading: false, isError: false }
    const t = await renderTrove()
    expect(t.hasTrove).toBe(true)
    expect(t.icr).toBe(NO_DEBT_ICR)
  })

  it('a zero-debt trove with the status read still in flight does NOT count (round 7 definition): hasTrove is false and the status is unknown, but the ICR is still 2**255 so pages render "Unavailable", never a "No trove" flash', async () => {
    mockState.core = { data: coreData(50_000_000_000_000_000n, 0n, 0n), isLoading: false, isError: false }
    mockState.sys = { data: undefined, isLoading: true, isError: false }
    const t = await renderTrove()
    expect(t.hasTrove).toBe(false)
    expect(t.troveStatusKnown).toBe(false)
    expect(t.troveStatus).toBeNull()
    expect(t.icr).toBe(NO_DEBT_ICR)
  })

  it('a zero-debt trove with a failed status read does not count either', async () => {
    mockState.core = { data: coreData(50_000_000_000_000_000n, 0n, 0n), isLoading: false, isError: false }
    mockState.sys = { data: undefined, isLoading: false, isError: true }
    const t = await renderTrove()
    expect(t.hasTrove).toBe(false)
    expect(t.troveStatusKnown).toBe(false)
    expect(t.icr).toBe(NO_DEBT_ICR)
  })

  it('a closed trove with coll > 0 / debt 0 does not count, but its ICR is still exposed (round 7 invariant: a redemption-closed trove keeps claimable surplus collateral, so coll > 0 never proves "active")', async () => {
    mockState.core = { data: coreData(10_000_000_000_000_000n, 0n, 0n), isLoading: false, isError: false }
    mockState.sys = { data: sysData(2), isLoading: false, isError: false }
    const t = await renderTrove()
    expect(t.hasTrove).toBe(false)
    expect(t.troveStatusKnown).toBe(true)
    expect(t.troveStatus).toBe(2)
    expect(t.icr).toBe(NO_DEBT_ICR)
  })

  it('a future status 5 with debt 0 does not count, and is NOT known (round 8: known means known-AND-understood — a status this code does not understand must never gate an empty into "No trove")', async () => {
    mockState.core = { data: coreData(50_000_000_000_000_000n, 0n, 0n), isLoading: false, isError: false }
    mockState.sys = { data: sysData(5), isLoading: false, isError: false }
    const t = await renderTrove()
    expect(t.hasTrove).toBe(false)
    expect(t.troveStatusKnown).toBe(false)
    expect(t.troveStatus).toBe(5)
    expect(t.icr).toBe(NO_DEBT_ICR)
  })

  it('a wallet that never opened a trove does not count', async () => {
    mockState.core = { data: coreData(0n, 0n, 0n), isLoading: false, isError: false }
    mockState.sys = { data: sysData(0), isLoading: false, isError: false }
    const t = await renderTrove()
    expect(t.hasTrove).toBe(false)
    expect(t.icr).toBeNull()
  })
})

describe('useTrove error split (L1/L2/L3/L5)', () => {
  it('a governorOf-only failure sets govError + error, not coreError — trove numbers stay readable', async () => {
    mockState.gov = { data: undefined, isLoading: false, isError: true }
    const t = await renderTrove()
    expect(t.error).toBe(true)
    expect(t.govError).toBe(true)
    expect(t.coreError).toBe(false)
    expect(t.gvError).toBe(false)
    expect(t.hasTrove).toBe(true)
    expect(t.governor).toBeNull()
  })

  it('a core failure sets coreError + error, not govError', async () => {
    mockState.core = { data: undefined, isLoading: false, isError: true }
    const t = await renderTrove()
    expect(t.error).toBe(true)
    expect(t.coreError).toBe(true)
    expect(t.govError).toBe(false)
    expect(t.hasTrove).toBe(false)
  })

  it('a Governor-batch failure sets only gvError', async () => {
    mockState.gv = { data: undefined, isLoading: false, isError: true }
    const t = await renderTrove()
    expect(t.gvError).toBe(true)
    expect(t.error).toBe(false)
    expect(t.coreError).toBe(false)
    expect(t.govError).toBe(false)
    expect(t.hasTrove).toBe(true)
  })
})

describe('useTrove per-slot failures (round 7, LOW-6)', () => {
  it('a reverted Governor-batch slot sets gvSlotError while gvError stays false', async () => {
    mockState.gv = {
      data: [
        { status: 'success', result: 2_500_000_000_000_000_000n },
        { status: 'failure' },
        { status: 'success', result: [0n, 0n, 0n, false] },
        { status: 'success', result: 1_600_000_000_000_000_000n },
      ],
      isLoading: false,
      isError: false,
    }
    const t = await renderTrove()
    expect(t.gvSlotError).toBe(true)
    expect(t.gvError).toBe(false)
    expect(t.error).toBe(false)
  })

  it('a reverted sys-batch slot sets sysSlotError while sysError stays false', async () => {
    mockState.sys = {
      data: [
        { status: 'success', result: 1 },
        { status: 'failure' },
        { status: 'success', result: 2_320_369_306_368_630_978n },
      ],
      isLoading: false,
      isError: false,
    }
    const t = await renderTrove()
    expect(t.sysSlotError).toBe(true)
  })

  it('no slot error when every slot succeeds', async () => {
    const t = await renderTrove()
    expect(t.gvSlotError).toBe(false)
    expect(t.sysSlotError).toBe(false)
  })
})

describe('useTrove loading + per-slot flags (round 8)', () => {
  it('gvLoading is true while the Governor batch is in flight, and loading covers it via gov/core only when those load', async () => {
    mockState.gv = { data: undefined, isLoading: true, isError: false }
    const t = await renderTrove()
    expect(t.gvLoading).toBe(true)
    expect(t.govLoading).toBe(false)
    expect(t.loading).toBe(false)
  })

  it('govLoading is true while governorOf is in flight, and loading covers it', async () => {
    mockState.gov = { data: undefined, isLoading: true, isError: false }
    const t = await renderTrove()
    expect(t.govLoading).toBe(true)
    expect(t.loading).toBe(true)
  })

  it('a reverted core slot sets coreSlotError while coreError stays false', async () => {
    mockState.core = {
      data: [
        { status: 'failure' },
        { status: 'success', result: PRICE },
        { status: 'success', result: 0n },
        { status: 'success', result: 0n },
        { status: 'success', result: 0n },
        { status: 'success', result: 0n },
      ],
      isLoading: false,
      isError: false,
    }
    const t = await renderTrove()
    expect(t.coreSlotError).toBe(true)
    expect(t.coreError).toBe(false)
    expect(t.error).toBe(false)
  })

  it('a reverted checkRecoveryMode slot sets recoverySlotError only (not tcrSlotError)', async () => {
    mockState.sys = {
      data: [
        { status: 'success', result: 1 },
        { status: 'failure' },
        { status: 'success', result: 2_320_369_306_368_630_978n },
      ],
      isLoading: false,
      isError: false,
    }
    const t = await renderTrove()
    expect(t.recoverySlotError).toBe(true)
    expect(t.tcrSlotError).toBe(false)
    expect(t.sysSlotError).toBe(true)
  })

  it('a reverted getTCR slot sets tcrSlotError only (not recoverySlotError)', async () => {
    mockState.sys = {
      data: [
        { status: 'success', result: 1 },
        { status: 'success', result: false },
        { status: 'failure' },
      ],
      isLoading: false,
      isError: false,
    }
    const t = await renderTrove()
    expect(t.tcrSlotError).toBe(true)
    expect(t.recoverySlotError).toBe(false)
    expect(t.sysSlotError).toBe(true)
  })

  it('no per-slot sys error when every sys slot succeeds', async () => {
    const t = await renderTrove()
    expect(t.recoverySlotError).toBe(false)
    expect(t.tcrSlotError).toBe(false)
    expect(t.coreSlotError).toBe(false)
  })
})
