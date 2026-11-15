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
  const hasTrove = !!coll && !!debt && debt > 0n
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
  const [floor, frozen, standby, defend] = gv.data ?? []
  return {
    address, isConnected, governor, hasTrove,
    coll, debt, price: p,
    icr: hasTrove && p ? icr(coll!, p, debt!) : undefined,
    troveStatus: troveStatus?.result as number | undefined,
    recoveryMode: recoveryMode?.result as boolean | undefined,
    tcr: tcr?.result as bigint | undefined,
    floor: floor?.result as bigint | undefined,
    defend: defend?.result as bigint | undefined,
    frozen: frozen?.result as boolean | undefined,
    standby: standby?.result as readonly [bigint, bigint, bigint, boolean] | undefined,
    nonce: nonce?.result as bigint | undefined,
    balances: { btc: btc.data?.value, musd: musd?.result as bigint | undefined, smusd: smusd?.result as bigint | undefined, mezo: mezo?.result as bigint | undefined },
    loading: core.isLoading || gov.isLoading,
    refetch: () => { core.refetch(); gv.refetch(); gov.refetch(); btc.refetch(); sys.refetch() },
  }
}
export type Trove = ReturnType<typeof useTrove>
