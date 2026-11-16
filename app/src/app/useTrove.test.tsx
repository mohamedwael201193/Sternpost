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

type Batch = { data?: { result?: unknown }[]; isLoading?: boolean; isError?: boolean }
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
          icr: t.icr?.toString() ?? null,
          error: t.error,
          coreError: t.coreError,
          govError: t.govError,
          gvError: t.gvError,
          governor: t.governor ?? null,
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
    icr: string | null
    error: boolean
    coreError: boolean
    govError: boolean
    gvError: boolean
    governor: string | null
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

  it('a zero-debt trove with the status read still in flight counts (no "No trove" flash)', async () => {
    mockState.core = { data: coreData(50_000_000_000_000_000n, 0n, 0n), isLoading: false, isError: false }
    mockState.sys = { data: undefined, isLoading: true, isError: false }
    const t = await renderTrove()
    expect(t.hasTrove).toBe(true)
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
