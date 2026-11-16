import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DEMO_ACCOUNT } from '../lib/chain'
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
vi.mock('wagmi', () => ({ useAccount: () => ({ isConnected: walletConnected, address: undefined }) }))

const { useAccount, useRadar, useViewedAccount } = await import('./useAccount')

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
        data-viewed={JSON.stringify({ address: viewed.address, source: viewed.source, isDemo: viewed.isDemo, isLabPrototype: viewed.isLabPrototype, demoMode: viewed.demoMode })}
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
