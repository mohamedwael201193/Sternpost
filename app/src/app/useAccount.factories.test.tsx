import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * MED + L7 + L6-timeout tests (fix round 3). ACCOUNT_FACTORIES is mocked via
 * a mutable hoisted array so each test can set up its own factory history
 * (3 factories, future-block entry, no-block entry) without touching
 * testnet.json.
 */
const mockedFactories = vi.hoisted(() => [
  { address: '0x1111111111111111111111111111111111111111', deployBlock: 16803285n },
  { address: '0x2222222222222222222222222222222222222222', deployBlock: 16804466n },
  { address: '0x3333333333333333333333333333333333333333', deployBlock: 16805000n },
])
const DEFAULT_FACTORIES = [...mockedFactories]

vi.mock('../lib/chain', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, ACCOUNT_FACTORIES: mockedFactories }
})

let walletStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting' = 'disconnected'
vi.mock('wagmi', () => ({ useAccount: () => ({ isConnected: false, address: undefined, status: walletStatus }) }))
vi.mock('../../../sdk/src/account', () => ({ readAccount: vi.fn() }))
vi.mock('../../../sdk/src/radar', () => ({ readRadar: vi.fn(), readMainnetHealth: vi.fn() }))

import { clearOwnAccountCache, fetchOwnAccount, scanOwnAccounts, useViewedAccount, RECONNECT_HOLD_TIMEOUT_MS } from './useAccount'

const OWNER = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3' as const
const ACCT_OLD = '0xB094e06559F7aF264e515F5363D9E89920b19b33' as const
const ACCT_NEW = '0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8' as const
const F_OLD = '0x1111111111111111111111111111111111111111'
const F_MID = '0x2222222222222222222222222222222222222222'
const F_NEW = '0x3333333333333333333333333333333333333333'

type Ev = { blockNumber: bigint; logIndex: number; args: { account: string } }
let latestBlock = 16810643n
let eventsByFactory: Record<string, Ev[]> = {}
let throwOnEvents = false
let codeByFactory: Record<string, string> = {}
let warnSpy: ReturnType<typeof vi.spyOn>

function makeClient() {
  return {
    getBlockNumber: vi.fn(async () => latestBlock),
    getContractEvents: vi.fn(async (a: { address: string }) => {
      if (throwOnEvents) throw new Error('rpc died')
      return eventsByFactory[a.address.toLowerCase()] ?? []
    }),
    getCode: vi.fn(async (a: { address: string }) => codeByFactory[a.address.toLowerCase()] ?? '0x60006000'),
  }
}

beforeEach(() => {
  walletStatus = 'disconnected'
  mockedFactories.splice(0, mockedFactories.length, ...DEFAULT_FACTORIES)
  latestBlock = 16810643n
  eventsByFactory = {}
  throwOnEvents = false
  codeByFactory = {}
  clearOwnAccountCache()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('MED — multi-factory scan reads the factories array', () => {
  it('scans all three factories (incl. the superseded-superseded one), newest first', async () => {
    eventsByFactory = {
      [F_OLD]: [{ blockNumber: 16803290n, logIndex: 1, args: { account: ACCT_OLD } }],
      [F_NEW]: [{ blockNumber: 16805010n, logIndex: 0, args: { account: ACCT_NEW } }],
    }
    const client = makeClient()
    const cands = await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    expect(cands).toHaveLength(2)
    expect(cands[0].account).toBe(ACCT_NEW)
    expect(cands[1].account).toBe(ACCT_OLD)
    const addrs = client.getContractEvents.mock.calls.map((c) => (c[0].address as string).toLowerCase())
    expect(addrs).toContain(F_OLD)
    expect(addrs).toContain(F_MID)
    expect(addrs).toContain(F_NEW)
    await expect(fetchOwnAccount(client as never, OWNER as `0x${string}`)).resolves.toBe(ACCT_NEW)
  })

  it('skips a future-block entry with a warning, and still scans the rest', async () => {
    mockedFactories.push({ address: '0x4444444444444444444444444444444444444444', deployBlock: 99999999n })
    const client = makeClient()
    await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    const addrs = client.getContractEvents.mock.calls.map((c) => (c[0].address as string).toLowerCase())
    expect(addrs).not.toContain('0x4444444444444444444444444444444444444444')
    expect(addrs).toContain(F_OLD)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('0x4444444444444444444444444444444444444444'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('after latest block'))
  })

  it('skips a no-block entry with a warning, and still scans the rest', async () => {
    mockedFactories.push({ address: '0x5555555555555555555555555555555555555555', deployBlock: undefined } as unknown as { address: string; deployBlock: bigint })
    const client = makeClient()
    await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    const addrs = client.getContractEvents.mock.calls.map((c) => (c[0].address as string).toLowerCase())
    expect(addrs).not.toContain('0x5555555555555555555555555555555555555555')
    expect(addrs).toContain(F_OLD)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('0x5555555555555555555555555555555555555555'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing deploy block'))
  })

  it('skips a factory with no code on testnet with a warning', async () => {
    codeByFactory[F_MID] = '0x'
    eventsByFactory = {
      [F_OLD]: [{ blockNumber: 16803290n, logIndex: 1, args: { account: ACCT_OLD } }],
    }
    const client = makeClient()
    const cands = await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    const addrs = client.getContractEvents.mock.calls.map((c) => (c[0].address as string).toLowerCase())
    expect(addrs).not.toContain(F_MID)
    expect(addrs).toContain(F_OLD)
    expect(cands).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(F_MID))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no code'))
  })
})

describe('L7 — the forward-only cache never keeps a half-finished scan', () => {
  it('clears the cache when a scan throws, so the next call rescans from the deploy blocks', async () => {
    const client = makeClient()
    await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    // Advance the chain so the next scan actually walks new blocks (otherwise
    // the forward-only cache skips the RPC entirely and nothing can throw).
    latestBlock = 16810700n
    throwOnEvents = true
    await expect(scanOwnAccounts(client as never, OWNER as `0x${string}`)).rejects.toThrow('rpc died')
    throwOnEvents = false
    const before = client.getContractEvents.mock.calls.length
    await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    const fresh = client.getContractEvents.mock.calls.slice(before)
    const fromBlocks = fresh.map((c) => (c[0] as unknown as { fromBlock: bigint }).fromBlock)
    expect(fromBlocks).toContain(16803285n)
    expect(fromBlocks).toContain(16804466n)
    expect(fromBlocks).toContain(16805000n)
  })

  it('clears the cache when the chain comes back below the last scanned block (reorg)', async () => {
    const client = makeClient()
    await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    latestBlock = 16810000n
    const before = client.getContractEvents.mock.calls.length
    await scanOwnAccounts(client as never, OWNER as `0x${string}`)
    const fresh = client.getContractEvents.mock.calls.slice(before)
    expect(fresh.map((c) => (c[0] as unknown as { fromBlock: bigint }).fromBlock)).toContain(16803285n)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reorg'))
  })
})

describe('L6 — the reconnect hold times out and falls back to demo', () => {
  it('releases the hold after 10 s and flags the timeout', async () => {
    expect(RECONNECT_HOLD_TIMEOUT_MS).toBe(10_000)
    vi.useFakeTimers()
    try {
      walletStatus = 'reconnecting'
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root: Root = createRoot(container)
      function Probe() {
        const viewed = useViewedAccount()
        return <div data-reconnecting={String(viewed.reconnecting)} data-timedout={String(viewed.reconnectTimedOut)} />
      }
      await act(async () => {
        root.render(
          <MemoryRouter>
            <Probe />
          </MemoryRouter>,
        )
      })
      const el = container.firstElementChild as HTMLElement
      expect(el.dataset.reconnecting).toBe('true')
      expect(el.dataset.timedout).toBe('false')
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      expect(el.dataset.reconnecting).toBe('false')
      expect(el.dataset.timedout).toBe('true')
      await act(async () => {
        root.unmount()
      })
      container.remove()
    } finally {
      vi.useRealTimers()
      walletStatus = 'disconnected'
    }
  })
})
