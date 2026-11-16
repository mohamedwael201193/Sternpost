import { useEffect, useState } from 'react'
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
/** Round 9 (J2 LOW-3): shown when the RPC answered but one view reverted — a per-slot failure is not a transport failure, so the plate must not claim the RPC could not be reached. Round 10 (J1 LOW-2): the copy is plural-aware — a multi-slot failure is "one or more views", never "one view". */
export const SLOT_ERROR_TEXT = 'A Mezo testnet read failed — one or more views reverted while the RPC answered. Retrying automatically.'
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
  /**
   * True once the reconnect hold has timed out (RECONNECT_HOLD_TIMEOUT_MS):
   * the wallet is (probably) not coming back, so the hold falls back to the
   * demo numbers and the DemoBanner says so — the hold must never hang the
   * page forever on a wallet that never reconnects (L6).
   */
  reconnectTimedOut: boolean
}

/**
 * Which account the app shows read-only (plan §6.3): `?account=0x…` previews any
 * account, otherwise the public demo account from `shared/deployments/testnet.json`
 * (lab fallback while `accounts.demo` is BLOCKED — see lib/chain.ts).
 */
/** How long the reconnect hold waits for wagmi before falling back to demo (L6). */
export const RECONNECT_HOLD_TIMEOUT_MS = 10_000

export function useViewedAccount(): ViewedAccount {
  const [params] = useSearchParams()
  const { isConnected, status } = useWagmiAccount()
  const param = params.get('account')
  const preview = param && isAddress(param) ? (param as Address) : undefined
  const demoMode = !isConnected || !!preview
  // 'connecting' (first connect) and 'reconnecting' (hard-load restore) both
  // leave isConnected false while a wallet is on its way back.
  const rawReconnecting = status === 'reconnecting' || status === 'connecting'
  // L6: the hold must not hang forever — after the timeout the wallet is
  // (probably) not coming back, so the hold releases and the page falls back
  // to the demo numbers with a note in the DemoBanner.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    if (!rawReconnecting) { setTimedOut(false); return }
    const id = setTimeout(() => setTimedOut(true), RECONNECT_HOLD_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [rawReconnecting])
  const reconnecting = rawReconnecting && !timedOut
  const reconnectTimedOut = timedOut
  if (preview) return { address: preview, source: 'param', isDemo: false, isLabPrototype: false, demoMode, reconnecting, reconnectTimedOut }
  return { address: DEMO_ACCOUNT, source: 'demo', isDemo: true, isLabPrototype: DEMO_ACCOUNT_SOURCE === 'lab', demoMode, reconnecting, reconnectTimedOut }
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
 *     newest-active ordering as factory accounts (ordered at the
 *     LAB_ACCOUNT_LOGS_FROM_BLOCK anchor, 16790000 — an ordering anchor
 *     before all factory blocks, NOT at its open block).
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
  /** Optional eth_getCode: when the client supports it, a factory entry with no code is skipped with a warning (MED). */
  getCode?: (args: { address: Address }) => Promise<string | undefined>
  /**
   * Optional block read (L-e, round 4): when the client supports it, the hash
   * of the last scanned block is stored per factory and a same-height reorg
   * (hash changed at a height already scanned) clears the scan cache.
   */
  getBlock?: (args: { blockNumber: bigint }) => Promise<{ hash: string | null } | null | undefined>
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
const ownScanCache = new Map<string, { candidates: OwnAccountCandidate[]; scannedTo: Map<string, bigint>; scannedHash: Map<string, { block: bigint; hash: string }> }>()

/** L-f (round 4): a never-scanned future-block factory warns on EVERY 30 s refetch — remember which ones already warned, per address + block. */
const warnedFutureBlock = new Set<string>()

/** Test-only: drop the forward-only scan cache (vitest calls this in beforeEach). */
export function clearOwnAccountCache() {
  ownScanCache.clear()
  warnedFutureBlock.clear()
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
  // L7 (reorg signal): the chain came back BELOW a block we already scanned —
  // logs we recorded may have been reorged away, so drop the cache and rescan
  // from the deploy blocks instead of trusting the stale candidates.
  if (entry) {
    for (const scanned of entry.scannedTo.values()) {
      if (scanned > latest) {
        console.warn(`[scanOwnAccounts] latest block ${latest} is below previously scanned ${scanned} (reorg?) — clearing the scan cache for ${owner}`)
        ownScanCache.delete(key)
        entry = undefined
        break
      }
    }
  }
  if (!entry) {
    entry = { candidates: [], scannedTo: new Map(), scannedHash: new Map() }
    ownScanCache.set(key, entry)
  }
  // L-d (round 4): the same factory address twice with differing blocks —
  // scannedTo is keyed by address, so scanning the later entry second would
  // start after `latest` and silently drop the earlier range. Scan each
  // address once, from its EARLIEST block. (chain.ts dedupes the production
  // list too; this covers any caller-supplied list.) Copies are scanned so a
  // merged block never mutates the shared ACCOUNT_FACTORIES list.
  const factories: typeof ACCOUNT_FACTORIES = []
  const factoryByAddress = new Map<string, (typeof ACCOUNT_FACTORIES)[number]>()
  for (const f of ACCOUNT_FACTORIES) {
    const addr = (f as { address?: unknown } | null)?.address
    if (typeof addr !== 'string') { factories.push(f); continue }
    const prev = factoryByAddress.get(addr.toLowerCase())
    if (!prev) {
      const copy = { ...f }
      factoryByAddress.set(addr.toLowerCase(), copy)
      factories.push(copy)
      continue
    }
    const prevBlock = (prev as { deployBlock?: unknown }).deployBlock
    const thisBlock = (f as { deployBlock?: unknown }).deployBlock
    console.warn(`[scanOwnAccounts] duplicate factory address ${addr}: scanning from the earliest block`)
    if (typeof thisBlock === 'bigint' && typeof prevBlock === 'bigint' && thisBlock < prevBlock) {
      (prev as { deployBlock: bigint }).deployBlock = thisBlock
    }
  }
  // L-e (round 4): a same-height reorg — the chain did NOT come back below
  // the scanned block, but the block hash at a height already scanned changed,
  // so logs recorded at that height may be gone. Compare the stored hash per
  // factory; on a mismatch drop the cache and rescan. A client without
  // getBlock (or a failed hash read) simply skips the check.
  // LOW-4 (round 6): the check read and the store read below are two
  // separate calls. If the check read FAILS, the cache is kept — but the
  // store read would then overwrite the stored hash with the post-reorg
  // head hash, erasing the reorg signal the next call should have caught.
  // Remember which factories could not be verified and do NOT overwrite
  // their stored hash this round; the old hash stays so the next call
  // retries the check against the original block.
  const unverifiedHash = new Set<string>()
  if (entry && typeof client.getBlock === 'function') {
    for (const f of factories) {
      const stored = entry.scannedHash.get(f.address)
      if (!stored) continue
      let current: { hash: string | null } | null | undefined
      try {
        current = await client.getBlock({ blockNumber: stored.block })
      } catch {
        current = undefined // unverifiable: keep the cache, never clear on a read failure
      }
      if (!current?.hash) unverifiedHash.add(f.address.toLowerCase())
      if (current?.hash && current.hash !== stored.hash) {
        console.warn(`[scanOwnAccounts] block ${stored.block} hash changed for factory ${f.address} (reorg?) — clearing the scan cache for ${owner}`)
        ownScanCache.delete(key)
        entry = undefined
        break
      }
    }
  }
  if (!entry) {
    entry = { candidates: [], scannedTo: new Map(), scannedHash: new Map() }
    ownScanCache.set(key, entry)
  }
  try {
    for (const f of factories) {
      // MED: a bad factory entry must never fail silently — skip it AND warn,
      // with the address and the reason, so a bad testnet.json entry (or a
      // redeploy that left a stale address) shows up instead of silently
      // dropping that factory's accounts into "no credit account yet".
      const addr = (f as { address?: unknown } | null)?.address
      if (typeof addr !== 'string' || !isAddress(addr)) {
        console.warn(`[scanOwnAccounts] skipping factory entry with an invalid address: ${String(addr)}`)
        continue
      }
      const deployBlock = (f as { deployBlock?: unknown }).deployBlock
      if (typeof deployBlock !== 'bigint') {
        console.warn(`[scanOwnAccounts] skipping factory ${addr}: missing deploy block`)
        continue
      }
      const scanned = entry.scannedTo.get(f.address)
      const from0 = scanned !== undefined ? scanned + 1n : deployBlock
      // A never-scanned factory whose deploy block is in the future is bad
      // data, not an empty result — warn. (An already-scanned factory with
      // from0 > latest is the normal forward-only case: no new blocks yet.)
      if (from0 > latest) {
        // L-f (round 4): warn once per factory — a never-scanned future-block
        // factory otherwise warns on EVERY 30 s refetch.
        if (scanned === undefined) {
          const warnKey = `${addr.toLowerCase()}:${String(deployBlock)}`
          if (!warnedFutureBlock.has(warnKey)) {
            warnedFutureBlock.add(warnKey)
            console.warn(`[scanOwnAccounts] skipping factory ${addr}: deploy block ${deployBlock} is after latest block ${latest}`)
          }
        }
        continue
      }
      // A factory address with no code on testnet cannot have emitted logs.
      if (typeof client.getCode === 'function') {
        let code: string | undefined
        try {
          code = await client.getCode({ address: f.address })
        } catch {
          code = undefined // unverifiable: let the log scan decide below
        }
        if (code !== undefined && code === '0x') {
          console.warn(`[scanOwnAccounts] skipping factory ${addr}: no code at that address on testnet`)
          continue
        }
      }
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
      // L-e (round 4): remember the hash of the last scanned block so a
      // same-height reorg is detectable on the next call.
      // LOW-4 (round 6): never overwrite when this round's check read
      // failed — see the unverifiedHash note above.
      if (typeof client.getBlock === 'function' && !unverifiedHash.has(f.address.toLowerCase())) {
        try {
          const head = await client.getBlock({ blockNumber: latest })
          if (head?.hash) entry.scannedHash.set(f.address, { block: latest, hash: head.hash })
        } catch { /* unverifiable: the hash check simply does not apply */ }
      }
    }
  } catch (e) {
    // L7: a failed scan must not leave a half-advanced cache behind — a
    // truncated RPC response that advanced scannedTo would keep the missed
    // events missed for the whole session. Drop the entry so the next call
    // rescans from the deploy blocks.
    ownScanCache.delete(key)
    throw e
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
