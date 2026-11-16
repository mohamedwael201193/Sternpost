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

vi.mock('wagmi', () => ({
  useAccount: () => walletState,
  usePublicClient: () => null,
  useReadContract: (a: any) => (a?.functionName === 'walletsOf' ? { data: [SPEND_WALLET] } : { data: undefined }),
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
  useTrove: () => ({ address: walletState.address, isConnected: walletState.isConnected, hasTrove: false, governor: undefined, loading: false, sysLoading: false, sysError: false }),
}))
vi.mock('../useLimits', () => ({ useLimits: () => ({}) }))
vi.mock('../api', () => ({ useApiList: () => ({ state: 'off', items: [] }), useSetRequestStatus: () => vi.fn() }))

import Close from './Close'
import Open from './Open'
import Apps from './Apps'
import Pay, { PayRow } from './Pay'
import Draw from './Draw'
import Home from './Home'

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
  it('shows "No shield needed" (not "No policy") when needed() failed but the policy exists', async () => {
    acctState = { data: { ...SNAP, needed: null }, isLoading: false, isError: false }
    const c = await renderPage(<Home />)
    expect(c.textContent).toContain('No shield needed')
    expect(c.textContent).not.toContain('No policy')
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
