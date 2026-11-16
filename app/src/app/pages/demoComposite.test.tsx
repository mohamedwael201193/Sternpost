import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DEMO_ACCOUNT } from '../../lib/chain'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Home renders RouteLines, which measures with ResizeObserver (absent in jsdom).
;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * Round 10 (J2 LOW-4) — the ONE composite test: mockState (wagmi batches)
 * → the REAL useTrove hook → the REAL Home page, for the COLL0_DEBT case
 * (coll 0 / debt > 0 / status 1). The page-level tests in demoFixes drive
 * through a mocked hook, and the hook tests in useTrove.test.tsx pin the
 * hook's values without rendering a page — this test closes the composition
 * gap between them: the hook's real 0n ICR must reach the real Dial as 0%
 * with "Below floor", and the real Wallet balances card must appear for a
 * known-active trove the mock would call hasTrove: false.
 *
 * The wagmi batch mock is the useTrove.test.tsx pattern (mockState keyed by
 * the first contract's functionName); the other page hooks are canned like
 * demoFixes (viewed account connected, demo off, API off). DrawHero's own
 * reads (fee / preview / router policy) return empty — the hero renders its
 * "Set your floor below" link for this trove, which the test does not
 * assert on.
 */
const WALLET = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3' as const
const GOVERNOR = '0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38' as const
const PRICE = 64_608_796_300_000_000_000_000n

type Batch = { data?: { result?: unknown; status?: string }[]; isLoading?: boolean; isError?: boolean }
const mockState = vi.hoisted(() => ({
  gov: { data: undefined, isLoading: false, isError: false } as { data?: unknown; isLoading: boolean; isError: boolean },
  core: { data: undefined, isLoading: false, isError: false } as Batch,
  gv: { data: undefined, isLoading: false, isError: false } as Batch,
  sys: { data: undefined, isLoading: false, isError: false } as Batch,
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: WALLET, isConnected: true, chainId: 31611 }),
  usePublicClient: () => null,
  useReadContract: (a: { functionName?: string }) => {
    if (a?.functionName === 'governorOf') return mockState.gov
    return { data: undefined, isLoading: false, isError: false, isFetched: false, refetch: () => {} }
  },
  useReadContracts: (a: { contracts?: { functionName?: string }[] }) => {
    const fn = a?.contracts?.[0]?.functionName
    if (fn === 'getEntireDebtAndColl') return mockState.core
    if (fn === 'floorICR') return mockState.gv
    if (fn === 'getTroveStatus') return mockState.sys
    return { data: undefined, isLoading: false, isError: false }
  },
  useBalance: () => ({ data: undefined }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConfig: () => ({}),
}))
vi.mock('wagmi/actions', () => ({ switchChain: vi.fn() }))
vi.mock('../useAccount', () => ({
  RPC_ERROR_TEXT: 'Could not reach the Mezo testnet RPC. Retrying every 12 s.',
  SLOT_ERROR_TEXT: 'A Mezo testnet read failed — one or more views reverted while the RPC answered. Retrying automatically.',
  MAINNET_RPC_ERROR_TEXT: 'Could not reach the Mezo mainnet RPC.',
  useAccount: () => ({ data: undefined, isLoading: false, isError: false }),
  useRadar: () => ({ data: undefined, isLoading: false, isError: false }),
  useViewedAccount: () => ({ address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: false, reconnecting: false }),
  useOwnAccount: () => ({ data: null, isLoading: false, isError: false }),
}))
vi.mock('../api', () => ({ useApiList: () => ({ state: 'off', items: [] }), useSetRequestStatus: () => vi.fn() }))

import Home from './Home'

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

let root: Root | null = null

async function renderPage(el: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<MemoryRouter>{el}</MemoryRouter>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  return container as HTMLDivElement
}

beforeEach(() => {
  mockState.gov = { data: GOVERNOR, isLoading: false, isError: false }
  mockState.core = { data: coreData(0n, 100_000_000_000_000_000_000n, 0n), isLoading: false, isError: false }
  mockState.gv = { data: gvData(), isLoading: false, isError: false }
  mockState.sys = { data: sysData(1), isLoading: false, isError: false }
  if (root) act(() => root!.unmount())
  root = null
})

describe('Round 10 — J2 LOW-4: composite mockState → real hook → displayed Dial (COLL0_DEBT)', () => {
  it('the real hook turns coll-0/debt>0/status-1 batches into a 0% "Below floor" Dial, a 0% hero Current, and the Wallet balances card', async () => {
    const c = await renderPage(<Home />)
    expect(c.querySelector('[data-testid="dial-value"]')?.textContent).toContain('0')
    expect(c.textContent).toContain('Below floor')
    expect(c.textContent).not.toContain('No trove')
    expect(c.querySelector('[data-testid="hero-current"]')?.textContent).toBe('0%')
    expect(c.textContent).toContain('Wallet balances')
  })
})
