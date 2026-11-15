#!/usr/bin/env bash
# check-threat-model.sh — verify every test cited in docs/THREAT_MODEL.md
# (rules S1–S26) exists in the repo by file + test name.
# Scope is NAME EXISTENCE only: this script never runs a test and never
# checks that a test proves what its row claims. Pass status at this tree
# is unproven (TESTS.json is stale — see docs/THREAT_MODEL.md).
# Usage: bash scripts/check-threat-model.sh   (exit 0 = all cited tests found)
#   or: bash scripts/check-threat-model.sh --list   (print the pairs and exit 0)
#
# The threat model marks S18 (code review), S22 (non-goal) and S23
# (disclosure) as having no test by design, and S6/S7/S11/S12/S14/S15/S24/S25
# as partial (mechanism tests cited, execution gap named in the doc).
# This script checks the tests the doc DOES cite; it does not bless the gaps.
set -u
cd "$(dirname "$0")/.." || exit 1

# pairs: file|test-function-name (one per line; S26 intentionally absent:
# no MCP package exists, so there is nothing to check — see THREAT_MODEL.md)
read -r -d '' PAIRS <<'EOF'
contracts/test/account/TroveAccount.t.sol|test_I4_ownerNeverChanges
contracts/test/account/TroveAccount.t.sol|test_I4_initializeOnceOnRealClone
contracts/test/account/Factory.t.sol|test_reinitializeOnCloneReverts
contracts/test/account/Factory.t.sol|test_constructorRevertsWhenFeeBpsAboveCap
contracts/test/account/Factory.t.sol|test_constructorAcceptsFeeBpsAtCap
contracts/test/account/Factory.t.sol|test_constructorRevertsOnZeroFeeRecipient
contracts/test/account/Factory.t.sol|test_constructorRevertsOnBurnFeeRecipient
contracts/test/account/Factory.t.sol|test_constructorRevertsOnImplementationFeeBpsMismatch
contracts/test/account/Factory.t.sol|test_constructorRevertsOnImplementationFeeRecipientMismatch
contracts/test/account/Factory.t.sol|test_constructorStoresImmutables
contracts/test/account/TroveAccountDraw.t.sol|test_I10_feeRecipientImmutable
contracts/test/account/TroveAccount.t.sol|test_F2_implementationRejectsFeeAboveCap
contracts/test/account/TroveAccountDraw.t.sol|test_I1_successfulDrawLeavesIcrAtOrAboveFloor
contracts/test/account/TroveAccountDraw.t.sol|test_I1_successfulDrawBySigLeavesIcrAtOrAboveFloor
contracts/test/account/TroveAccountDraw.t.sol|test_I1_drawBySigBreachingFloorRevertsBelowFloor
contracts/test/unit/Fuzz.t.sol|testFuzz_drawRespectsFloor
contracts/test/account/TroveAccount.t.sol|test_I2_drawWithinCapsSucceeds
contracts/test/account/TroveAccount.t.sol|test_I2_drawOverBudgetReverts
contracts/test/account/TroveAccount.t.sol|test_I2_drawOverPerTxReverts
contracts/test/account/TroveAccount.t.sol|test_I2_drawOverDailyReverts
contracts/test/account/TroveAccount.t.sol|test_I2_dailyWindowRollsAfter24h
contracts/test/account/TroveAccount.t.sol|test_I2_payeeAllowlistEnforced
contracts/test/account/TroveAccount.t.sol|test_I2_feeIsCeilOneWei
contracts/test/account/TroveAccountDraw.t.sol|test_M6_exactBoundarySessionCaps
contracts/test/unit/Governor.t.sol|test_budgets_perDraw_expiry_payee
contracts/test/account/TroveAccount.t.sol|test_I3_revokedSessionCannotDraw
contracts/test/account/TroveAccount.t.sol|test_I3_expiredSessionCannotDraw
contracts/test/account/TroveAccount.t.sol|test_I3_wrongEpochSessionCannotDraw
contracts/test/account/TroveAccount.t.sol|test_I3_revokeAllKillsAllSessions
contracts/test/account/TroveAccount.t.sol|test_I3_reissuedSessionDropsOldPayees
contracts/test/account/TroveAccount.t.sol|test_I3_liveSessionCanSignX402
contracts/test/account/TroveAccount.t.sol|test_I3_sessionWithoutCanSignX402CannotSign
contracts/test/account/TroveAccount.t.sol|test_I3_revokedSessionCannotSignX402
contracts/test/account/TroveAccount.t.sol|test_approveTokenSetsPermit2Allowance
contracts/test/account/TroveAccountDraw.t.sol|test_EIP1271_validSignatureForLiveX402Session
contracts/test/account/TroveAccountDraw.t.sol|test_S8_domainSeparatorBindsChainAndAccount
contracts/test/account/TroveAccountDraw.t.sol|test_S8_signatureCannotReplayAcrossAccounts
contracts/test/account/TroveAccountDraw.t.sol|test_S8_signatureCannotReplayAcrossChains
contracts/test/account/TroveAccountDraw.t.sol|test_I11_nonceIncrementsExactlyOncePerAcceptedIntent
contracts/test/account/TroveAccountDraw.t.sol|test_I11_failedDrawBySigDoesNotConsumeNonce
contracts/test/account/TroveAccountDraw.t.sol|test_I11_twoAgentsIntentsNeverInterfere
contracts/test/account/TroveAccountDraw.t.sol|test_I11_sameNonceDifferentPayloadOrder
contracts/test/account/TroveAccount.t.sol|test_drawBySigReplayReverts
contracts/test/account/Factory.t.sol|testFuzz_predictMatchesCreated
contracts/test/account/Factory.t.sol|test_policyFrontRunCannotStealAddress
contracts/test/account/TroveAccountDraw.t.sol|test_S9_highSRejected
contracts/test/account/TroveAccountDraw.t.sol|test_S9_badVRejected
contracts/test/account/TroveAccountDraw.t.sol|test_S9_zeroAddressRecoveryRejected
contracts/test/unit/SpendWallet.t.sol|test_highS_malleatedSignature_rejected
contracts/test/unit/GovernorBranches.t.sol|test_rearm_highS_malleatedSig_rejected
contracts/test/account/TroveAccount.t.sol|test_I5_closeAccountReturnsEverything
contracts/test/account/TroveAccount.t.sol|test_I5_closeAccountNeedsMusd
contracts/test/account/TroveAccount.t.sol|test_I5_closeAccountInRecoveryModeReverts
contracts/test/account/TroveAccount.t.sol|test_I5_closeAccountAfterRedemptionClaimsCollateral
contracts/test/account/TroveAccount.t.sol|test_I5_claimCollateralZeroSurplusSucceeds
contracts/test/account/TroveAccount.t.sol|test_I5_sweepsWorkWithoutSessions
contracts/test/account/TroveAccount.t.sol|test_I5_closeAccountRevokesSessions
contracts/test/account/TroveAccount.t.sol|test_I5_withdrawCollAndRepay
contracts/test/account/TroveAccount.t.sol|test_repayBoundedByMinDebt
contracts/test/unit/Governor.t.sol|test_defend_clampsAfterPartialRedemption
contracts/test/fork/Fork.t.sol|test_fork_directBypassReverts
contracts/test/fork/Fork.t.sol|test_fork_unsafeDrawRefused
contracts/test/fork/Fork.t.sol|test_fork_revokeBurnsNonce
contracts/test/fork/Fork.t.sol|test_fork_nonceRace
contracts/test/fork/Fork.t.sol|test_fork_callbackRemoved_failsClosed_healRecovers
contracts/test/fork/Fork.t.sol|test_fork_defend
contracts/test/account/Factory.t.sol|test_createAccountRejectsBountyAboveCap
contracts/test/account/TroveAccount.t.sol|test_setPolicyRejectsBountyAboveCap
contracts/test/unit/Governor.t.sol|test_minDefendLine_is135
contracts/test/account/TroveAccountDraw.t.sol|test_I8_drawRevertsWhenTroveNotActive
contracts/test/account/TroveAccountDraw.t.sol|test_I8_drawBySigRevertsWhenTroveNotActive
contracts/test/account/TroveAccountDraw.t.sol|test_I8_claimCloseSweepsStillWorkWhenNotActive
contracts/test/unit/Governor.t.sol|test_draw_revertsWhenTroveRedeemed
contracts/test/account/Batcher.t.sol|testFork_claimCollateralAfterSimulatedRedemption
contracts/test/account/TroveAccountDraw.t.sol|test_I9_drawRevertsRecoveryModeBeforeMezo
contracts/test/account/TroveAccountDraw.t.sol|test_I9_drawBySigRevertsRecoveryMode
contracts/test/account/TroveAccountDraw.t.sol|test_I9_repayAndAddCollSucceedInRecoveryMode
contracts/test/account/TroveAccountDraw.t.sol|test_S17_priceZeroImpliesRecoveryMode
contracts/test/unit/Governor.t.sol|test_draw_revertsInRecoveryMode
contracts/test/unit/Reentrancy.t.sol|test_reentrantDraw_blocked
contracts/test/unit/Router.t.sol|test_reentrancyBlocked
contracts/test/unit/GovernorBranches.t.sol|test_draw_payeeTransferFalse_revertsAtomically
contracts/test/account/Batcher.t.sol|test_multiDrawAtomicityOnBadSig
contracts/test/unit/Governor.t.sol|test_receive_rejectsWrongCallerOrValue
contracts/test/unit/Governor.t.sol|test_directNativeSubmission_isBlocked
contracts/test/unit/Router.t.sol|test_unexpectedBtcRejected
contracts/test/account/Batcher.t.sol|test_batcherRejectsPlainEthTransfer
contracts/test/account/Batcher.t.sol|test_batcherRejectsValueOnMulti
contracts/test/account/Batcher.t.sol|test_batcherRejectsValueOnClaimBatch
contracts/test/account/Batcher.t.sol|test_combinedSweepLeavesBatcherEmpty
contracts/test/invariant/Invariant.t.sol|invariant_bypassNeverLands
contracts/test/invariant/Invariant.t.sol|invariant_budgetNeverExceeded
contracts/test/invariant/Invariant.t.sol|invariant_governorHoldsOnlyBuffer
contracts/test/invariant/RouterInvariant.t.sol|invariant_routerHoldsNothing
contracts/test/account/TroveAccountDraw.t.sol|test_S17_priceFeedRevertPropagates
contracts/test/account/Factory.t.sol|test_predictMatchesCreated
contracts/test/account/Factory.t.sol|test_sameSaltDifferentOwnerGivesDifferentAccount
contracts/test/account/Factory.t.sol|test_sameOwnerDifferentSaltGivesDifferentAccount
contracts/test/account/Factory.t.sol|test_predictBindsPolicy
contracts/test/unit/Factory.t.sol|test_predictGovernor_matchesDeployedAddress_forNewBorrower
contracts/test/unit/Governor.t.sol|test_factory_predicts_andRejectsDuplicate
contracts/test/account/Batcher.t.sol|test_claimYieldBatchStaysInAccount
contracts/test/account/Radar.t.sol|test_rank_frontier
contracts/test/account/Radar.t.sol|test_rank_head
contracts/test/account/Radar.t.sol|test_rank_middle_redeemable
contracts/test/account/Radar.t.sol|test_frontier
contracts/test/account/Radar.t.sol|test_debtAheadForNICR_belowFrontier
contracts/test/account/Radar.t.sol|testForkMainnet_fourTroves
contracts/test/account/Radar.t.sol|testForkTestnet_labRanks
backend/test/config.test.ts|loads when X402_PAY_TO is a valid address and keeps other defaults
backend/test/indexer.test.ts|indexes factory, follows new governor, mirrors policy, is idempotent
backend/test/indexer.test.ts|start() polls and stop clears the timer; errors are swallowed
EOF

if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "$PAIRS"
  exit 0
fi

fail=0
count=0
while IFS='|' read -r file name; do
  [ -z "$file" ] && continue
  count=$((count + 1))
  if [ ! -f "$file" ]; then
    echo "MISSING FILE: $file (wanted test $name)"
    fail=1
  elif ! grep -qF "$name" "$file"; then
    echo "MISSING TEST: $name in $file"
    fail=1
  fi
done <<< "$PAIRS"

# Negative checks: plan-named tests the threat model says do NOT exist must
# still not exist (if one appears, the doc's call-out is stale — update it).
for ghost in test_owner_immutable test_x402_session_bound test_bounty_farming_blocked test_recovery_mode_semantics; do
  if grep -rq "$ghost" contracts/test backend/test 2>/dev/null; then
    echo "STALE CALLOUT: $ghost now exists — update docs/THREAT_MODEL.md"
    fail=1
  fi
done

# S26: no MCP package, no gate string — fail if either silently appears
# without the doc being updated (a bare grep hit means the rule may now
# be implementable; the doc must say so).
if [ -d mcp ] || grep -rq "STERNPOST_MAINNET_OK" contracts backend sdk app shared 2>/dev/null; then
  echo "STALE CALLOUT: MCP package or STERNPOST_MAINNET_OK now exists — update S26 in docs/THREAT_MODEL.md"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "check-threat-model: OK ($count cited tests found)"
  exit 0
else
  echo "check-threat-model: FAIL"
  exit 1
fi
