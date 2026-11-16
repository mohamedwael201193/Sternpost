import { useAccount, useBalance, useReadContract, useReadContracts } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { MEZO, STERNPOST } from '../lib/chain'
import { erc20Abi, factoryAbi, governorAbi, priceFeedAbi, signaturesAbi, troveManagerAbi } from '../lib/abi'
import { icr, troveTotals } from '../lib/icr'

const live = { refetchInterval: 15_000 }

// getEntireDebtAndColl already folds pending redistribution into its first three returns; the extra
// reads below need no new ABI file: they are declared inline here.
const troveManagerExtraAbi = [
  { type: 'function', name: 'getTroveStatus', stateMutability: 'view', inputs: [{ name: 'borrower', type: 'address' }], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'checkRecoveryMode', stateMutability: 'view', inputs: [{ name: 'price', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'getTCR', stateMutability: 'view', inputs: [{ name: 'price', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

/** TroveManager status enum: 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption. */
export const TROVE_STATUS_LABEL: Record<number, string> = {
  0: 'No trove',
  1: 'Active',
  2: 'Closed by owner',
  3: 'Liquidated',
  4: 'Closed by redemption',
}

/** Everything the dashboard needs about the connected borrower, read live from Mezo testnet. */
export function useTrove() {
  const { address, isConnected } = useAccount()
  const who = (address ?? zeroAddress) as Address
  const enabled = isConnected

  const gov = useReadContract({
    address: STERNPOST.factory, abi: factoryAbi, functionName: 'governorOf', args: [who],
    query: { enabled: enabled && !!STERNPOST.factory, ...live },
  })
  const governor = gov.data && gov.data !== zeroAddress ? (gov.data as Address) : undefined

  const core = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: MEZO.troveManager, abi: troveManagerAbi, functionName: 'getEntireDebtAndColl', args: [who] },
      { address: MEZO.priceFeed, abi: priceFeedAbi, functionName: 'fetchPrice' },
      { address: MEZO.musd, abi: erc20Abi, functionName: 'balanceOf', args: [who] },
      { address: MEZO.smusd, abi: erc20Abi, functionName: 'balanceOf', args: [who] },
      { address: MEZO.signatures, abi: signaturesAbi, functionName: 'getNonce', args: [who] },
      { address: MEZO.mezo, abi: erc20Abi, functionName: 'balanceOf', args: [who] },
    ],
    query: { enabled, ...live },
  })
  const g = governor ?? zeroAddress
  const gv = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: g, abi: governorAbi, functionName: 'floorICR' },
      { address: g, abi: governorAbi, functionName: 'frozen' },
      { address: g, abi: governorAbi, functionName: 'standby' },
      { address: g, abi: governorAbi, functionName: 'defendICR' },
    ],
    query: { enabled: !!governor, ...live },
  })
  const btc = useBalance({ address: who, query: { enabled, ...live } })

  const [tm, price, musd, smusd, nonce, mezo] = core.data ?? []
  const t = tm?.result as readonly bigint[] | undefined
  const totals = t ? troveTotals(t) : undefined
  const coll = totals?.coll
  const debt = totals?.debt
  const p = price?.result as bigint | undefined
  // Trove status + system health need the live price, so they run as a second batch once it is known.
  // A closed trove reports a max ICR (zero debt), so the status must be read explicitly (C7).
  const sys = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: MEZO.troveManager, abi: troveManagerExtraAbi, functionName: 'getTroveStatus', args: [who] },
      { address: MEZO.troveManager, abi: troveManagerExtraAbi, functionName: 'checkRecoveryMode', args: [p as bigint] },
      { address: MEZO.troveManager, abi: troveManagerExtraAbi, functionName: 'getTCR', args: [p as bigint] },
    ],
    query: { enabled: enabled && p !== undefined, ...live },
  })
  const [troveStatus, recoveryMode, tcr] = sys.data ?? []
  const statusNum = troveStatus?.result as number | undefined
  // L8: a zero-debt trove is still a trove — collateral with debt 0 and an
  // active status (or a status read still in flight) counts as hasTrove, with
  // icr() = 2**255 rendering as "No debt". A closed trove has coll 0, so the
  // coll > 0 requirement keeps "No trove" correct for never-opened wallets.
  const hasTrove = coll !== undefined && debt !== undefined && coll > 0n && (debt > 0n || statusNum === 1 || statusNum === undefined)
  const [floor, frozen, standby, defend] = gv.data ?? []
  return {
    address, isConnected, governor, hasTrove,
    coll, debt, price: p,
    icr: hasTrove && p ? icr(coll!, p, debt!) : undefined,
    troveStatus: statusNum,
    recoveryMode: recoveryMode?.result as boolean | undefined,
    tcr: tcr?.result as bigint | undefined,
    floor: floor?.result as bigint | undefined,
    defend: defend?.result as bigint | undefined,
    frozen: frozen?.result as boolean | undefined,
    standby: standby?.result as readonly [bigint, bigint, bigint, boolean] | undefined,
    nonce: nonce?.result as bigint | undefined,
    balances: { btc: btc.data?.value, musd: musd?.result as bigint | undefined, smusd: smusd?.result as bigint | undefined, mezo: mezo?.result as bigint | undefined },
    loading: core.isLoading || gov.isLoading,
    /** The core trove/Governor read failed (LOW-8): callers must show the RPC error, never a 'No trove'/'No Governor' empty. */
    error: core.isError || gov.isError,
    /** The core trove read alone failed (L5): the trove numbers (coll/debt/ICR) gate on this, never on the Governor read — a gov-only failure must not mask readable trove numbers as 'Unavailable'. */
    coreError: core.isError,
    /** The governorOf read alone failed (L2): Governor rows gate on this, never on the trove numbers. */
    govError: gov.isError,
    /** The Governor view batch (floor/frozen/standby/defend) failed (L3): floor/standby rows gate on this — an unknown batch must never render as 'Not configured' / 'DISARMED'. */
    gvError: gv.isError,
    /** Trove-status / system-health batch (getTroveStatus, checkRecoveryMode, getTCR). */
    sysLoading: sys.isLoading,
    sysError: sys.isError,
    refetch: () => { core.refetch(); gv.refetch(); gov.refetch(); btc.refetch(); sys.refetch() },
  }
}
export type Trove = ReturnType<typeof useTrove>
