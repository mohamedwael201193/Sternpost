import { useAccount, useBalance, useReadContract, useReadContracts } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { MEZO, STERNPOST } from '../lib/chain'
import { erc20Abi, factoryAbi, governorAbi, priceFeedAbi, signaturesAbi, troveManagerAbi } from '../lib/abi'
import { icr } from '../lib/icr'

const live = { refetchInterval: 15_000 }

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
  const coll = t ? t[0] + t[3] : undefined
  const debt = t ? t[1] + t[2] + t[4] + t[5] : undefined
  const p = price?.result as bigint | undefined
  const hasTrove = !!coll && !!debt && debt > 0n
  const [floor, frozen, standby, defend] = gv.data ?? []
  return {
    address, isConnected, governor, hasTrove,
    coll, debt, price: p,
    icr: hasTrove && p ? icr(coll!, p, debt!) : undefined,
    floor: floor?.result as bigint | undefined,
    defend: defend?.result as bigint | undefined,
    frozen: frozen?.result as boolean | undefined,
    standby: standby?.result as readonly [bigint, bigint, bigint, boolean] | undefined,
    nonce: nonce?.result as bigint | undefined,
    balances: { btc: btc.data?.value, musd: musd?.result as bigint | undefined, smusd: smusd?.result as bigint | undefined, mezo: mezo?.result as bigint | undefined },
    loading: core.isLoading || gov.isLoading,
    refetch: () => { core.refetch(); gv.refetch(); gov.refetch(); btc.refetch() },
  }
}
export type Trove = ReturnType<typeof useTrove>
