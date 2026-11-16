import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAccount as useWagmiAccount } from 'wagmi'
import { createPublicClient, http, isAddress, type Address } from 'viem'
import { readAccount, type AccountSnapshot } from '../../../sdk/src/account'
import { readMainnetHealth, readRadar, type RadarSnapshot } from '../../../sdk/src/radar'
import { ACCOUNTS, ACCOUNTS_DEPLOY_BLOCK, DEMO_ACCOUNT, DEMO_ACCOUNT_SOURCE, RADAR_TESTNET, mezoMainnet, mezoTestnet } from '../lib/chain'
import { troveAccountFactoryAbi } from '../lib/abi'

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
 * The connected wallet's own TroveAccount, if it has one (plan §6.4.1): the
 * factory has no `accountOf(owner)` lookup — `predict()` needs the creation
 * salt + policy — so the only honest discovery is the factory's
 * `AccountCreated` log, filtered by owner. The newest event wins (an owner
 * can create more than one account). Returns null when the wallet never
 * created an account: callers must show the "no credit account yet" CTA,
 * never the demo account's numbers as the user's own.
 * Chunked in 9,500-block walks like useLogs: the RPC caps one eth_getLogs
 * call at 10,000 blocks.
 */
export async function fetchOwnAccount(
  client: Pick<typeof testnetClient, 'getBlockNumber' | 'getContractEvents'>,
  owner: Address,
): Promise<Address | null> {
  const factory = ACCOUNTS.factory
  if (!factory) return null
  const latest = await client.getBlockNumber()
  const CHUNK = 9500n
  let found: { account: Address; block: bigint; logIndex: number } | null = null
  for (let from = ACCOUNTS_DEPLOY_BLOCK; from <= latest; from += CHUNK + 1n) {
    const to = from + CHUNK > latest ? latest : from + CHUNK
    const logs = await client.getContractEvents({
      address: factory, abi: troveAccountFactoryAbi, eventName: 'AccountCreated',
      args: { owner }, fromBlock: from, toBlock: to,
    })
    for (const l of logs as unknown as { blockNumber: bigint; logIndex: number; args: { account: Address } }[]) {
      if (!found || l.blockNumber > found.block || (l.blockNumber === found.block && l.logIndex > found.logIndex)) {
        found = { account: l.args.account, block: l.blockNumber, logIndex: l.logIndex }
      }
    }
  }
  return found?.account ?? null
}

/** React-query wrapper for fetchOwnAccount: key `['own-account', owner]`, refetch every 30 s. */
export function useOwnAccount(owner?: Address) {
  return useQuery({
    queryKey: ['own-account', owner ?? null],
    queryFn: () => fetchOwnAccount(testnetClient, owner!),
    enabled: !!owner && !!ACCOUNTS.factory,
    refetchInterval: 30_000,
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
