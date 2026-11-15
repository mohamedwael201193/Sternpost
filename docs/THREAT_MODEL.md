# Threat model

Scope: the Classic governor (`SternpostGovernor`, `SpendWallet`, `SternpostRouter`)
and the Trove Accounts system (`contracts/src/account/`:
`TroveAccount`, `TroveAccountFactory`, `Batcher`, `Radar`).
Mainnet is fork-tested only (see `judges/TESTNET_TXS.md` for what ran where);
nothing in this file claims a mainnet deployment or an audit.

Rule IDs S1–S26 are the plan §7.2 rules. Every rule names a test that exists
in this repo (file + test name, verified by `scripts/check-threat-model.sh`),
or is marked explicitly as a code-review item, a non-goal, a disclosure, or an
OPEN gap. Plan-named tests that do not exist are called out, not silently
renamed: `test_owner_immutable`, `test_x402_session_bound`,
`test_bounty_farming_blocked` and `test_recovery_mode_semantics` do not exist
in this repo; the table cites the existing tests that cover the same behavior.

## Assets

- The borrower's trove: its BTC collateral and its debt headroom.
- MUSD drawn for apps and agents, held in SpendWallets (Classic) or drawn by
  TroveAccount sessions.
- The governor's reserve buffer, which may be parked in sMUSD.
- A TroveAccount's collateral surplus after a redemption (`claimCollateral`).

## Actors

| Actor | Trust |
|---|---|
| Borrower / account owner | Owns the trove and the governor/account. Signs Mezo EIP-712 messages (Classic) or owns the account (Accounts). |
| App | Untrusted. Holds a per-app policy: budget, per-draw cap, expiry, payee. |
| Agent | Untrusted session key for one SpendWallet / one TroveAccount session, with an expiry and a budget. |
| Keeper | Anyone. Can call Classic `heal()` / `defend()`; TroveAccount `shield()` does not exist on main yet (see S11). |
| Relayer / Batcher caller | Untrusted. `Batcher` holds no funds and no privileges (S20). |
| Mezo | Trusted protocol dependency (proxies that can upgrade — see non-goals). |
| x402 facilitator | Operator unverified; settlement is checked on chain, not trusted. |
| RPC / Blockscout / indexer | Untrusted for decisions; reads only. |

## Trust boundaries

T1 owner wallet · T2 agent key · T3 keeper/relayer · T4 Mezo contracts
(proxies, can upgrade) · T5 x402 facilitator (operator unverified) ·
T6 RPC providers · T7 Blockscout/indexer · T8 the Sternpost backend.

## How the Classic gate works

A withdraw signature names the governor as `recipient`. During a withdraw,
Mezo's ActivePool calls `sendCollateral(recipient, 0)`, which reaches the
governor's `receive()`. The governor only accepts that call inside its own
`draw()` (`inDraw`, sender is the ActivePool, value 0, first callback).
Anywhere else it reverts, and so the whole Mezo withdraw reverts too. Inside
`draw()` the governor then checks:

1. The app policy: authorized, not expired, per-draw cap, remaining budget,
   payee lock.
2. That the window is at most 120 s and that the heal signature at `nonce+1`
   is valid.
3. That exactly one callback was seen and exactly `amount` MUSD arrived.
4. The ICR after the draw is at or above `floorICR`, or the whole tx reverts.

## Classic threats and mitigations

Testnet txs below are from the Wave-1 hardened run on the superseded
deployment (governor `0x9eEa9762…`); the 0.9 redeploy changed the governor
code, so they are not proof of the current deployment — the fork tests run
against the 0.9 code. The only flow re-run on 0.9 is `defend()`
(tx `0x3e57c0b2b71099c01cbb4e47facd97eccece12f46bbe675bed0f4013f87600c2`,
block 16794538, status ok, repaid 30 MUSD, ICR 2.3791 → 2.4081;
see `judges/TESTNET_TXS.md` and `shared/deployments/testnet.json`).

| # | Threat | Mitigation | Evidence |
|---|---|---|---|
| 1 | An app submits the borrower's signature straight to Mezo | `receive()` reverts outside `draw()` | fork `test_fork_directBypassReverts`; testnet tx `0xfd93314c…` (Wave-1 run) |
| 2 | A draw pushes the trove below the floor | Post-draw ICR check | fork `test_fork_unsafeDrawRefused`; testnet tx `0xf3920683…` (Wave-1 run, reverted as expected) |
| 3 | An app overspends or pays another address | Per-app budget, per-draw cap, payee lock | unit + fuzz + invariant |
| 4 | A leaked signature is replayed later | 120 s window, and the shared nonce advances on every use | unit |
| 5 | The borrower wants every outstanding signature dead now | `revoke()` freezes and burns the nonce (1 wei AddColl) | fork `test_fork_revokeBurnsNonce`; tx `0xf0763cf4…`, then `0x1938e472…` reverts (Wave-1 run) |
| 6 | **Mezo removes the ActivePool callback** | `draw()` requires exactly one callback (`CallbackMismatch`), so draws fail closed. Without the callback the governor cannot block a direct submission, but the signature still pays MUSD to the governor, not to the app. | fork `test_fork_callbackRemoved_failsClosed_healRecovers` |
| 7 | Reentrancy through MUSD, sMUSD or the callback | `nonReentrant`, a one-shot callback flag, CEI | `contracts/test/unit/Reentrancy.t.sol` `test_reentrantDraw_blocked`; Slither triage in `judges/SLITHER_TRIAGE.md` |
| 8 | The price drops sharply after a draw | A permissionless `defend()` repays the armed standby from the buffer below `defendICR`, then freezes | fork `test_fork_defend`; 0.9 tx `0x3e57c0b2…` |
| 9 | A stale standby: any other signed action uses the shared nonce | `standby().live` exposes it, the SDK explains it, and `rearm()` restores it | fork `test_fork_nonceRace`; tx `0xeb436557…` (Wave-1 run) |
| 10 | A compromised agent key | SpendWallet expiry, the Permit2 budget, `revokeAgent()`, and owner `sweep()` | `contracts/test/unit/SpendWallet.t.sol` |

## Trove Accounts — rules S1–S26

Production policy (plan §3.3): `floorICR = 2.50e18`,
`shieldICR = 1.60e18`, `targetICR = 2.00e18`, `bounty = 1e18` (1 MUSD),
`minDebtAhead = 10_000e18` on mainnet and 0 on testnet,
`cooldownBlocks = 20`. Validation: `1.15e18 <= shieldICR < targetICR <= 10e18`,
`shieldICR < floorICR`, `bounty <= 5e18` (`MAX_BOUNTY = 5e18`,
`contracts/src/account/TroveAccount.sol:67`).

Invariants I1–I13 are plan §3.12. The Foundry invariant suites in this repo
declare 4 invariant functions (`contracts/test/invariant/Invariant.t.sol`:
`invariant_bypassNeverLands`, `invariant_budgetNeverExceeded`,
`invariant_governorHoldsOnlyBuffer`;
`contracts/test/invariant/RouterInvariant.t.sol`:
`invariant_routerHoldsNothing`). I1–I13 are otherwise covered by the named
`test_I*_` unit tests below — there is no `invariant_I1` … `invariant_I13`
function, and this table does not claim one.

| Rule | Rule text | Settled by (test that exists) |
|---|---|---|
| S1 | Account owner is set once; no function changes it | `contracts/test/account/TroveAccount.t.sol` `test_I4_ownerNeverChanges`, `test_I4_initializeOnceOnRealClone`; `contracts/test/account/Factory.t.sol` `test_reinitializeOnCloneReverts`. (Plan-named `test_owner_immutable` does not exist; these are the existing equivalents.) |
| S2 | No admin, no pause, no upgrade; Factory fee params immutable, `feeBps <= 50`, `feeRecipient != 0` and not a burn address | `contracts/test/account/Factory.t.sol` `test_constructorRevertsWhenFeeBpsAboveCap`, `test_constructorAcceptsFeeBpsAtCap`, `test_constructorRevertsOnZeroFeeRecipient`, `test_constructorRevertsOnBurnFeeRecipient`, `test_constructorRevertsOnImplementationFeeBpsMismatch`, `test_constructorRevertsOnImplementationFeeRecipientMismatch`, `test_constructorStoresImmutables`; `contracts/test/account/TroveAccountDraw.t.sol` `test_I10_feeRecipientImmutable`; `contracts/test/account/TroveAccount.t.sol` `test_F2_implementationRejectsFeeAboveCap`. No pause/upgrade function exists in `contracts/src` (grep: no `pause`, `upgradeTo`, `UUPSUpgradeable`). |
| S3 | Agent draw cannot take ICR below `floorICR` | `contracts/test/account/TroveAccountDraw.t.sol` `test_I1_successfulDrawLeavesIcrAtOrAboveFloor`, `test_I1_successfulDrawBySigLeavesIcrAtOrAboveFloor`, `test_I1_drawBySigBreachingFloorRevertsBelowFloor`; `contracts/test/unit/Fuzz.t.sol` `testFuzz_drawRespectsFloor` (Classic). |
| S4 | Agent spend bounded by budget, per-tx cap, daily limit, expiry | `contracts/test/account/TroveAccount.t.sol` `test_I2_drawWithinCapsSucceeds`, `test_I2_drawOverBudgetReverts`, `test_I2_drawOverPerTxReverts`, `test_I2_drawOverDailyReverts`, `test_I2_dailyWindowRollsAfter24h`, `test_I2_payeeAllowlistEnforced`, `test_I2_feeIsCeilOneWei`; `contracts/test/account/TroveAccountDraw.t.sol` `test_M6_exactBoundarySessionCaps`; `contracts/test/unit/Governor.t.sol` `test_budgets_perDraw_expiry_payee` (Classic). |
| S5 | Revoked/expired/wrong-epoch session is dead for draws and x402 signing | `contracts/test/account/TroveAccount.t.sol` `test_I3_revokedSessionCannotDraw`, `test_I3_expiredSessionCannotDraw`, `test_I3_wrongEpochSessionCannotDraw`, `test_I3_revokeAllKillsAllSessions`, `test_I3_reissuedSessionDropsOldPayees`, `test_I3_liveSessionCanSignX402`, `test_I3_sessionWithoutCanSignX402CannotSign`, `test_I3_revokedSessionCannotSignX402`. |
| S6 | Payee allowlist applies to `draw`; **it does not apply to a signed Permit2 transfer** (disclosed): x402-enabled sessions are bounded by budget + Permit2 allowance | `contracts/test/account/TroveAccount.t.sol` `test_I3_liveSessionCanSignX402`, `test_I3_sessionWithoutCanSignX402CannotSign`, `test_I3_revokedSessionCannotSignX402`, `test_approveTokenSetsPermit2Allowance`; `contracts/test/account/TroveAccountDraw.t.sol` `test_EIP1271_validSignatureForLiveX402Session`. (Plan-named `test_x402_session_bound` does not exist; the bound is covered by the tests above, and the Permit2 carve-out is the disclosure in this row.) |
| S7 | `canSignX402` defaults to false | Behavioural: `contracts/test/account/TroveAccount.t.sol` `test_I3_sessionWithoutCanSignX402CannotSign` (a session created without the flag returns invalid for x402). `setSession` takes the flag explicitly (`contracts/src/account/TroveAccount.sol:352-378`); the Solidity `bool` default is `false`. No dedicated defaults-only unit test exists. |
| S8 | `drawBySig` nonce is per agent, increments once per accepted intent, signatures cannot replay across accounts or chains (domain includes chainId and account) | `contracts/test/account/TroveAccountDraw.t.sol` `test_S8_domainSeparatorBindsChainAndAccount`, `test_S8_signatureCannotReplayAcrossAccounts`, `test_S8_signatureCannotReplayAcrossChains`, `test_I11_nonceIncrementsExactlyOncePerAcceptedIntent`, `test_I11_failedDrawBySigDoesNotConsumeNonce`, `test_I11_twoAgentsIntentsNeverInterfere`, `test_I11_sameNonceDifferentPayloadOrder`; `contracts/test/account/TroveAccount.t.sol` `test_drawBySigReplayReverts`; `contracts/test/account/Factory.t.sol` `testFuzz_predictMatchesCreated`, `test_policyFrontRunCannotStealAddress`. |
| S9 | Signature malleability (high-s, bad v, zero address recovery) rejected | `contracts/test/account/TroveAccountDraw.t.sol` `test_S9_highSRejected`, `test_S9_badVRejected`, `test_S9_zeroAddressRecoveryRejected`; `contracts/test/unit/SpendWallet.t.sol` `test_highS_malleatedSignature_rejected`; `contracts/test/unit/GovernorBranches.t.sol` `test_rearm_highS_malleatedSig_rejected`. |
| S10 | Owner can always exit (close, withdraw, sweeps) except where Mezo itself forbids (Recovery Mode, insufficient MUSD) | `contracts/test/account/TroveAccount.t.sol` `test_I5_closeAccountReturnsEverything`, `test_I5_closeAccountNeedsMusd`, `test_I5_closeAccountInRecoveryModeReverts`, `test_I5_closeAccountAfterRedemptionClaimsCollateral`, `test_I5_claimCollateralZeroSurplusSucceeds`, `test_I5_sweepsWorkWithoutSessions`, `test_I5_closeAccountRevokesSessions`, `test_I5_withdrawCollAndRepay`. |
| S11 | `shield()` never pushes net debt below `minNetDebt` + gas compensation | PARTIAL — GAP. `shield()` does not exist in `contracts/src/account/TroveAccount.sol` on main, and no account `shield()` execution test exists. Closest existing tests: `contracts/test/account/TroveAccount.t.sol` `test_repayBoundedByMinDebt` (the min-net-debt bound on repay) and Classic `contracts/test/unit/Governor.t.sol` `test_defend_clampsAfterPartialRedemption`, `contracts/test/fork/Fork.t.sol` `test_fork_defend`. Task 1.4 (Shield) must add `shield()` and re-prove I8/I9 with it included (see `contracts/test/account/TroveAccountDraw.t.sol:21-25`). |
| S12 | Keeper bounty is capped, paid only for real stress and real improvement, rate-limited by cooldown | PARTIAL — GAP. The cap is tested: `contracts/test/account/Factory.t.sol` `test_createAccountRejectsBountyAboveCap`, `contracts/test/account/TroveAccount.t.sol` `test_setPolicyRejectsBountyAboveCap`; Classic `contracts/test/unit/Governor.t.sol` `test_minDefendLine_is135`. But plan-named `test_bounty_farming_blocked` does not exist, and with no `shield()` on main there is no test that a bounty is paid only for real stress/improvement or that the cooldown binds. |
| S13 | A non-active trove (redeemed/liquidated/closed) freezes draws and shield; collateral surplus is claimable by anyone for the account and sweepable only by the owner | `contracts/test/account/TroveAccountDraw.t.sol` `test_I8_drawRevertsWhenTroveNotActive`, `test_I8_drawBySigRevertsWhenTroveNotActive`, `test_I8_claimCloseSweepsStillWorkWhenNotActive`; `contracts/test/account/TroveAccount.t.sol` `test_I5_closeAccountAfterRedemptionClaimsCollateral`; `contracts/test/unit/Governor.t.sol` `test_draw_revertsWhenTroveRedeemed`; `contracts/test/account/Batcher.t.sol` `testFork_claimCollateralAfterSimulatedRedemption` (fork). |
| S14 | Recovery Mode blocks draws with a named reason before Mezo is called; repay/addColl/shield continue | PARTIAL. Draw/repay/addColl on mocked Mezo: `contracts/test/account/TroveAccountDraw.t.sol` `test_I9_drawRevertsRecoveryModeBeforeMezo`, `test_I9_drawBySigRevertsRecoveryMode`, `test_I9_repayAndAddCollSucceedInRecoveryMode`, `test_S17_priceZeroImpliesRecoveryMode`; `contracts/test/unit/Governor.t.sol` `test_draw_revertsInRecoveryMode` (Classic). Plan-named fork test `test_recovery_mode_semantics` does not exist, and "shield continues in RM" is unproven (no `shield()`, see S11). |
| S15 | Reentrancy: all state-changing externals guarded | PARTIAL. Classic + Router: `contracts/test/unit/Reentrancy.t.sol` `test_reentrantDraw_blocked` (malicious ActivePool re-entering Governor `draw`/`heal`), `contracts/test/unit/Router.t.sol` `test_reentrancyBlocked`; `contracts/test/unit/GovernorBranches.t.sol` `test_draw_payeeTransferFalse_revertsAtomically`. Account `draw`/`drawBySig` are `nonReentrant` in code and `contracts/test/account/Batcher.t.sol` `test_multiDrawAtomicityOnBadSig` covers batch atomicity, but no account-suite test re-enters `draw` with a malicious payee/receiver. |
| S16 | Native BTC only enters via `receive()`/`addColl`; accounting reconciles | `contracts/test/unit/Governor.t.sol` `test_receive_rejectsWrongCallerOrValue`, `test_directNativeSubmission_isBlocked`; `contracts/test/unit/Router.t.sol` `test_unexpectedBtcRejected`; `contracts/test/account/Batcher.t.sol` `test_batcherRejectsPlainEthTransfer`, `test_batcherRejectsValueOnMulti`, `test_batcherRejectsValueOnClaimBatch`, `test_combinedSweepLeavesBatcherEmpty`; `contracts/test/invariant/Invariant.t.sol` `invariant_governorHoldsOnlyBuffer`, `contracts/test/invariant/RouterInvariant.t.sol` `invariant_routerHoldsNothing`. Note: no `invariant_I12`/`invariant_I13` function exists; reconciliation is covered by the Batcher sweep/balance tests above, not by a ghost-sum invariant. |
| S17 | Price is read from Mezo's PriceFeed only; a zero/failed price reverts the action (no fallback oracle) | `contracts/test/account/TroveAccountDraw.t.sol` `test_S17_priceFeedRevertPropagates`, `test_S17_priceZeroImpliesRecoveryMode`. |
| S18 | Stale/oracle risk: no action uses a cached price | CODE REVIEW (no test by design). Verified by reading: `contracts/src/account/TroveAccount.sol` calls `pf.fetchPrice()` fresh at each use site (lines 314, 479, 559, 598, 679, 699, 732) and holds no price storage variable (only constants and `_lock`). Exception, disclosed: `SternpostRouter` v2 reads the price once per loop transaction (the price cannot change inside one tx). |
| S19 | Factory clone address is deterministic and cannot be front-run into a different owner (salt includes owner) | `contracts/test/account/Factory.t.sol` `test_predictMatchesCreated`, `testFuzz_predictMatchesCreated`, `test_sameSaltDifferentOwnerGivesDifferentAccount`, `test_sameOwnerDifferentSaltGivesDifferentAccount`, `test_policyFrontRunCannotStealAddress`, `test_predictBindsPolicy`; `contracts/test/unit/Factory.t.sol` `test_predictGovernor_matchesDeployedAddress_forNewBorrower`; `contracts/test/unit/Governor.t.sol` `test_factory_predicts_andRejectsDuplicate`. |
| S20 | Relayer/Batcher hold no funds and have no privileges; a bad relayer can only delay | `contracts/test/account/Batcher.t.sol` `test_combinedSweepLeavesBatcherEmpty`, `test_batcherRejectsPlainEthTransfer`, `test_claimYieldBatchStaysInAccount`; `contracts/test/invariant/RouterInvariant.t.sol` `invariant_routerHoldsNothing`. |
| S21 | Hot session key theft is bounded by budget and expiry (default 7 days, max 90); revoke is one tx | `contracts/test/account/TroveAccount.t.sol` `test_I2_drawWithinCapsSucceeds`, `test_I2_drawOverBudgetReverts`, `test_I2_drawOverDailyReverts`, `test_I3_revokeAllKillsAllSessions`; `MAX_SESSION = 90 days` (`contracts/src/account/TroveAccount.sol:70`). |
| S22 | Redemption can close the trove: disclosed; Radar + rank trigger reduce the chance but cannot prevent it | NON-GOAL (no test by design). Evidence: `contracts/test/account/Radar.t.sol` `test_rank_frontier`, `test_rank_head`, `test_rank_middle_redeemable`, `test_frontier`, `test_debtAheadForNICR_belowFrontier`, `testForkMainnet_fourTroves`, `testForkTestnet_labRanks`; live incident in `docs/proof/accounts-2026-11-15.md` (ask 2). |
| S23 | Contracts are unaudited; mainnet use is a capped pilot | DISCLOSURE (no test by design). This file, `docs/proof/mainnet-2026-11-15.md` (pilot: not started), and the README security section. |
| S24 | Backend gateway/relayer keys are testnet-only until the user enables mainnet | OPS RULE, partially tested. `backend/src/config.ts:7` defaults `CHAIN_ID` to 31611 (testnet); `backend/test/config.test.ts` `loads when X402_PAY_TO is a valid address and keeps other defaults` asserts the 31611 default. But no mainnet-enable gate exists in the repo: the string `STERNPOST_MAINNET_OK` appears nowhere, so "until the user enables mainnet" currently has no implemented switch — enabling mainnet in the backend is an unbuilt step, not a flip. |
| S25 | Indexer/leaderboard decides quests from logs only; team addresses are tagged and excluded from the outside count | PARTIAL — GAP. Indexer tests exist: `backend/test/indexer.test.ts` `indexes factory, follows new governor, mirrors policy, is idempotent` and `start() polls and stop clears the timer; errors are swallowed`. But no team-address tagging or exclusion exists anywhere in `backend/src/indexer` or `backend/src/routes` (grep for "team": zero hits), so the exclusion half of this rule is untested and unimplemented. Outside count is 0 today, so nothing is misreported yet. |
| S26 | MCP never returns or logs the agent key; refuses mainnet without `STERNPOST_MAINNET_OK=1` | OPEN — NOT IMPLEMENTED. There is no MCP package in this repo (`TESTS.json`: mcp suite "missing"), no MCP snapshot test, and `STERNPOST_MAINNET_OK` appears nowhere. This rule cannot be claimed until the MCP server exists. |

Coverage summary (verified 2026-11-15 by `scripts/check-threat-model.sh`):

- 17 rules fully backed by an existing named test: S1, S2, S3, S4, S5, S6, S7,
  S8, S9, S10, S13, S16, S17, S19, S20, S21, S24.
- 5 rules partial (mechanism tested, execution/coverage gap named in the row):
  S11, S12, S14, S15, S25.
- 3 rules with no test by design: S18 (code review), S22 (non-goal), S23
  (disclosure).
- 1 rule open / not implemented: S26 (no MCP package).

## Known limits (honest)

- **Dependency on the callback (Classic).** The gate depends on how Mezo's
  ActivePool behaves today, not on an interface Mezo guarantees. Classic
  threat 6 shows that removing the callback fails closed for draws. A Mezo
  upgrade could still change the semantics, so the governor should be
  redeployed after any Mezo BorrowerOperations or ActivePool upgrade.
- **Shared nonce (Classic).** Mezo has one nonce per borrower. Concurrent
  apps will invalidate each other's signatures. The SDK `NonceCoordinator`
  serialises signing within one process; it cannot do that across processes.
  Trove Accounts remove this bottleneck (the account is the borrower; the
  Mezo nonce is never used) — proven by the lab open tx
  `0x0a3f4c0de6132f9abb030a8a1a07238ce6e5169cf699e796d9e028906db50545`,
  block 16790703, status ok.
- **Defend needs a live standby and a funded buffer.** It is a best-effort
  guard, not liquidation protection. The 0.9 defend was triggered by raising
  the policy line, not by a price move (disclosed in
  `judges/TESTNET_TXS.md`).
- **Shield does not exist on main yet.** `shield()` is task 1.4; S11/S12/S14
  (shield clauses) are partial until it lands and is re-proven.
- **The oracle.** All ICR math uses Mezo's PriceFeed. A manipulated oracle is
  out of scope (S18: no cached price is used, but a wrong live price is still
  trusted).
- **Redemption is not preventable.** Radar and the rank trigger only reduce
  the chance (S22). A minimum-size trove was redeemed on testnet within
  minutes of creation.
- **Not audited, testnet only.** Mainnet support is limited to fork tests
  (mainnet 31612 read-only). The mainnet pilot has not started
  (`docs/proof/mainnet-2026-11-15.md`).

## Non-goals

Protect against a Mezo contract upgrade or oracle failure, MEV,
Recovery-Mode borrowing, redemption prevention, unsecured credit for agents
with no collateral.
