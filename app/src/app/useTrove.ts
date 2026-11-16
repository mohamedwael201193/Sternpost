import { useAccount, useBalance, useReadContract, useReadContracts } from 'wagmi'
import { keepPreviousData } from '@tanstack/react-query'
import { zeroAddress, type Address } from 'viem'
import { MEZO, STERNPOST } from '../lib/chain'
import { erc20Abi, factoryAbi, governorAbi, priceFeedAbi, signaturesAbi, troveManagerAbi } from '../lib/abi'
import { icr, noTroveKnown, statusOutOfRange, troveTotals } from '../lib/icr'

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
  // Round 9 (J3 M1): the query key carries the live price (the args are
  // part of the key), so every price tick used to mint a NEW key with no
  // cached data — sys.isLoading true, troveStatusKnown false — and the Dial,
  // the TCR card and the Recovery banner all flashed on every price move.
  // keepPreviousData holds the last sys batch across a price-tick refetch,
  // so the gates below see retained (one-tick-stale) data, never a flash.
  const sys = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: MEZO.troveManager, abi: troveManagerExtraAbi, functionName: 'getTroveStatus', args: [who] },
      { address: MEZO.troveManager, abi: troveManagerExtraAbi, functionName: 'checkRecoveryMode', args: [p as bigint] },
      { address: MEZO.troveManager, abi: troveManagerExtraAbi, functionName: 'getTCR', args: [p as bigint] },
    ],
    query: { enabled: enabled && p !== undefined, placeholderData: keepPreviousData, ...live },
  })
  const [troveStatus, recoveryMode, tcr] = sys.data ?? []
  const statusNum = troveStatus?.result as number | undefined
  // Round 7 — hasTrove DEFINITION (fixes the round-5 carried item). The old
  // rule counted statusNum === undefined as active, so a zero-debt trove
  // whose getTroveStatus read was still pending or had failed claimed
  // "active" (and "No debt") on an unknown status. Only a KNOWN-active
  // status (1) counts now; the unknown case is exported separately
  // (troveStatusKnown) so render sites hold on a neutral state instead of
  // flashing "No trove" — Home/Draw/DrawHero gate their "No trove" claims
  // on it, and icr below no longer depends on hasTrove either.
  // The coll > 0 requirement does NOT exclude closed troves: a closed
  // trove CAN still report coll > 0 / debt 0 — after a full redemption the
  // debt is cleared but the remaining collateral stays in the contracts
  // until the borrower claims it (Mezo docs, "Mezo 101: Liquidations &
  // Redemptions", https://mezo.org/blog/mezo-101-liquidations-redemptions/,
  // §"Partial vs. Full Redemptions": "your debt is completely cleared, and
  // any remaining BTC collateral is set aside for you as surplus. You can
  // claim this surplus at any time."; Home's status-4 banner says the same:
  // "Claim your collateral"). The old comment ("a closed trove has coll 0")
  // was wrong as a general invariant — the status check is what excludes
  // closed troves, and the round-4 CLOSED_SNAP fixture (status 2, coll > 0,
  // debt 0) is a state the UI must render correctly, not an impossible one.
  // Round 8 (J3 M5 + J1 LOW-2): "known" means known-AND-understood. A
  // future status (e.g. 5 from a newer TroveManager) is a value this code
  // does not understand — it must NOT count as known, or every
  // troveStatusKnown-gated empty renders "No trove" for it while the ICR
  // card, Close/Open/ProveIt and demoIcrLabel all say "Unavailable" for
  // the same state. The round-7 useTrove test locked in the conflation
  // (troveStatusKnown: true for status 5) and is corrected with it.
  const troveStatusKnown = statusNum !== undefined && statusNum >= 0 && statusNum <= 4
  const hasTrove = coll !== undefined && debt !== undefined && coll > 0n && (debt > 0n || statusNum === 1)
  const [floor, frozen, standby, defend] = gv.data ?? []
  // Round 7 (LOW-6): with allowFailure: true the batch query never sets
  // isError — a reverted slot reports status 'failure' on its own entry
  // while the batch resolves. Every gvError/sysError gate is transport-only
  // without these: a failed frozen/standby slot would render "active" /
  // "DISARMED" and a failed checkRecoveryMode slot would render no Recovery
  // banner at all. Surface the per-slot failures so callers can OR them
  // into the same gates.
  const gvSlotError = (gv.data ?? []).some((e) => e?.status === 'failure')
  const sysSlotError = (sys.data ?? []).some((e) => e?.status === 'failure')
  // Round 8 (J3 L2): sysSlotError is over-broad — a getTCR-only slot failure
  // hid a KNOWN Recovery state behind the "system-health read failed"
  // banner. Split it per slot (sys batch order: getTroveStatus,
  // checkRecoveryMode, getTCR): the Recovery banner gates on
  // recoverySlotError, the TCR card on tcrSlotError. sysSlotError stays as
  // the any-slot OR for the top error plates.
  const recoverySlotError = sys.data?.[1]?.status === 'failure'
  const tcrSlotError = sys.data?.[2]?.status === 'failure'
  // Round 8 (J3 L7): the core batch has the same allowFailure hole, one
  // batch behind gv/sys — a single reverted core slot leaves coll/debt
  // undefined with core.isError false, so the Home rows and the
  // troveStatusKnown-gated empties would render "No trove" for an active
  // trove. Surface it like gvSlotError/sysSlotError.
  const coreSlotError = (core.data ?? []).some((e) => e?.status === 'failure')
  // Round 10 (J1 LOW-1): a core-slot failure is only position-blocking
  // when it took out a slot the position reads need — getEntireDebtAndColl
  // (coll / debt, slot 0) or fetchPrice (price, slot 1). A failed
  // balance/nonce slot leaves the position readable, so Draw must still
  // show the form (with its "Nonce unreadable" sign gate) instead of the
  // plate. coll / debt / price are defined exactly when those two slots
  // succeeded, so the value check below IS the slot check — and the
  // render-test mock derives the same value from the same fields, so the
  // two cannot drift apart.
  const positionSlotError = coreSlotError && (coll === undefined || debt === undefined || price === undefined)
  return {
    address, isConnected, governor, hasTrove, troveStatusKnown,
    coll, debt, price: p,
    // Round 9 (J2 HIGH-1 / J3 H2 — the headline defect): the ICR of a
    // coll-0 / debt>0 trove is genuinely 0 (icr(0, p, debt) = 0n), and the
    // round-8 render code already expects it — but the old `coll > 0n`
    // guard never called icr() for coll 0, so the connected path yielded
    // undefined and every "0%" render was fictional (the Dial fell through
    // to its default "No trove", Draw to a skeleton). Allow coll 0 whenever
    // debt > 0; coll-0/debt-0 stays undefined (a never-opened trove has no
    // ICR — useTrove.test.tsx:185 locks that in). The ICR still does not
    // depend on the status read: a zero-debt trove whose status is unknown
    // keeps ICR 2**255, and the render sites translate it via demoIcrLabel
    // (unknown status -> "Unavailable") instead of via an undefined ICR
    // ("No trove"). Gating icr on hasTrove would reintroduce the
    // false-inactive flash the definition change removes.
    icr: coll !== undefined && debt !== undefined && p && (coll > 0n || debt > 0n) ? icr(coll, p, debt) : undefined,
    troveStatus: statusNum,
    // Round 9 (J1 LOW-1 / J2 LOW-2 / J3 L5): noTroveKnown and
    // statusOutOfRange are computed once, here, from the shared helpers in
    // lib/icr.ts — Home, Draw and DrawHero read them off `t` instead of
    // each inlining the formula.
    noTroveKnown: noTroveKnown({ hasTrove, coreSlotError, troveStatusKnown, troveStatus: statusNum, coll, debt }),
    statusOutOfRange: statusOutOfRange(statusNum),
    recoveryMode: recoveryMode?.result as boolean | undefined,
    tcr: tcr?.result as bigint | undefined,
    floor: floor?.result as bigint | undefined,
    defend: defend?.result as bigint | undefined,
    frozen: frozen?.result as boolean | undefined,
    standby: standby?.result as readonly [bigint, bigint, bigint, boolean] | undefined,
    nonce: nonce?.result as bigint | undefined,
    balances: { btc: btc.data?.value, musd: musd?.result as bigint | undefined, smusd: smusd?.result as bigint | undefined, mezo: mezo?.result as bigint | undefined },
    /** Round 9 (J3 L4): the BTC balance comes from the independent useBalance read, not the core batch — a failed getNonce slot must not render BTC "unreadable" while it is merely pending, and a failed BTC read must not render perpetual "Loading…". The Wallet balances gate BTC on this, the other three on coreSlotError. */
    btcError: btc.isError,
    loading: core.isLoading || gov.isLoading,
    /** The governorOf read alone is still in flight (round 8, J3 M2): Governor rows gate on this — a debt>0 trove whose core read already returned must not flash "No Governor yet" while governorOf is pending. */
    govLoading: gov.isLoading,
    /** The Governor view batch (floor/frozen/standby/defend) is still in flight (round 8, J3 M1): floor/standby rows gate on this — an undefined batch must never render as "Not configured" / "DISARMED" / "active" while it loads. */
    gvLoading: gv.isLoading,
    /** The core trove/Governor read failed (LOW-8): callers must show the RPC error, never a 'No trove'/'No Governor' empty. */
    error: core.isError || gov.isError,
    /** The core trove read alone failed (L5): the trove numbers (coll/debt/ICR) gate on this, never on the Governor read — a gov-only failure must not mask readable trove numbers as 'Unavailable'. */
    coreError: core.isError,
    /** The governorOf read alone failed (L2): Governor rows gate on this, never on the trove numbers. */
    govError: gov.isError,
    /** The Governor view batch (floor/frozen/standby/defend) failed (L3): floor/standby rows gate on this — an unknown batch must never render as 'Not configured' / 'DISARMED'. */
    gvError: gv.isError,
    /** Round 7 (LOW-6): a single Governor-batch slot reverted (allowFailure) while the batch itself resolved — OR into every gvError gate (Home Floor/Standby/Spend route/Governor card, Watch standby/Shield, Revoke). */
    gvSlotError,
    /** Round 8 (J3 L7): a single core-batch slot reverted (allowFailure) while the batch itself resolved — OR into the Home rows, the Draw/Home empty gates, the nonce row and the Wallet balances. */
    coreSlotError,
    /** Round 10 (J1 LOW-1): only a core-slot failure that took out the position reads (getEntireDebtAndColl or fetchPrice) — a balance/nonce-only failure leaves the position readable, so Draw shows the form, not the plate. */
    positionSlotError,
    /** Trove-status / system-health batch (getTroveStatus, checkRecoveryMode, getTCR). */
    sysLoading: sys.isLoading,
    sysError: sys.isError,
    /** Round 7 (LOW-6): a single sys-batch slot reverted (allowFailure) while the batch resolved — OR into the Recovery-banner state (Home/Watch) alongside sysError. */
    sysSlotError,
    /** Round 8 (J3 L2): only the checkRecoveryMode slot reverted — the Recovery banner gates on this, never on the any-slot OR (a getTCR-only failure must not hide a KNOWN Recovery state). */
    recoverySlotError,
    /** Round 8 (J3 L2): only the getTCR slot reverted — the TCR card gates on this (a getTCR slot failure reads "Unavailable", never "No data"). */
    tcrSlotError,
    refetch: () => { core.refetch(); gv.refetch(); gov.refetch(); btc.refetch(); sys.refetch() },
  }
}
export type Trove = ReturnType<typeof useTrove>
