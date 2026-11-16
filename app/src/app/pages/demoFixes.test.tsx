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
 * Fix-round-1 render tests (judge findings F1–F5 on 39dd453). Hooks are mocked
 * so each test asserts the branch the page renders, not the network; the live
 * reads themselves are covered by useAccount.test.tsx + the sdk tests.
 */

const AGENT = '0x62a4773191747994c0368664cA68BC476897c1d9'
const APP_ADDR = '0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8'
const OWN_ACCT = '0x46442898c022e1fAa2BD05a23600C1Ec89DcA200'
const PREVIEW = '0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38'
const SPEND_WALLET = '0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a'
const OWNER = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3'

let walletState: { isConnected: boolean; address?: `0x${string}`; chainId?: number; connector?: { type: string } } = { isConnected: false }
let viewedState: { address: `0x${string}`; source: 'param' | 'demo'; isDemo: boolean; isLabPrototype: boolean; demoMode: boolean; reconnecting?: boolean } =
  { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: true, reconnecting: false }
let acctState: { data?: any; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false }
let radarState: { data?: any; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false }
let ownState: { data?: `0x${string}` | null; isLoading: boolean; isError: boolean } = { data: null, isLoading: false, isError: false }
let logsState: { data?: { rows: any[]; fromBlock: bigint }; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false }
let readsState: { result: unknown }[] = []
let troveState: Record<string, unknown> = {}
// Round-4 MED-2: the mocked previewDraw result, mutable so a test can flip a
// success into a stale-data error and re-render (TanStack Query v5 retains
// data on error — the component must not trust it).
let previewState: { data?: unknown; isLoading: boolean; isError: boolean } = { data: undefined, isLoading: false, isError: false }
// Round-6 LOW-1: the mocked getBorrowingFee result — a fee-read failure must
// fail the local projection instead of silently pricing the draw with fee 0.
let feeState: { data?: bigint; isError: boolean } = { data: undefined, isError: false }
// Round-4 MED-2 (DrawHero): the mocked useLimits result; a safe suggest lets
// the hero pre-fill an amount so wei > 0 and the preview actually runs.
let limitsState: Record<string, unknown> = {}

const GOVERNOR = '0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38' as const

const SNAP = {
  account: DEMO_ACCOUNT,
  owner: OWNER,
  version: 'v2',
  coll: 50_000_000_000_000_000n,
  debt: 2_016_208_555_450_632_253_551n,
  price: 64_608_796_300_000_000_000_000n,
  icr: 1_602_234_950_480_101_128n,
  troveStatus: 1,
  floorICR: 1_200_000_000_000_000_000n,
  shieldICR: 1_500_000_000_000_000_000n,
  targetICR: 1_600_000_000_000_000_000n,
  bounty: 1_000_000_000_000_000_000n,
  minDebtAhead: null,
  cooldownBlocks: null,
  needed: { icr: 1_602_234_950_480_101_128n, repayWanted: 0n, collWanted: 0n, reason: null },
  pendingYield: null,
  balances: { btc: 0n, musd: 2_433_090_442_561_969_120n, smusd: 61_554_608_535_561_276_641n },
}

/** Round-4 MED-1 fixtures: zero-debt snapshots whose ICR is 2**255 purely
 *  from debt === 0 — status 0 (never opened) and status 2 (closed by owner)
 *  must NEVER render "No debt"; status 1 with debt 0 still must. */
const NO_TROVE_SNAP = {
  ...SNAP, troveStatus: 0, coll: 0n, debt: 0n, icr: 2n ** 255n,
  floorICR: null, shieldICR: null, targetICR: null, bounty: null, needed: null,
}
const CLOSED_SNAP = {
  ...SNAP, troveStatus: 2, coll: 10_000_000_000_000_000n, debt: 0n, icr: 2n ** 255n,
  needed: { icr: 2n ** 255n, repayWanted: 0n, collWanted: 0n, reason: null },
}
const ZERO_DEBT_ACTIVE_SNAP = {
  ...SNAP, troveStatus: 1, coll: 50_000_000_000_000_000n, debt: 0n, icr: 2n ** 255n,
}

vi.mock('wagmi', () => ({
  useAccount: () => walletState,
  usePublicClient: () => null,
  useReadContract: (a: any) => (a?.functionName === 'walletsOf' ? { data: [SPEND_WALLET] } : a?.functionName === 'previewDraw' ? previewState : a?.functionName === 'getBorrowingFee' ? feeState : { data: undefined }),
  useReadContracts: () => ({ data: readsState }),
  useWalletClient: () => ({ data: undefined }),
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useConfig: () => ({}),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useBalance: () => ({ data: undefined }),
}))
vi.mock('wagmi/actions', () => ({ switchChain: vi.fn() }))
vi.mock('../useAccount', () => ({
  RPC_ERROR_TEXT: 'Could not reach the Mezo testnet RPC. Retrying every 12 s.',
  MAINNET_RPC_ERROR_TEXT: 'Could not reach the Mezo mainnet RPC.',
  useAccount: () => acctState,
  useRadar: () => radarState,
  useViewedAccount: () => viewedState,
  useOwnAccount: () => ownState,
}))
vi.mock('../useLogs', () => ({ useAccountLogs: () => logsState }))
vi.mock('../useTrove', () => ({
  TROVE_STATUS_LABEL: { 0: 'No trove', 1: 'Active', 2: 'Closed by owner', 3: 'Liquidated', 4: 'Closed by redemption' },
  useTrove: () => ({
    address: walletState.address, isConnected: walletState.isConnected, hasTrove: false, governor: undefined,
    loading: false, sysLoading: false, sysError: false, error: false, coreError: false, govError: false, gvError: false,
    balances: { btc: undefined, musd: undefined, smusd: undefined, mezo: undefined },
    ...troveState,
  }),
}))
vi.mock('../useLimits', () => ({ useLimits: () => limitsState }))
vi.mock('../api', () => ({ useApiList: () => ({ state: 'off', items: [] }), useSetRequestStatus: () => vi.fn() }))

import Close from './Close'
import Open from './Open'
import Apps from './Apps'
import Pay, { PayRow } from './Pay'
import Draw from './Draw'
import Home from './Home'
import Watch from './Watch'
import ProveItPage from './ProveIt'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderPage(el: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<MemoryRouter>{el}</MemoryRouter>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  return container as HTMLDivElement
}

/** Re-render into the SAME root (round-4 MED-2): flip a mocked hook result and
 *  assert the page reacts, e.g. a previewDraw success turning into an error. */
async function rerenderPage(el: ReactElement) {
  await act(async () => {
    root!.render(<MemoryRouter>{el}</MemoryRouter>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  return container as HTMLDivElement
}

function signButton(c: HTMLDivElement) {
  return Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Sign & send')) as HTMLButtonElement | undefined
}

function cleanup() {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
}

beforeEach(() => {
  walletState = { isConnected: false }
  viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: true, reconnecting: false }
  acctState = { data: SNAP, isLoading: false, isError: false }
  radarState = { data: { recoveryMode: false, tcr: 2_320_369_306_368_630_978n }, isLoading: false, isError: false }
  ownState = { data: null, isLoading: false, isError: false }
  logsState = { isLoading: false, isError: false }
  readsState = []
  troveState = {}
  previewState = { data: undefined, isLoading: false, isError: false }
  feeState = { data: undefined, isError: false }
  limitsState = {}
  cleanup()
})

describe('F1 — Close never asserts Recovery Mode from a failed radar read', () => {
  it('shows "Unavailable" (not "off") when the radar read fails', async () => {
    radarState = { data: undefined, isLoading: false, isError: true }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('Recovery Mode')
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toMatch(/Recovery Mode\s*off/)
  })

  it('still shows "off" when the radar read succeeds with recoveryMode false', async () => {
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('off')
  })
})

describe('F4 — connected users never see demo numbers as their own', () => {
  it('Close shows the no-account CTA when connected with no account and no preview', async () => {
    walletState = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: false }
    ownState = { data: null, isLoading: false, isError: false }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('You have no credit account yet. Open one in about two minutes.')
    expect(c.textContent).not.toContain(DEMO_ACCOUNT)
  })

  it('Close shows the connected user’s own account when they have one', async () => {
    walletState = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: false }
    ownState = { data: OWN_ACCT, isLoading: false, isError: false }
    acctState = { data: { ...SNAP, account: OWN_ACCT }, isLoading: false, isError: false }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('Your account — live close position')
    expect(c.textContent).toContain(OWN_ACCT)
  })

  it('Close in demo mode carries the LAB PROTOTYPE badge', async () => {
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('LAB PROTOTYPE')
    expect(c.textContent).toContain('Demo account — live close position')
  })

  it('Close under a ?account= preview says preview, not "in demo mode"', async () => {
    walletState = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
    viewedState = { address: PREVIEW as `0x${string}`, source: 'param', isDemo: false, isLabPrototype: false, demoMode: true }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('Previewed account — live close position')
    expect(c.textContent).toContain('this preview is read-only')
    expect(c.textContent).not.toContain('in demo mode this account is read-only')
  })

  it('Open shows the no-account CTA when connected with no account and no preview', async () => {
    walletState = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: false }
    ownState = { data: null, isLoading: false, isError: false }
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('You have no credit account yet. Open one in about two minutes.')
    expect(c.textContent).not.toContain(DEMO_ACCOUNT)
  })

  it('Open in demo mode labels the demo account and its badge', async () => {
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('Demo account — live on testnet')
    expect(c.textContent).toContain('LAB PROTOTYPE')
  })
})

describe('F2 — Apps renders the drawer for both Drawn shapes', () => {
  it('shows "App" for a v3 Drawn (app) and "Agent" for a v2 Drawn (agent), never undefined', async () => {
    logsState = {
      isLoading: false,
      isError: false,
      data: {
        fromBlock: 16790000n,
        rows: [
          { event: 'Drawn', tx: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', logIndex: 0, block: 16791000n, args: { app: APP_ADDR, payee: OWNER, amount: 100_000_000_000_000_000_000n, icrAfter: 1_600_000_000_000_000_000n } },
          { event: 'Drawn', tx: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', logIndex: 0, block: 16791001n, args: { agent: AGENT, payee: OWNER, amount: 50_000_000_000_000_000_000n, icrAfter: 1_550_000_000_000_000_000n } },
        ],
      },
    }
    const c = await renderPage(<Apps />)
    expect(c.textContent).toContain('App')
    expect(c.textContent).toContain('Agent')
    expect(c.textContent).not.toContain('undefined')
    expect(c.innerHTML).not.toContain('/address/undefined')
  })
})

describe('F3 — Pay never exposes a live write button in demo mode', () => {
  it('shows a read-only note instead of the pay button when the connected wallet is the agent', async () => {
    walletState = { isConnected: true, address: AGENT as `0x${string}`, chainId: 31611 }
    readsState = [{ result: 5_000_000_000_000_000_000_000n }, { result: AGENT }, { result: 9_999_999_999n }]
    const c = await renderPage(<Pay />)
    expect(c.textContent).toContain('Read-only demo')
    expect(c.querySelector('button')).toBeNull()
    expect(c.textContent).not.toContain('Pay for the desk brief')
  })

  it('still shows the pay button outside demo mode for the agent', async () => {
    walletState = { isConnected: true, address: AGENT as `0x${string}`, chainId: 31611 }
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: false }
    readsState = [{ result: 5_000_000_000_000_000_000_000n }, { result: AGENT }, { result: 9_999_999_999n }]
    const c = await renderPage(<Pay />)
    expect(c.textContent).toContain('Pay for the desk brief (x402)')
  })
})

describe('F5 — Draw demo shows one Current gauge, no fake "After draw"', () => {
  it('renders a single Current gauge in demo mode', async () => {
    const c = await renderPage(<Draw />)
    // Gauge renders its label upper-cased ("CURRENT").
    expect(c.textContent).toContain('CURRENT')
    expect(c.textContent).not.toContain('AFTER DRAW')
    expect(c.textContent).not.toContain('After draw')
  })
})

describe('LOW-3 — Close/Open hold the demo branch while wagmi reconnects', () => {
  it('Close shows a skeleton, never demo numbers, while reconnecting', async () => {
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: true, reconnecting: true }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('Your account — live close position')
    expect(c.textContent).not.toContain('Demo account — live close position')
    expect(c.textContent).not.toContain(DEMO_ACCOUNT)
  })

  it('Open shows a skeleton, never demo numbers, while reconnecting', async () => {
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: true, reconnecting: true }
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('Your account — live on testnet')
    expect(c.textContent).not.toContain('Demo account — live on testnet')
    expect(c.textContent).not.toContain(DEMO_ACCOUNT)
  })

  it('an explicit ?account= preview still renders while reconnecting', async () => {
    walletState = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
    viewedState = { address: PREVIEW as `0x${string}`, source: 'param', isDemo: false, isLabPrototype: false, demoMode: true, reconnecting: true }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('Previewed account — live close position')
    expect(c.textContent).toContain(PREVIEW)
  })
})

describe('LOW-4 — PayRow defaults to demo (read-only)', () => {
  it('renders the read-only note, not a pay button, when demo is omitted', async () => {
    walletState = { isConnected: true, address: AGENT as `0x${string}`, chainId: 31611 }
    const c = await renderPage(<PayRow wallet={SPEND_WALLET} agent={AGENT as `0x${string}`} />)
    expect(c.textContent).toContain('Read-only demo')
    expect(c.querySelector('button')).toBeNull()
    expect(c.textContent).not.toContain('Pay for the desk brief')
  })

  it('renders the pay button only on an explicit demo={false} opt-out', async () => {
    walletState = { isConnected: true, address: AGENT as `0x${string}`, chainId: 31611 }
    const c = await renderPage(<PayRow wallet={SPEND_WALLET} agent={AGENT as `0x${string}`} demo={false} />)
    expect(c.textContent).toContain('Pay for the desk brief (x402)')
  })
})

describe('LOW-5 — Home gates "No policy" on shieldICR, never on needed', () => {
  it('shows "Unknown" (not "No policy", not "No shield needed") when needed() failed but the policy exists (J1 LOW-2)', async () => {
    acctState = { data: { ...SNAP, needed: null }, isLoading: false, isError: false }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Unknown')
    expect(c.textContent).not.toContain('No policy')
    expect(c.textContent).not.toContain('No shield needed')
  })

  it('shows "No policy" when shieldICR itself is null', async () => {
    acctState = { data: { ...SNAP, needed: null, shieldICR: null, floorICR: null }, isLoading: false, isError: false }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('No policy')
  })
})

describe('J1 LOW-c — Home shows the no-account CTA for a connected wallet without a credit account', () => {
  it('shows "You have no credit account yet" with a link to /app/open', async () => {
    walletState = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: false, reconnecting: false }
    ownState = { data: null, isLoading: false, isError: false }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('You have no credit account yet. Open one in about two minutes.')
    expect(c.querySelector('a[href="/app/open"]')).not.toBeNull()
  })
})

describe('H1 — the known lab account is labelled LAB PROTOTYPE as the user’s own account', () => {
  it('Close badges the lab account when it is the connected owner’s own account', async () => {
    walletState = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
    viewedState = { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: true, demoMode: false, reconnecting: false }
    ownState = { data: DEMO_ACCOUNT, isLoading: false, isError: false }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('Your account — live close position')
    expect(c.textContent).toContain(DEMO_ACCOUNT)
    expect(c.textContent).toContain('LAB PROTOTYPE')
  })
})

const LIVE = { isConnected: true, address: OWNER as `0x${string}`, chainId: 31611 }
const LIVE_VIEWED = { address: DEMO_ACCOUNT, source: 'demo' as const, isDemo: true, isLabPrototype: true, demoMode: false, reconnecting: false }
const TROVE_NUMBERS = {
  hasTrove: true,
  coll: 50_000_000_000_000_000n,
  debt: 2_016_208_555_450_632_253_551n,
  price: 64_608_796_300_000_000_000_000n,
  icr: 1_602_234_950_480_101_128n,
  troveStatus: 1,
  floor: 2_500_000_000_000_000_000n,
  nonce: 5n,
}

describe('L1 — Home dial gates on the core read, never a bare "No trove"', () => {
  it('shows "Unavailable" (not "No trove") when the core trove read fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { error: true, coreError: true, govError: false, gvError: false, hasTrove: false, governor: undefined }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('No trove')
  })
})

describe('L2 — "No Governor yet" rows gate on the governor read error', () => {
  it('shows "Unavailable" (not "No Governor yet") when governorOf fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { error: true, coreError: false, govError: true, gvError: false, governor: undefined, ...TROVE_NUMBERS }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('No Governor yet')
    expect(c.textContent).not.toContain('Deploys your own Governor')
    // MED-2 (round 6): this state rendered "DISARMED" in the Standby row
    // before the fix (standby undefined, gvError false) while the test
    // asserted nothing about it — the Governor is unknown here, not disarmed.
    expect(c.textContent).not.toContain('DISARMED')
    expect(c.textContent).not.toContain('Not configured')
  })
})

describe('L3 — Governor batch (floor/frozen/standby) gates on gvError', () => {
  it('shows "Unavailable" (not "Not configured" / "DISARMED") when the Governor batch fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { error: false, coreError: false, govError: false, gvError: true, governor: GOVERNOR, ...TROVE_NUMBERS, floor: undefined, standby: undefined, frozen: undefined }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('Not configured')
    expect(c.textContent).not.toContain('DISARMED')
  })

  it('Watch shows "Unavailable" (not "No Governor yet") when the Governor batch fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { error: false, coreError: false, govError: false, gvError: true, governor: GOVERNOR, standby: undefined, ...TROVE_NUMBERS }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('No Governor yet')
  })
})

describe('MED-2 (round 6) — Home Floor/Standby lie when governorOf fails', () => {
  it('shows "Unavailable", never "Not configured" / "DISARMED", when governorOf fails and the Governor batch never ran', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    // The Governor batch is enabled: !!governor, so on a governorOf failure
    // it never runs: gvError stays false and floor/standby stay undefined.
    // Gating only on gvError rendered "Not configured" / "DISARMED" about
    // an unknown Governor.
    troveState = { error: true, coreError: false, govError: true, gvError: false, governor: undefined, ...TROVE_NUMBERS, floor: undefined, standby: undefined, frozen: undefined }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('Not configured')
    expect(c.textContent).not.toContain('DISARMED')
  })

  it('still shows the live floor and armed standby once the Governor reads succeed', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = {
      ...TROVE_NUMBERS, governor: GOVERNOR, hasTrove: true, frozen: false,
      floor: 2_500_000_000_000_000_000n,
      standby: [30_000_000_000_000_000_000n, 1790000000n, 0n, true] as const,
      error: false, coreError: false, govError: false, gvError: false, sysError: false,
    }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('250%')
    expect(c.textContent).toContain('30.00 MUSD armed')
    expect(c.textContent).not.toContain('Unavailable')
  })
})

describe('L5 — a governor-only failure does not mask readable trove numbers', () => {
  it('still shows the live collateral/debt numbers when governorOf fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { error: true, coreError: false, govError: true, gvError: false, governor: undefined, ...TROVE_NUMBERS }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('0.05 BTC')
    expect(c.textContent).toContain('2,016.21')
    expect(c.textContent).not.toContain('No trove')
  })
})

describe('L6 — the reconnecting hold covers Home/Watch/Draw/Pay/Apps', () => {
  const HOLD_VIEWED = { address: DEMO_ACCOUNT, source: 'demo' as const, isDemo: true, isLabPrototype: true, demoMode: true, reconnecting: true }

  it('Home shows skeletons, never demo numbers, while reconnecting', async () => {
    viewedState = { ...HOLD_VIEWED }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Collateral ratio')
    expect(c.textContent).not.toContain(DEMO_ACCOUNT)
    expect(c.textContent).not.toContain('No shield needed')
  })

  it('Watch shows skeletons, never the shield verdict, while reconnecting', async () => {
    viewedState = { ...HOLD_VIEWED }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('Shield need')
    expect(c.textContent).not.toContain('NothingToDo')
    expect(c.textContent).not.toContain('is above the shield line')
    expect(c.textContent).not.toContain('of 277')
  })

  it('Draw shows a skeleton, never the demo gauge, while reconnecting', async () => {
    viewedState = { ...HOLD_VIEWED }
    const c = await renderPage(<Draw />)
    expect(c.textContent).toContain('Draw')
    expect(c.textContent).not.toContain('CURRENT')
    expect(c.textContent).not.toContain('160.2%')
  })

  it('Pay shows a skeleton, never the demo spend wallets, while reconnecting', async () => {
    viewedState = { ...HOLD_VIEWED }
    const c = await renderPage(<Pay />)
    expect(c.textContent).toContain('Pay')
    expect(c.textContent).not.toContain(SPEND_WALLET)
  })

  it('Apps shows skeletons, never the demo policy/draws, while reconnecting', async () => {
    viewedState = { ...HOLD_VIEWED }
    const c = await renderPage(<Apps />)
    expect(c.textContent).toContain('Demo account policy')
    expect(c.textContent).not.toContain('Bounty')
    expect(c.textContent).not.toContain('No draws yet')
  })
})

describe('L8 — a zero-debt trove renders "No debt", never "No trove"', () => {
  const ZERO_DEBT = {
    hasTrove: true,
    coll: 50_000_000_000_000_000n,
    debt: 0n,
    price: 64_608_796_300_000_000_000_000n,
    icr: 2n ** 255n,
    troveStatus: 1,
    error: false, coreError: false, govError: false, gvError: false,
  }

  it('Home dial shows "No debt" for a zero-debt trove', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT, governor: undefined }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('No debt')
    expect(c.textContent).not.toContain('No trove')
  })

  it('Watch ICR card shows "No debt" for a zero-debt trove', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT, governor: undefined }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('No debt')
  })

  it('Draw gauges + "Now" show "No debt" for a zero-debt trove', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT, governor: GOVERNOR, floor: 2_500_000_000_000_000_000n }
    const c = await renderPage(<Draw />)
    expect(c.textContent).toContain('No debt')
    expect(c.textContent).not.toContain('No trove')
  })
})

describe('J1 LOW-2 — Watch never asserts "None" without a needed() read', () => {
  it('shows "Unknown" (not "None") when needed() failed but the policy exists', async () => {
    acctState = { data: { ...SNAP, needed: null }, isLoading: false, isError: false }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('Unknown')
    expect(c.textContent).not.toContain('NothingToDo')
  })
})

describe('MED-1 (round 4) — demo "No debt" is gated on troveStatus === 1', () => {
  it('Home shows "No trove", never "No debt", for a ?account= preview of a never-opened address (status 0)', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Home shows "No trove", never "No debt", for a closed preview (status 2, coll > 0 / debt 0)', async () => {
    acctState = { data: CLOSED_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).toContain('Closed by owner')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Home still shows "No debt" for the zero-debt ACTIVE demo trove (status 1)', async () => {
    acctState = { data: ZERO_DEBT_ACTIVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('No debt')
    expect(c.textContent).not.toContain('No trove')
  })

  it('Watch ICR card shows "No trove", never "No debt", for a status-0 preview', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Watch never asserts "No debt is above the shield line" for a closed trove with a policy', async () => {
    acctState = { data: CLOSED_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
    expect(c.textContent).not.toContain('is above the shield line')
  })

  it('Watch still shows "No debt" for the zero-debt ACTIVE demo trove (status 1)', async () => {
    acctState = { data: ZERO_DEBT_ACTIVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('No debt')
  })

  it('Draw "Now" shows "No trove", never "No debt", for a status-0 preview', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Draw />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Draw "Now" still shows "No debt" for the zero-debt ACTIVE demo trove (status 1)', async () => {
    acctState = { data: ZERO_DEBT_ACTIVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Draw />)
    expect(c.textContent).toContain('No debt')
  })

  it('Close shows "ICR No trove", never "No debt", for a status-0 preview', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Close shows "ICR No trove", never "No debt", for a closed preview (status 2)', async () => {
    acctState = { data: CLOSED_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Close />)
    expect(c.textContent).toContain('not active')
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })
})

describe('MED-2 (round 4) — previewDraw error is fail-CLOSED, never fail-open', () => {
  const CONNECTED_TROVE = {
    ...TROVE_NUMBERS, governor: GOVERNOR, hasTrove: true,
    error: false, coreError: false, govError: false, gvError: false, sysError: false,
  }
  const PREVIEW_OK = { data: [true, '', 1_600_000_000_000_000_000n], isLoading: false, isError: false }
  const PREVIEW_STALE_ERROR = { data: [true, '', 1_600_000_000_000_000_000n], isLoading: false, isError: true }

  it('Draw: a failed refetch after a success disables Sign and shows the error, never the stale "Safe."', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    previewState = { ...PREVIEW_OK }
    const c = await renderPage(<Draw />)
    expect(c.textContent).toContain('Safe.')
    expect(signButton(c)?.disabled).toBe(false)
    previewState = { ...PREVIEW_STALE_ERROR }
    const c2 = await rerenderPage(<Draw />)
    expect(c2.textContent).toContain('Preview failed.')
    expect(c2.textContent).not.toContain('Safe.')
    expect(signButton(c2)?.disabled).toBe(true)
  })

  it('Draw: a never-succeeded preview shows the error plate, not "Checking…" forever (L-g)', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    previewState = { data: undefined, isLoading: false, isError: true }
    const c = await renderPage(<Draw />)
    expect(c.textContent).toContain('Preview failed.')
    expect(c.textContent).not.toContain('Checking with your Governor…')
    expect(signButton(c)?.disabled).toBe(true)
  })

  it('DrawHero: a failed refetch after a success disables Sign and shows the error', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    limitsState = { safe: { suggest: 100_000_000_000_000_000_000n, max: 1_000_000_000_000_000_000_000n } }
    previewState = { ...PREVIEW_OK }
    const c = await renderPage(<Home />)
    expect(signButton(c)?.disabled).toBe(false)
    // LOW-1 (round 6): the pre-filled amount makes the After-draw number
    // visible — it must show the previewed 160.0% while the preview is good…
    expect(c.querySelector('[data-testid="hero-after"]')?.textContent).toContain('160.0%')
    previewState = { ...PREVIEW_STALE_ERROR }
    const c2 = await rerenderPage(<Home />)
    expect(c2.textContent).toContain('Preview failed')
    expect(signButton(c2)?.disabled).toBe(true)
    // …and go blank on the error, never fall back to the local projection
    // beside the "Preview failed" plate.
    expect(c2.querySelector('[data-testid="hero-after"]')?.textContent).toBe('—')
  })

  it('DrawHero: a never-succeeded preview shows the error plate (L-g)', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    limitsState = { safe: { suggest: 100_000_000_000_000_000_000n, max: 1_000_000_000_000_000_000_000n } }
    previewState = { data: undefined, isLoading: false, isError: true }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Preview failed')
    expect(signButton(c)?.disabled).toBe(true)
  })
})

describe('L-a (round 4) — gov/gv rows gate on the Governor batches, never the core read', () => {
  const CORE_FAILED = {
    ...TROVE_NUMBERS, governor: GOVERNOR, hasTrove: true, frozen: false,
    floor: 2_500_000_000_000_000_000n,
    standby: [30_000_000_000_000_000_000n, 1790000000n, 0n, true] as const,
    error: true, coreError: true, govError: false, gvError: false, sysError: false,
  }

  it('Home still shows the Spend route, Floor and Standby heal when only the core read fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CORE_FAILED }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Governed')
    expect(c.textContent).toContain('250%')
    expect(c.textContent).toContain('30.00 MUSD armed')
  })

  it('Watch still shows the armed standby when only the core read fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CORE_FAILED }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('30.00 MUSD')
  })
})

describe('L-b (round 4) — a sys-batch-only failure surfaces on Home', () => {
  it('shows the RPC plate and "Recovery Mode: Unavailable" when only the sys batch fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = {
      ...TROVE_NUMBERS, governor: GOVERNOR, hasTrove: true,
      error: false, coreError: false, govError: false, gvError: false, sysError: true, recoveryMode: undefined,
    }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Could not reach the Mezo testnet RPC')
    expect(c.textContent).toContain('Recovery Mode')
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('draws are paused on-chain')
  })
})

describe('MED-1 (round 5) — Open + Apps were the two missed demo "No debt" sites', () => {
  it('Open shows "ICR No trove", never "No debt", for a ?account= preview of a never-opened address (status 0)', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).toContain('not active')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Open shows "ICR No trove", never "No debt", for a closed preview (status 2, coll > 0 / debt 0)', async () => {
    acctState = { data: CLOSED_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).toContain('not active')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Open still shows "No debt" for the zero-debt ACTIVE demo trove (status 1)', async () => {
    acctState = { data: ZERO_DEBT_ACTIVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('No debt')
    expect(c.textContent).not.toContain('No trove')
  })

  it('Open shows "Unavailable", never "No debt" / "not active", when the status read failed (null)', async () => {
    acctState = { data: { ...ZERO_DEBT_ACTIVE_SNAP, troveStatus: null }, isLoading: false, isError: false }
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('No debt')
    expect(c.textContent).not.toContain('not active')
  })

  it('Open shows "No trove", never "No debt", for a connected own account with no trove', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    ownState = { data: OWN_ACCT, isLoading: false, isError: false }
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Open />)
    expect(c.textContent).toContain('Your account — live on testnet')
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Apps shows "No trove", never "No debt", for a ?account= preview of a never-opened address (status 0)', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Apps />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Apps shows "No trove", never "No debt", for a closed preview (status 2, coll > 0 / debt 0)', async () => {
    acctState = { data: CLOSED_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Apps />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Apps still shows "No debt" for the zero-debt ACTIVE demo trove (status 1)', async () => {
    acctState = { data: ZERO_DEBT_ACTIVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Apps />)
    expect(c.textContent).toContain('No debt')
  })
})

describe('MED-1 (round 5) — ProveIt gates its ICR + status on troveStatus', () => {
  it('still shows the live ICR percent + "active" for the lab account (status 1, debt > 0)', async () => {
    const c = await renderPage(<ProveItPage />)
    expect(c.textContent).toContain('160.2%')
    expect(c.textContent).toContain('active')
    expect(c.textContent).not.toContain('No debt')
  })

  it('shows "No trove", never "No debt", for a status-0 read', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<ProveItPage />)
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).toContain('not active')
    expect(c.textContent).not.toContain('No debt')
  })

  it('shows "Unavailable" for ICR and status, never "No debt" / "not active", when the status read failed (null)', async () => {
    acctState = { data: { ...ZERO_DEBT_ACTIVE_SNAP, troveStatus: null }, isLoading: false, isError: false }
    const c = await renderPage(<ProveItPage />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('No debt')
    expect(c.textContent).not.toContain('not active')
  })
})

describe('LOW-1 (round 5) — Home Dial never asserts "No debt" on an unknown status', () => {
  const dial = (c: HTMLDivElement) => c.querySelector('[data-testid="dial-value"]')

  it('Dial shows "Unavailable", never "No debt", when the sys batch has not returned a status (undefined)', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    // Real useTrove: coll > 0 / debt 0 with statusNum === undefined counts
    // as hasTrove, and t.loading does not cover the sys batch.
    troveState = {
      hasTrove: true, coll: 50_000_000_000_000_000n, debt: 0n,
      price: 64_608_796_300_000_000_000_000n, icr: 2n ** 255n,
      troveStatus: undefined, governor: undefined,
      error: false, coreError: false, govError: false, gvError: false, sysError: false,
    }
    const c = await renderPage(<Home />)
    expect(dial(c)?.textContent).toContain('Unavailable')
    expect(dial(c)?.textContent).not.toContain('No debt')
  })

  it('Dial still shows "No debt" once the status is KNOWN active (status 1)', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = {
      hasTrove: true, coll: 50_000_000_000_000_000n, debt: 0n,
      price: 64_608_796_300_000_000_000_000n, icr: 2n ** 255n,
      troveStatus: 1, governor: undefined,
      error: false, coreError: false, govError: false, gvError: false, sysError: false,
    }
    const c = await renderPage(<Home />)
    expect(dial(c)?.textContent).toContain('No debt')
  })

  it('Dial shows "No trove", never "No debt", for a known-closed zero-debt trove (status 2)', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = {
      hasTrove: false, coll: 10_000_000_000_000_000n, debt: 0n,
      price: 64_608_796_300_000_000_000_000n, icr: 2n ** 255n,
      troveStatus: 2, governor: undefined,
      error: false, coreError: false, govError: false, gvError: false, sysError: false,
    }
    const c = await renderPage(<Home />)
    expect(dial(c)?.textContent).toContain('No trove')
    expect(dial(c)?.textContent).not.toContain('No debt')
  })
})

describe('LOW-2 (round 5) — DemoDraw Gauge agrees with the "Now" text', () => {
  it('Gauge shows "No debt" (aria-label "Current: No debt") for a known status-1 zero-debt trove', async () => {
    acctState = { data: ZERO_DEBT_ACTIVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Draw />)
    expect(c.querySelector('figure[aria-label="Current: No debt"]')).not.toBeNull()
    expect(c.textContent).toContain('No debt')
  })

  it('Gauge shows "—" (no "No debt") for a status-0 preview, matching "No trove" in "Now"', async () => {
    acctState = { data: NO_TROVE_SNAP, isLoading: false, isError: false }
    const c = await renderPage(<Draw />)
    expect(c.querySelector('figure[aria-label="Current: No debt"]')).toBeNull()
    expect(c.textContent).toContain('No trove')
    expect(c.textContent).not.toContain('No debt')
  })
})

describe('LOW-1 (round 6) — the After-draw projection is blank on a preview error, never the local fallback', () => {
  const CONNECTED_TROVE = {
    ...TROVE_NUMBERS, governor: GOVERNOR, hasTrove: true,
    error: false, coreError: false, govError: false, gvError: false, sysError: false,
  }
  const PREVIEW_OK = { data: [true, '', 1_600_000_000_000_000_000n], isLoading: false, isError: false }
  const PREVIEW_STALE_ERROR = { data: [true, '', 1_600_000_000_000_000_000n], isLoading: false, isError: true }
  const PREFILL = { safe: { suggest: 100_000_000_000_000_000_000n, max: 1_000_000_000_000_000_000_000n } }

  it('Draw: the After-draw cell shows the previewed number, then goes blank on a failed refetch', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    limitsState = { ...PREFILL }
    previewState = { ...PREVIEW_OK }
    const c = await renderPage(<Draw />)
    // The safe suggest pre-fills 100 MUSD, so wei > 0 and the projection is
    // visible (with wei 0 the cell is '—' in both states and the bug hides).
    expect(c.querySelector('[data-testid="draw-after"]')?.textContent).toContain('160.0%')
    expect(c.textContent).toContain('Safe.')
    previewState = { ...PREVIEW_STALE_ERROR }
    const c2 = await rerenderPage(<Draw />)
    expect(c2.textContent).toContain('Preview failed.')
    expect(c2.textContent).not.toContain('Safe.')
    expect(signButton(c2)?.disabled).toBe(true)
    expect(c2.querySelector('[data-testid="draw-after"]')?.textContent).toBe('—')
  })

  it('Draw: a failed fee read fails the local projection instead of pricing the draw with fee 0', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    limitsState = { ...PREFILL }
    feeState = { data: undefined, isError: true }
    previewState = { data: undefined, isLoading: true, isError: false }
    const c = await renderPage(<Draw />)
    expect(c.querySelector('[data-testid="draw-after"]')?.textContent).toBe('—')
    expect(c.textContent).not.toContain('Safe.')
  })

  it('DrawHero: a failed fee read blanks the After-draw and debt-after figures and shows the fee as unavailable', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    limitsState = { ...PREFILL }
    feeState = { data: undefined, isError: true }
    previewState = { data: undefined, isLoading: true, isError: false }
    const c = await renderPage(<Home />)
    expect(c.querySelector('[data-testid="hero-after"]')?.textContent).toBe('—')
    expect(c.querySelector('[data-testid="hero-debt-after"]')?.textContent).toBe('—')
    expect(c.querySelector('[data-testid="hero-fee"]')?.textContent).toContain('unavailable')
    expect(c.textContent).not.toContain('Safe.')
    expect(signButton(c)?.disabled).toBe(true)
  })
})

describe('LOW-2 (round 6) — a stale "Unsafe" does not linger in DrawHero once the amount is cleared', () => {
  const CONNECTED_TROVE = {
    ...TROVE_NUMBERS, governor: GOVERNOR, hasTrove: true,
    error: false, coreError: false, govError: false, gvError: false, sysError: false,
  }
  const PREVIEW_UNSAFE = { data: [false, 'BELOW_FLOOR', 1_200_000_000_000_000_000n], isLoading: false, isError: false }

  it('DrawHero: no "Unsafe" line with an empty amount field, even when the retained preview data says unsafe', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    limitsState = {}
    previewState = { ...PREVIEW_UNSAFE }
    const c = await renderPage(<Home />)
    expect(c.textContent).not.toContain('Unsafe:')
    expect(c.textContent).not.toContain('below your safety floor')
  })

  it('DrawHero: the "Unsafe" line still shows while an amount is entered and the preview says unsafe', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...CONNECTED_TROVE }
    limitsState = { safe: { suggest: 100_000_000_000_000_000_000n, max: 1_000_000_000_000_000_000_000n } }
    previewState = { ...PREVIEW_UNSAFE }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Unsafe:')
    expect(c.textContent).toContain('below your safety floor')
  })
})

describe('LOW-3 (round 6) — the own-account "No debt" sites gate on a KNOWN-active status', () => {
  const ZERO_DEBT_UNKNOWN = {
    hasTrove: true, coll: 50_000_000_000_000_000n, debt: 0n,
    price: 64_608_796_300_000_000_000_000n, icr: 2n ** 255n,
    troveStatus: undefined, governor: GOVERNOR, floor: 2_500_000_000_000_000_000n,
    error: false, coreError: false, govError: false, gvError: false, sysError: false,
  }
  const ZERO_DEBT_KNOWN = { ...ZERO_DEBT_UNKNOWN, troveStatus: 1 }

  it('DrawHero "Current" shows "Unavailable", never "No debt", when the sys batch has not returned a status', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT_UNKNOWN }
    const c = await renderPage(<Home />)
    expect(c.querySelector('[data-testid="hero-current"]')?.textContent).toBe('Unavailable')
    expect(c.textContent).not.toContain('No debt')
  })

  it('DrawHero "Current" still shows "No debt" once the status is KNOWN active', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT_KNOWN }
    const c = await renderPage(<Home />)
    expect(c.querySelector('[data-testid="hero-current"]')?.textContent).toBe('No debt')
  })

  it('Draw gauges + "Now" show "Unavailable", never "No debt", when the status is unknown', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT_UNKNOWN }
    const c = await renderPage(<Draw />)
    expect(c.querySelector('figure[aria-label="Current: Unavailable"]')).not.toBeNull()
    expect(c.querySelector('figure[aria-label="After draw: Unavailable"]')).not.toBeNull()
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('No debt')
  })

  it('Draw gauges + "Now" still show "No debt" once the status is KNOWN active', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT_KNOWN }
    const c = await renderPage(<Draw />)
    expect(c.querySelector('figure[aria-label="Current: No debt"]')).not.toBeNull()
    expect(c.textContent).toContain('No debt')
  })

  it('Watch ICR card shows "Unavailable", never "No debt", when the status is unknown', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = { ...ZERO_DEBT_UNKNOWN, governor: undefined }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('Unavailable')
    expect(c.textContent).not.toContain('No debt')
  })
})

describe('LOW-6 (round 6) — the two error batches that surfaced nowhere', () => {
  it('Watch shows "Recovery Mode: Unavailable" when only the connected sys batch fails', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    troveState = {
      ...TROVE_NUMBERS, governor: GOVERNOR, hasTrove: true,
      error: false, coreError: false, govError: false, gvError: false, sysError: true, recoveryMode: undefined,
    }
    const c = await renderPage(<Watch />)
    expect(c.textContent).toContain('Recovery Mode')
    expect(c.textContent).toContain('Unavailable')
    // No ON banner: the static "Recovery Mode — what it does" explainer
    // below still mentions paused draws, so assert on the banner text.
    expect(c.textContent).not.toContain('Recovery Mode is ON')
  })

  it('Home shows the RPC error when the own-account scan fails, never a silent missing CTA', async () => {
    walletState = { ...LIVE }
    viewedState = { ...LIVE_VIEWED }
    ownState = { data: null, isLoading: false, isError: true }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('Could not reach the Mezo testnet RPC')
    expect(c.textContent).not.toContain('You have no credit account yet')
  })
})
