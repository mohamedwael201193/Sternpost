import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ACCOUNT_FACTORIES, DEMO_ACCOUNT, LAB_DEMO_ACCOUNT } from '../lib/chain'
import type { AccountSnapshot } from '../../../sdk/src/account'
import type { RadarSnapshot } from '../../../sdk/src/radar'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The hook reads through the SDK; the RPC is mocked here so the test asserts
// resolution + query keys, not the network.
const viReadAccount = vi.fn()
const viReadRadar = vi.fn()
const viReadMainnetHealth = vi.fn()
vi.mock('../../../sdk/src/account', () => ({ readAccount: (...a: unknown[]) => viReadAccount(...a) }))
vi.mock('../../../sdk/src/radar', () => ({
  readRadar: (...a: unknown[]) => viReadRadar(...a),
  readMainnetHealth: (...a: unknown[]) => viReadMainnetHealth(...a),
}))

let walletConnected = false
let walletStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting' = 'disconnected'
vi.mock('wagmi', () => ({ useAccount: () => ({ isConnected: walletConnected, address: undefined, status: walletStatus }) }))

const { useAccount, useRadar, useViewedAccount, fetchOwnAccount, scanOwnAccounts, clearOwnAccountCache } = await import('./useAccount')

// Live snapshot of the demo account read from Mezo testnet @ block 16810643
// (debt 2016208555450632253551 + price 64608796300000000000000000, verified
// against rpc.test.mezo.org 2026-11-16).
const SNAP: AccountSnapshot = {
  account: DEMO_ACCOUNT,
  owner: '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3',
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

const RADAR_SNAP: RadarSnapshot = {
  // Live snapshot of the testnet Radar read in the same session as SNAP
  // above; its price/TCR pair was not re-found in a 543-block systemHealth
  // scan around block 16810643, so its block is not pinned here.
  network: 'testnet',
  price: 64_607_461_300_000_000_000_000n,
  tcr: 2_320_369_306_368_630_978n,
  recoveryMode: false,
  troveCount: 277n,
  frontier: { trove: '0x5eaA8bdc315608E8Cf873CFAbA05e42826f68C4d', icr: 1_261_431_825_790_504_336n, debt: 426_007_730_005_758_150_239_413_420n },
  rank: { rank: 181n, debtAhead: 426_411_630_632_138_881_447_886_823n, steps: 181n, complete: true },
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderProbe(initialEntries: string[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Probe() {
    const viewed = useViewedAccount()
    const acct = useAccount(viewed.demoMode ? viewed.address : undefined)
    const radar = useRadar('testnet', viewed.demoMode ? viewed.address : undefined)
    return (
      <div
        data-viewed={JSON.stringify({ address: viewed.address, source: viewed.source, isDemo: viewed.isDemo, isLabPrototype: viewed.isLabPrototype, demoMode: viewed.demoMode, reconnecting: viewed.reconnecting })}
        data-acct={acct.data ? JSON.stringify({ icr: acct.data.icr.toString(), debt: acct.data.debt.toString(), version: acct.data.version }) : acct.isLoading ? 'loading' : 'none'}
        data-radar={radar.data ? JSON.stringify({ tcr: radar.data.tcr.toString(), rank: radar.data.rank?.rank.toString() ?? null }) : radar.isLoading ? 'loading' : 'none'}
      />
    )
  }
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={initialEntries}>
        <QueryClientProvider client={qc}>
          <Probe />
        </QueryClientProvider>
      </MemoryRouter>,
    )
  })
  // Let the mocked queries resolve.
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  return { el: container.firstElementChild as HTMLElement, qc }
}

function cleanup() {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
}

beforeEach(() => {
  walletConnected = false
  walletStatus = 'disconnected'
  clearOwnAccountCache()
  viReadAccount.mockReset().mockResolvedValue(SNAP)
  viReadRadar.mockReset().mockResolvedValue(RADAR_SNAP)
  viReadMainnetHealth.mockReset().mockResolvedValue({ ...RADAR_SNAP, network: 'mainnet', frontier: null, rank: null })
  cleanup()
})

describe('useViewedAccount (plan §6.3 demo resolution)', () => {
  it('uses the lab demo account with the LAB PROTOTYPE flag when no wallet is connected', async () => {
    const { el } = await renderProbe(['/app'])
    const viewed = JSON.parse(el.dataset.viewed!)
    expect(viewed.address.toLowerCase()).toBe(DEMO_ACCOUNT.toLowerCase())
    expect(viewed.source).toBe('demo')
    expect(viewed.isDemo).toBe(true)
    expect(viewed.isLabPrototype).toBe(true)
    expect(viewed.demoMode).toBe(true)
    expect(viReadAccount).toHaveBeenCalled()
    const acct = JSON.parse(el.dataset.acct!)
    expect(acct.version).toBe('v2')
    expect(acct.icr).toBe('1602234950480101128')
    expect(acct.debt).toBe('2016208555450632253551')
  })

  it('flags reconnecting while wagmi restores the session (LOW-3: demo numbers must not flash)', async () => {
    walletConnected = false
    walletStatus = 'reconnecting'
    const { el } = await renderProbe(['/app'])
    const viewed = JSON.parse(el.dataset.viewed!)
    expect(viewed.demoMode).toBe(true)
    expect(viewed.reconnecting).toBe(true)
  })

  it('does not flag reconnecting once the wallet is connected', async () => {
    walletConnected = true
    walletStatus = 'connected'
    const { el } = await renderProbe(['/app'])
    const viewed = JSON.parse(el.dataset.viewed!)
    expect(viewed.demoMode).toBe(false)
    expect(viewed.reconnecting).toBe(false)
  })

  it('?account= previews any account read-only', async () => {
    const other = '0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8'
    const { el } = await renderProbe([`/app?account=${other}`])
    const viewed = JSON.parse(el.dataset.viewed!)
    expect(viewed.address.toLowerCase()).toBe(other.toLowerCase())
    expect(viewed.source).toBe('param')
    expect(viewed.isDemo).toBe(false)
    expect(viewed.demoMode).toBe(true)
    expect(viReadAccount.mock.calls[0][1].toLowerCase()).toBe(other.toLowerCase())
  })

  it('?account= previews read-only even when a wallet is connected', async () => {
    walletConnected = true
    const other = '0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8'
    const { el } = await renderProbe([`/app/watch?account=${other}`])
    expect(JSON.parse(el.dataset.viewed!).demoMode).toBe(true)
    expect(JSON.parse(el.dataset.viewed!).source).toBe('param')
  })

  it('an invalid ?account= falls back to the demo account', async () => {
    const { el } = await renderProbe(['/app?account=not-an-address'])
    expect(JSON.parse(el.dataset.viewed!).source).toBe('demo')
    expect(JSON.parse(el.dataset.viewed!).address.toLowerCase()).toBe(DEMO_ACCOUNT.toLowerCase())
  })
})

describe('useRadar (plan §6.2)', () => {
  it('reads the testnet Radar with the viewed account rank', async () => {
    const { el } = await renderProbe(['/app'])
    const radar = JSON.parse(el.dataset.radar!)
    expect(radar.tcr).toBe('2320369306368630978')
    expect(radar.rank).toBe('181')
    expect(viReadRadar).toHaveBeenCalled()
  })
})

describe('fetchOwnAccount (plan §6.4.1: connected users see their own account, never the demo numbers)', () => {
  const OWNER = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3' as const
  // NOTE (J2 H1): the lab account 0x5A11…89Df must NOT appear here as a
  // factory event — it predates both factories and was never created through
  // either. A factory-event test uses a plain stand-in account instead; the
  // lab account is covered by the allowance-path tests below.
  const ACCT = '0xB094e06559F7aF264e515F5363D9E89920b19b33' as const
  const OTHER = '0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8' as const
  const OLD_ACCT = '0x9Cd95A420e014da798dbFB74833b9D4DEe868be2' as const
  type Client = Parameters<typeof fetchOwnAccount>[0]
  type Ev = { blockNumber: bigint; logIndex: number; args: { account: string } }
  const stub = (events: Ev[]) =>
    ({
      getBlockNumber: vi.fn().mockResolvedValue(16804470n),
      getContractEvents: vi.fn().mockResolvedValue(events),
    }) as unknown as Client
  const stubByFactory = (byAddress: Record<string, Ev[]>) =>
    ({
      getBlockNumber: vi.fn().mockResolvedValue(16804470n),
      getContractEvents: vi.fn(async (a: { address: string }) => byAddress[a.address.toLowerCase()] ?? []),
    }) as unknown as Client
  const [CURRENT_FACTORY, PREV_FACTORY] = ACCOUNT_FACTORIES.map((f) => f.address.toLowerCase())

  it('returns the newest AccountCreated for the owner', async () => {
    const client = stub([
      { blockNumber: 16804466n, logIndex: 0, args: { account: OTHER } },
      { blockNumber: 16804468n, logIndex: 2, args: { account: ACCT } },
    ])
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`)).resolves.toBe(ACCT)
    expect((client.getContractEvents as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      eventName: 'AccountCreated',
      args: { owner: OWNER },
    })
  })

  it('returns null when the owner never created an account', async () => {
    await expect(fetchOwnAccount(stub([]), OWNER as `0x${string}`)).resolves.toBeNull()
  })

  it('scans every known factory (MED-1): an account only on the superseded 1.9 factory is found', async () => {
    const client = stubByFactory({
      [PREV_FACTORY]: [{ blockNumber: 16803290n, logIndex: 1, args: { account: OLD_ACCT } }],
    })
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`)).resolves.toBe(OLD_ACCT)
    const addrs = (client.getContractEvents as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0].address as string).toLowerCase())
    expect(addrs).toContain(CURRENT_FACTORY)
    expect(addrs).toContain(PREV_FACTORY)
  })

  it('a newer account on the current factory beats an older one on the superseded factory', async () => {
    const client = stubByFactory({
      [PREV_FACTORY]: [{ blockNumber: 16803290n, logIndex: 1, args: { account: OLD_ACCT } }],
      [CURRENT_FACTORY]: [{ blockNumber: 16804468n, logIndex: 2, args: { account: ACCT } }],
    })
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`)).resolves.toBe(ACCT)
  })

  it('prefers the newest ACTIVE trove over a newer closed one (LOW-1)', async () => {
    const client = stub([
      { blockNumber: 16804466n, logIndex: 0, args: { account: OTHER } },
      { blockNumber: 16804468n, logIndex: 2, args: { account: ACCT } },
    ])
    const readStatus = async (a: `0x${string}`) => (a.toLowerCase() === ACCT.toLowerCase() ? 2 : 1)
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`, { readStatus })).resolves.toBe(OTHER)
  })

  it('falls back to the newest overall when no candidate is active (LOW-1)', async () => {
    const client = stub([
      { blockNumber: 16804466n, logIndex: 0, args: { account: OTHER } },
      { blockNumber: 16804468n, logIndex: 2, args: { account: ACCT } },
    ])
    const readStatus = async () => 3
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`, { readStatus })).resolves.toBe(ACCT)
  })

  it('rescans forward only on refetch (LOW-2): the second call walks new blocks, not the deploy block', async () => {
    const getBlockNumber = vi.fn().mockResolvedValueOnce(16804470n).mockResolvedValue(16804500n)
    const getContractEvents = vi.fn().mockResolvedValue([])
    const client = { getBlockNumber, getContractEvents } as unknown as Client
    await fetchOwnAccount(client, OWNER as `0x${string}`)
    await fetchOwnAccount(client, OWNER as `0x${string}`)
    expect(getContractEvents.mock.calls).toHaveLength(4)
    // First call starts at each factory's deploy block.
    expect(getContractEvents.mock.calls[0][0].fromBlock).toBe(16804466n)
    expect(getContractEvents.mock.calls[1][0].fromBlock).toBe(16803285n)
    // Second call starts just after the last scanned block, for both factories.
    for (const c of getContractEvents.mock.calls.slice(2)) {
      expect(c[0].fromBlock).toBe(16804471n)
      expect(c[0].toBlock).toBe(16804500n)
    }
  })

  it('includes the known lab account when a live owner() call returns this owner (J2 H1)', async () => {
    const client = stub([])
    const readLabOwner = async () => OWNER as `0x${string}`
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`, { readLabOwner })).resolves.toBe(LAB_DEMO_ACCOUNT)
    const cands = await scanOwnAccounts(client, OWNER as `0x${string}`, { readLabOwner })
    expect(cands).toHaveLength(1)
    expect(cands[0]).toMatchObject({ account: LAB_DEMO_ACCOUNT, source: 'lab' })
  })

  it('excludes the lab account when owner() returns someone else (J2 H1)', async () => {
    const client = stub([])
    const readLabOwner = async () => OTHER as `0x${string}`
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`, { readLabOwner })).resolves.toBeNull()
  })

  it('the lab account loses to a newer factory account (newest wins across sources)', async () => {
    const client = stub([{ blockNumber: 16804468n, logIndex: 2, args: { account: ACCT } }])
    const readLabOwner = async () => OWNER as `0x${string}`
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`, { readLabOwner })).resolves.toBe(ACCT)
  })

  it('the lab account wins over a newer CLOSED factory account when it is the only active one (H1 + LOW-1)', async () => {
    const client = stub([{ blockNumber: 16804468n, logIndex: 2, args: { account: ACCT } }])
    const readLabOwner = async () => OWNER as `0x${string}`
    const readStatus = async (a: `0x${string}`) => (a.toLowerCase() === LAB_DEMO_ACCOUNT.toLowerCase() ? 1 : 2)
    await expect(fetchOwnAccount(client, OWNER as `0x${string}`, { readLabOwner, readStatus })).resolves.toBe(LAB_DEMO_ACCOUNT)
  })
})
