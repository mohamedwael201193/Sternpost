import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAccount as useWagmiAccount } from 'wagmi'
import { createPublicClient, http, isAddress, type Address } from 'viem'
import { readAccount, type AccountSnapshot } from '../../../sdk/src/account'
import { readMainnetHealth, readRadar, type RadarSnapshot } from '../../../sdk/src/radar'
import { ACCOUNT_FACTORIES, DEMO_ACCOUNT, DEMO_ACCOUNT_SOURCE, LAB_ACCOUNT_LOGS_FROM_BLOCK, LAB_DEMO_ACCOUNT, MEZO, RADAR_TESTNET, mezoMainnet, mezoTestnet } from '../lib/chain'
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
  /**
   * True while wagmi is still (re)connecting on a hard load: isConnected is
   * false in that window, so demoMode is true — but the demo numbers are NOT
   * settled yet. Close/Open hold the demo branch on this flag and show a
   * skeleton instead of flashing demo numbers for a wallet that is about to
   * reconnect (LOW-3).
   */
  reconnecting: boolean
}

/**
 * Which account the app shows read-only (plan §6.3): `?account=0x…` previews any
 * account, otherwise the public demo account from `shared/deployments/testnet.json`
 * (lab fallback while `accounts.demo` is BLOCKED — see lib/chain.ts).
 */
export function useViewedAccount(): ViewedAccount {
  const [params] = useSearchParams()
  const { isConnected, status } = useWagmiAccount()
  const param = params.get('account')
  const preview = param && isAddress(param) ? (param as Address) : undefined
  const demoMode = !isConnected || !!preview
  // 'connecting' (first connect) and 'reconnecting' (hard-load restore) both
  // leave isConnected false while a wallet is on its way back.
  const reconnecting = status === 'reconnecting' || status === 'connecting'
  if (preview) return { address: preview, source: 'param', isDemo: false, isLabPrototype: false, demoMode, reconnecting }
  return { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: DEMO_ACCOUNT_SOURCE === 'lab', demoMode, reconnecting }
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
 * `AccountCreated` log, filtered by owner. Returns null when the wallet never
 * created an account: callers must show the "no credit account yet" CTA,
 * never the demo account's numbers as the user's own.
 *
 * Discovery covers THREE sources, newest first (MED-1 + J2 H1):
 *  1. every known factory in ACCOUNT_FACTORIES (current + superseded, read
 *     from shared/deployments/testnet.json) — a redeploy must not orphan
 *     existing accounts into a false "no credit account yet";
 *  2. the known lab account (LAB_DEMO_ACCOUNT): it predates both factories
 *     (opened ~16790909 < 1.9 factory block 16803285) and was never created
 *     through either, so no factory scan can ever find it — yet it IS the
 *     deployer's account (live owner() + active trove). It is included ONLY
 *     when a live owner() eth_call on the lab account returns this owner
 *     (never a hardcoded owner address), and it competes on the same
 *     newest-active ordering as factory accounts (ordered at its open block).
 * Chunked in 9,500-block walks like useLogs: the RPC caps one eth_getLogs
 * call at 10,000 blocks.
 *
 * The scan is forward-only (LOW-2): the found candidates and the last scanned
 * block per factory are cached per owner, so the 30 s refetch walks only new
 * blocks instead of re-walking from the deploy block every time.
 *
 * Newest-active preference (LOW-1 / J2 L1): among all candidates the newest
 * ACTIVE trove (TroveManager status 1) wins; when none is active, the newest
 * overall wins. Status is read via `opts.readStatus` (tests) or, when the
 * client supports it, a live getTroveStatus eth_call. Without a status reader
 * the newest overall wins, as before. NOTE on isAccount(): the factory's
 * isAccount() mapping cannot be used as a candidate filter — it returns false
 * for the lab account on both factories (it predates them), so gating on it
 * would re-introduce exactly the H1 false negative.
 */
export type OwnAccountCandidate = {
  account: Address
  block: bigint
  logIndex: number
  /** 'factory' = an AccountCreated log, 'lab' = the known-lab-account allowance (H1). */
  source: 'factory' | 'lab'
  /** The factory that emitted the log; null for the lab allowance. */
  factory: Address | null
}

export type FetchOwnAccountOpts = {
  /** TroveManager status for a candidate (1 = active). Defaults to a live getTroveStatus call. */
  readStatus?: (account: Address) => Promise<number | null>
  /** Live owner() of the lab account. Defaults to a live owner() eth_call on LAB_DEMO_ACCOUNT. */
  readLabOwner?: () => Promise<Address | null>
}

export type OwnAccountClient = Pick<typeof testnetClient, 'getBlockNumber' | 'getContractEvents'> & {
  readContract?: typeof testnetClient.readContract
}

const troveManagerStatusAbi = [
  { type: 'function', name: 'getTroveStatus', stateMutability: 'view', inputs: [{ name: 'borrower', type: 'address' }], outputs: [{ name: '', type: 'uint8' }] },
] as const
const troveAccountOwnerAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

function defaultReadStatus(client: OwnAccountClient): FetchOwnAccountOpts['readStatus'] | undefined {
  if (typeof client.readContract !== 'function') return undefined
  return async (account) => {
    try {
      const s = await client.readContract!({
        address: MEZO.troveManager, abi: troveManagerStatusAbi, functionName: 'getTroveStatus', args: [account],
      })
      return typeof s === 'number' ? s : Number(s)
    } catch { return null }
  }
}

function defaultReadLabOwner(client: OwnAccountClient): FetchOwnAccountOpts['readLabOwner'] | undefined {
  if (typeof client.readContract !== 'function') return undefined
  return async () => {
    try {
      return await client.readContract!({
        address: LAB_DEMO_ACCOUNT, abi: troveAccountOwnerAbi, functionName: 'owner',
      }) as Address
    } catch { return null }
  }
}

const CHUNK = 9500n
const ownScanCache = new Map<string, { candidates: OwnAccountCandidate[]; scannedTo: Map<string, bigint> }>()

/** Test-only: drop the forward-only scan cache (vitest calls this in beforeEach). */
export function clearOwnAccountCache() {
  ownScanCache.clear()
}

/** All candidates for an owner, newest first, de-duplicated by account. */
export async function scanOwnAccounts(
  client: OwnAccountClient,
  owner: Address,
  opts: FetchOwnAccountOpts = {},
): Promise<OwnAccountCandidate[]> {
  const latest = await client.getBlockNumber()
  const key = owner.toLowerCase()
  let entry = ownScanCache.get(key)
  if (!entry) {
    entry = { candidates: [], scannedTo: new Map() }
    ownScanCache.set(key, entry)
  }
  for (const f of ACCOUNT_FACTORIES) {
    const scanned = entry.scannedTo.get(f.address)
    const from0 = scanned !== undefined ? scanned + 1n : f.deployBlock
    if (from0 > latest) continue
    for (let from = from0; from <= latest; from += CHUNK + 1n) {
      const to = from + CHUNK > latest ? latest : from + CHUNK
      const logs = await client.getContractEvents({
        address: f.address, abi: troveAccountFactoryAbi, eventName: 'AccountCreated',
        args: { owner }, fromBlock: from, toBlock: to,
      })
      for (const l of logs as unknown as { blockNumber: bigint; logIndex: number; args: { account: Address } }[]) {
        entry.candidates.push({ account: l.args.account, block: l.blockNumber, logIndex: l.logIndex, source: 'factory', factory: f.address })
      }
    }
    entry.scannedTo.set(f.address, latest)
  }
  const all = [...entry.candidates]
  // H1 lab allowance: verified live per call (owner() can only be trusted
  // from the chain, never from a hardcoded address), and never cached.
  const readLabOwner = opts.readLabOwner ?? defaultReadLabOwner(client)
  if (readLabOwner) {
    try {
      const labOwner = await readLabOwner()
      if (labOwner && labOwner.toLowerCase() === owner.toLowerCase()) {
        all.push({ account: LAB_DEMO_ACCOUNT, block: LAB_ACCOUNT_LOGS_FROM_BLOCK, logIndex: 0, source: 'lab', factory: null })
      }
    } catch { /* unverifiable ownership: the allowance simply does not apply */ }
  }
  const sorted = all.sort((a, b) => (a.block !== b.block ? Number(b.block - a.block) : b.logIndex - a.logIndex))
  const seen = new Set<string>()
  return sorted.filter((c) => {
    const k = c.account.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export async function fetchOwnAccount(
  client: OwnAccountClient,
  owner: Address,
  opts: FetchOwnAccountOpts = {},
): Promise<Address | null> {
  const candidates = await scanOwnAccounts(client, owner, opts)
  if (!candidates.length) return null
  const readStatus = opts.readStatus ?? defaultReadStatus(client)
  if (!readStatus) return candidates[0].account
  for (const c of candidates) {
    try {
      if ((await readStatus(c.account)) === 1) return c.account
    } catch { /* unknown status: keep looking for a confirmed-active one */ }
  }
  return candidates[0].account
}

/** React-query wrapper for fetchOwnAccount: key `['own-account', owner]`, refetch every 30 s. */
export function useOwnAccount(owner?: Address) {
  return useQuery({
    queryKey: ['own-account', owner ?? null],
    queryFn: () => fetchOwnAccount(testnetClient, owner!),
    enabled: !!owner && ACCOUNT_FACTORIES.length > 0,
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
