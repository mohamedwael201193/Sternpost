import { useReadContracts } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { borrowerOpsAbi, governorAbi } from '../lib/abi'
import { MEZO } from '../lib/chain'
import { WAD, maxSafeDraw, safeDraw } from '../lib/icr'
import type { Trove } from './useTrove'

/** What bounds a draw by `app`: its per-draw cap and budget on the Governor, and the trove's room above the floor. */
export function useLimits(t: Trove, app?: Address) {
  const g = t.governor ?? zeroAddress, a = app ?? zeroAddress
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: g, abi: governorAbi, functionName: 'appPolicy', args: [a] },
      { address: g, abi: governorAbi, functionName: 'remainingBudget', args: [a] },
      { address: MEZO.borrowerOperations, abi: borrowerOpsAbi, functionName: 'getBorrowingFee', args: [WAD] },
    ],
    query: { enabled: !!t.governor && !!app, refetchInterval: 15_000 },
  })
  const [pol, rem, fee] = q.data ?? []
  const p = pol?.result as readonly [bigint, bigint, bigint, bigint, Address] | undefined
  const authorized = !!p && p[3] > 0n
  const floorRoom = t.hasTrove && t.price && t.floor ? maxSafeDraw(t.coll!, t.price, t.debt!, t.floor) : undefined
  // LOW-1 (round 6): with allowFailure: true the batch query never sets
  // q.isError — a failed getBorrowingFee slot reports status 'failure' on
  // its own entry while the batch resolves. Reading feePerWad as 0n on that
  // failure silently prices the max safe draw with NO fee, overstating it.
  // A failed fee read fails the safe draw (no suggest, no max) until the
  // read succeeds; callers that display the rate must gate on feeError too.
  const feeError = fee?.status === 'failure'
  const feePerWad = (fee?.result as bigint | undefined) ?? 0n
  const perDraw = authorized ? p![2] : undefined
  const remaining = authorized ? (rem?.result as bigint | undefined) : undefined
  // Wait for the policy read: a floor-only max shown first would suggest an amount the cap or budget then refuses.
  const safe = floorRoom !== undefined && q.data && !feeError ? safeDraw({ floorRoom, feePerWad, perDraw, remaining }) : undefined
  return { loaded: !!q.data, authorized, perDraw, remaining, floorRoom, feePerWad, feeError, safe }
}
