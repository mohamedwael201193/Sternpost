import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAccount as useWagmiAccount } from 'wagmi'
import { createPublicClient, http, isAddress, type Address } from 'viem'
import { readAccount, type AccountSnapshot } from '../../../sdk/src/account'
import { readMainnetHealth, readRadar, type RadarSnapshot } from '../../../sdk/src/radar'
import { DEMO_ACCOUNT, DEMO_ACCOUNT_SOURCE, RADAR_TESTNET, mezoMainnet, mezoTestnet } from '../lib/chain'

export type { AccountSnapshot, RadarSnapshot }

/** Plan §6.4.1: shown when the testnet RPC cannot be reached, instead of a stall or a dash. */
export const RPC_ERROR_TEXT = 'Could not reach the Mezo testnet RPC. Retrying every 12 s.'
export const MAINNET_RPC_ERROR_TEXT = 'Could not reach the Mezo mainnet RPC. Retrying every 30 s.'

/** Reads use public RPC clients; writes use wagmi (plan §6.2). */
const testnetClient = createPublicClient({ chain: mezoTestnet, transport: http() })
const mainnetClient = createPublicClient({ chain: mezoMainnet, transport: http() })

export type ViewedAccount = {
  /** The account whose numbers the page shows in read-only mode. */
  address: Address
  /** 'param' = ?account= preview, 'demo' = the public demo account. */
  source: 'param' | 'demo'
  isDemo: boolean
  /** True when the demo account is the lab fallback (plan §6.3). */
  isLabPrototype: boolean
  /** True when no wallet is connected, or when ?account= previews another account. */
  demoMode: boolean
}

/**
 * Which account the app shows read-only (plan §6.3): `?account=0x…` previews any
 * account, otherwise the public demo account from `shared/deployments/testnet.json`
 * (lab fallback while `accounts.demo` is BLOCKED — see lib/chain.ts).
 */
export function useViewedAccount(): ViewedAccount {
  const [params] = useSearchParams()
  const { isConnected } = useWagmiAccount()
  const param = params.get('account')
  const preview = param && isAddress(param) ? (param as Address) : undefined
  const demoMode = !isConnected || !!preview
  if (preview) return { address: preview, source: 'param', isDemo: false, isLabPrototype: false, demoMode }
  return { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: DEMO_ACCOUNT_SOURCE === 'lab', demoMode }
}

/**
 * The single account hook (plan §6.2): one Multicall3 batch via the SDK `read()`,
 * react-query key `['account', address]`, refetch every 12 s.
 */
export function useAccount(address?: Address) {
  return useQuery({
    queryKey: ['account', address ?? null],
    queryFn: () => readAccount(testnetClient, address!),
    enabled: !!address,
    refetchInterval: 12_000,
  })
}

/**
 * Radar read (plan §6.2): key `['radar', network]` + the viewed account (the rank
 * is per-account, so the key carries it — otherwise switching ?account= would serve
 * the previous account's rank). Refetch every 30 s. Testnet reads the deployed
 * Radar contract; mainnet reads Mezo's contracts directly (no Radar deployed).
 */
export function useRadar(network: 'testnet' | 'mainnet', account?: Address) {
  return useQuery({
    queryKey: ['radar', network, account ?? null],
    queryFn: () =>
      network === 'testnet'
        ? readRadar(testnetClient, RADAR_TESTNET!, account)
        : readMainnetHealth(mainnetClient),
    enabled: network === 'mainnet' || !!RADAR_TESTNET,
    refetchInterval: 30_000,
  })
}
