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
  // Round 7 (J2 F2): the same allowFailure hole the fee slot had applies to
  // the other two slots. If the appPolicy slot fails, q.data is still
  // truthy and p is undefined, so authorized is false — but safeDraw would
  // still compute a floor-only max, and the "Max safe" chip + prefill would
  // suggest an amount the per-draw cap or budget would refuse. A failed
  // appPolicy OR remainingBudget slot fails the safe draw, exactly like a
  // failed fee slot. loaded is likewise false while any slot has failed:
  // q.data is truthy when all three slots failed.
  const polError = pol?.status === 'failure' || rem?.status === 'failure'
  // Wait for the policy read: a floor-only max shown first would suggest an amount the cap or budget then refuses.
  // Round 9 (J3 M3): the batch refetches every 15 s and TanStack RETAINS
  // q.data on a failed refetch — without the !q.isError gate, `safe` kept
  // computing from stale policy/fee data and the "Max safe" chip + prefill
  // kept rendering as live after the read died. A failed batch fails the
  // safe draw (the on-chain previewDraw gate still rules); `isError` is
  // returned so Limits can say so explicitly.
  const safe = floorRoom !== undefined && q.data && !q.isError && !feeError && !polError ? safeDraw({ floorRoom, feePerWad, perDraw, remaining }) : undefined
  // Round 8 (J3 L4): `loaded` was dead and misleading — no consumer reads
  // it, and it was true while `safe` was undefined whenever `floorRoom`
  // was missing. Gate it on floorRoom: loaded now means the limits read
  // finished AND there is room to bound (a missing floor means no safe
  // draw can be computed at all). Round 9 (J3 M3): a failed batch is not
  // loaded, even with retained data.
  return { loaded: floorRoom !== undefined && !!q.data && !q.isError && !feeError && !polError, isError: q.isError, authorized, perDraw, remaining, floorRoom, feePerWad, feeError, polError, safe }
}
