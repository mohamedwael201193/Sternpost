import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, parseAbi, type Address, type Log } from 'viem'
import { troveAccountAbi } from '../lib/abi'
import { ACCOUNTS_DEPLOY_BLOCK, LAB_ACCOUNT_LOGS_FROM_BLOCK, mezoTestnet } from '../lib/chain'

/** Reads use public RPC clients; writes use wagmi (plan §6.2). */
const testnetClient = createPublicClient({ chain: mezoTestnet, transport: http() })

/** Lab TroveAccountV2 events (lab/src/TroveAccountV2.sol): only Drawn + Shielded exist there. */
const troveAccountV2EventsAbi = parseAbi([
  'event Drawn(address indexed agent, address indexed payee, uint256 amount, uint256 icrAfter)',
  'event Shielded(address indexed keeper, uint256 repaid, uint256 collAdded, uint256 icrBefore, uint256 icrAfter)',
])

export type AccountLogRow = {
  event: string
  tx: `0x${string}`
  block: bigint
  logIndex: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any
}

export type AccountLogs = { rows: AccountLogRow[]; fromBlock: bigint }

/**
 * Events emitted by one account contract (plan §6.2 key `['logs', address]`).
 * The Mezo testnet RPC caps one `eth_getLogs` call at 10,000 blocks, so the
 * range is walked in 9,500-block chunks. v3 accounts scan from the account
 * deployment block; the lab v2 account scans from its deploy window.
 * A v2 account's Drawn/Shielded events have different signatures from v3's,
 * so the event ABI follows the account version the `read()` returned.
 */
export async function fetchAccountLogs(address: Address, version: 'v3' | 'v2' | null): Promise<AccountLogs> {
  const fromBlock = version === 'v2' ? LAB_ACCOUNT_LOGS_FROM_BLOCK : ACCOUNTS_DEPLOY_BLOCK
  const abi = version === 'v2' ? troveAccountV2EventsAbi : troveAccountAbi
  const latest = await testnetClient.getBlockNumber()
  const rows: AccountLogRow[] = []
  const CHUNK = 9500n
  for (let from = fromBlock; from <= latest; from += CHUNK + 1n) {
    const to = from + CHUNK > latest ? latest : from + CHUNK
    const logs = (await testnetClient.getContractEvents({ address, abi, fromBlock: from, toBlock: to })) as Log[]
    for (const l of logs as unknown as { eventName: string; transactionHash: `0x${string}`; blockNumber: bigint; logIndex: number; args: unknown }[]) {
      rows.push({ event: l.eventName, tx: l.transactionHash, block: l.blockNumber, logIndex: l.logIndex, args: l.args })
    }
  }
  rows.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block < b.block ? 1 : -1))
  return { rows, fromBlock }
}

export function useAccountLogs(address?: Address, version?: 'v3' | 'v2' | null) {
  return useQuery({
    // The version is part of the key: the scan range + event ABI depend on it,
    // and a fetch started before the account read resolves would scan the
    // wrong range (v3 deploy block) for a v2 account and cache that miss.
    queryKey: ['logs', address ?? null, version ?? 'pending'],
    queryFn: () => fetchAccountLogs(address!, version ?? null),
    enabled: !!address && version !== undefined,
    refetchInterval: 30_000,
  })
}
