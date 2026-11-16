# Slither triage

Command (workflow-exact, run from `contracts/`):

```
slither . --filter-paths "lib|test|script" --exclude reentrancy-balance --fail-high
```

Slither, 34 contracts, 101 detectors (per the `INFO:Slither:` summary
line in [slither.txt](slither.txt)). No version is claimed here: the
output records no version string, and CI installs `slither-analyzer`
unpinned, so no version is citable from this repo.

## Status: PASS

- Before the fix (main `5872e51`): **100 results, exit 255** — `--fail-high`
  tripped on 4 HIGH findings.
- After the fix (this branch): **95 results, exit 0** — zero HIGH findings
  remain. The 5 removed results are the 4 HIGHs below plus one
  `reentrancy-benign` (`_open`'s `policy.minDebtAhead` write, cleared by the
  same CEI reorder).

Note on the "before" numbers: no pre-fix slither output is preserved in
the repo — the committed `judges/slither.txt` at base `5872e51` is stale
(its summary line reads "analyzed (9 contracts with 102 detectors), 20
result(s) found"). The 100 results / 4 HIGH / exit 255 figures come from
a fresh slither run on base source; the exit 255 is corroborated by the
CI task brief, which reported the `--fail-high` failure.

Correction to the pre-classification: the real run had **no separate
`shield()` reentrancy-no-eth** — `shield()` appeared only under
`reentrancy-eth` (`lastShieldBlock`) and `reentrancy-benign`
(`totalBountyPaid`). The 4 HIGHs were exactly H1, H2, H4, H5 below.

## Fixed (HIGH)

| Detector | Where | Fix |
|---|---|---|
| reentrancy-eth | `TroveAccount._open` (`src/account/TroveAccount.sol#869-896`): `opened = true` (L891) and `policy.minDebtAhead = …` (L892) now precede `bo.openTrove{value: msg.value}` (L893) | CEI reorder: both writes now precede the `openTrove` call. A re-entrant `open()` hits `AlreadyOpened` instead of re-entering; if `openTrove` reverts the writes roll back with the tx, so no half-opened state can persist. No dedicated reentrancy test pins this reorder: `test/unit/Reentrancy.t.sol` covers only `test_reentrantDraw_blocked` (draw, not `_open`), and `test_readOnce_openRankWalk` (`contracts/test/account/TroveAccountShield.t.sol:591`) tests the read-once price fetch, not reentrancy. The reorder is verified by the `reentrancy-eth` finding disappearing from the after-run plus code reading. |
| reentrancy-eth | `TroveAccount.shield` (`src/account/TroveAccount.sol#587-684`): `lastShieldBlock = uint64(block.number)` at L602, just after the cooldown check (L591–596) and before `smusd.withdraw` (L637), `bo.repayMUSD` (L642), `bo.addColl{value: …}` (L656) and the bounty `_safeTransfer` (L680) | `lastShieldBlock` moved to just after the cooldown check, before the legs. It still advances only on success: any revert below rolls the write back with the tx (pinned by `test_shield_reentrancy_blocked`, which asserts `lastShieldBlock == 0` after a reverted shield, and `test_crashDuringCooldown_stateSurvives`, which asserts a failed shield never sets it). `totalBountyPaid` stays after the legs — it needs the post-leg `icrAfter` — see Accepted below. |
| reentrancy-no-eth | `TroveAccountFactory.createAccount` (`src/account/TroveAccountFactory.sol#121-135`): `isAccount[account] = true` (L132) now precedes `ITroveAccount(account).initialize(…)` (L133) | CEI reorder: `isAccount[account] = true` now precedes `initialize`. A re-entrant `createAccount` for the same address hits `AlreadyCreated`; an `initialize` revert rolls the write back. `test/account/Factory.t.sol` (`test_secondCreateWithSameOwnerAndSaltReverts`) pins plain double-create, not reentrancy during `initialize`; the reorder is verified by the `reentrancy-no-eth` finding disappearing from the after-run plus code reading. |
| arbitrary-send-eth | `TroveAccount._sendBtc` (`src/account/TroveAccount.sol#1027-1031`) | Inline `// slither-disable-next-line arbitrary-send-eth`, same precedent as `SternpostRouter._sendBtc` (`src/routes/SternpostRouter.sol#315`). All 3 callers pass `owner` only (`withdrawColl`, `closeAccount`, `sweepBtc`) — `to` is never caller input. |

## Accepted, with reasons

The remaining 95 results are all Medium/Low/Informational and do not trip
`--fail-high`. Counts per detector (they sum to 95):

| Detector | Count | Why it is safe |
|---|---|---|
| calls-loop | 26 | Every loop is bounded and every callee is immutable/trusted: `Batcher` batches are capped by `MAX_BATCH` (`multi`/`multiDraw` are all-or-nothing; the claim/checkpoint batches are best-effort and record per-account `ok`); `Radar.rank` / `debtAheadForNICR` and `TroveAccount._debtAheadForNICR` stop at `MAX_RANK_STEPS = 25`; `SternpostRouter.loop` rejects `legs.length > MAX_LEGS = 2`. No loop iterates over caller-controlled unbounded input. |
| timestamp | 13 | Second-level precision is fine for what it guards: session/agent expiries, draw deadlines (120 s windows), the daily rollover, and swap deadlines. No value transfer depends on exact miner timestamp ordering. |
| unused-return | 13 | Deliberately ignored tuple slots of `getEntireDebtAndColl` (only coll/principal/interest are used); `musd.approve` returns in `TroveAccount.initialize` / `approveToken` (MUSD is a known well-behaved ERC20 and the approval target is the immutable sMUSD — a failed approve surfaces as a later `park` revert, not a silent loss). |
| reentrancy-events | 9 | Only events follow the external calls (`Batcher` batches, `Factory.createAccount` `AccountCreated` — now after `isAccount = true` — `Governor.fund`, `TroveAccount.initialize`, `SpendWallet.setBudget`/`sweep`). Events cannot move funds or change control flow. |
| missing-zero-check | 9 | `SpendWallet` constructor/`setAgent`: only the Factory creates wallets, passing `msg.sender` as owner (never `address(0)`); a zero agent means "no agent" by design — `isValidSignature` treats `agent == address(0)` as invalid. `SternpostFactory`/`SternpostGovernor` constructors take the immutable Mezo addresses, deployed once with verified values. `Batcher` batch functions: a zero address in a best-effort batch yields a vacuous entry and moves nothing (no value is forwarded, no state is written for it). |
| low-level-calls | 6 | `Batcher.multi` / batch calls and both `_sendBtc` sites check the return value and revert (or record `ok = false`) on failure. The low-level call is the mechanism, not a gap. |
| reentrancy-benign | 3 | `SternpostGovernor.draw`: `_inDraw = false` after `withdrawMUSDWithSignature` is the reentrancy lock being released, and `_standby` is written only after the borrow succeeds, all under `nonReentrant`; the ActivePool callback path requires `_inDraw && msg.sender == activePool && msg.value == 0 && _callbacks == 0`. `SternpostRouter.loop`: the `_acceptBtc` true/false toggle brackets the legs under `nonReentrant` and is reset in the same call. `TroveAccount.shield`: `totalBountyPaid += bountyDue` is a monotonic lifetime accumulator whose value depends on the post-leg `icrAfter`, so it cannot move before the legs; a re-entrant `shield()` reverts on the `nonReentrant` lock before reaching it, and the only callee that could re-enter is the immutable Mezo `BorrowerOperations`. |
| uninitialized-local | 2 | `shield().reason` is assigned on every non-reverting path (the if/else chain ends in `revert NotStressed`); `shield().bountyPaid` defaults to 0 and is only read in the final `Shielded` event. Solidity zero-initialises both; the detector flags the absence of an explicit initialiser, not a use-before-set. |
| assembly | 2 | `Batcher.multi` (revert-data bubbling) and `TroveAccountFactory._clone` (standard ERC-1167 minimal-proxy CREATE2 init code). No alternative in Solidity for either. |
| costly-loop | 2 | `SternpostRouter.loop` `_acceptBtc` toggle: one SSTORE per leg, at most 2 legs — deliberate, not a gas bug. |
| cyclomatic-complexity | 2 | `SternpostGovernor.draw` (19) and `TroveAccount.shield` (23). Informational; splitting either would churn audited flows for a style number. |
| shadowing-local | 2 | `_collWanted` parameter `repay` shadows the `repay` function; `ITroveAccount.initialize` parameter `owner` shadows the `owner()` getter (interface only). Different scopes, no ambiguity in practice. |
| naming-convention | 2 | `SternpostGovernor.DOMAIN_SEPARATOR` and `TroveAccountMainnet.MAX_SESSION_BUDGET` are constants; the detector wants mixedCase, the EIP-712 / constant convention is UPPER_SNAKE. Informational. |
| divide-before-multiply | 1 | `TroveAccount._debtAheadForNICR`: `troveNicr = coll * NICR_SCALE / troveDebt` then `troveNicr * price / NICR_SCALE >= MCR`. Multiply-first preserves precision at the 1e20 NICR scale; the result feeds a `>= MCR` threshold, not exact accounting, so the bounded rounding cannot move funds. |
| incorrect-equality | 1 | `shield()` `repaid == 0 && collAdded == 0`: an exact-zero check on two uints the function itself computed, not a balance comparison subject to dust or griefing. |
| missing-inheritance | 1 | `SpendWallet` "should inherit from IERC1271" — it implements `isValidSignature` manually with the same signature; inheriting would change nothing functionally. Informational. |
| too-many-digits | 1 | `SternpostFactory.predictGovernor`: the long literal is the CREATE2 init-code-hash preimage, not a magic number. Informational. |

## Excluded detector

`reentrancy-balance` is excluded from the CI command, as before. The
pattern it flags is the deliberate balance-delta / residue proof used
across the tree: `SternpostRouter` reads `musd`/`savings`/BTC balances
before each leg and reverts `Residue()` on any mismatch after it, and
`TroveAccount.closeAccount` / `shield` read balances around Mezo calls
the same way. Every such function is `nonReentrant`, and the only
re-entry the design allows is the ActivePool's zero-value callback while
`Governor._inDraw` is set. The exclusion is intentional, not a gap.

## Deployed bytecode — NOT yet carrying these fixes

The fixes above change `TroveAccount` and `TroveAccountFactory`
bytecode. The live deployment predates them: the Shield redeploy of
2026-11-15 (from main `3271231`) put implementation
`0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8` and Factory
`0x46442898c022e1fAa2BD05a23600C1Ec89DcA200` on Mezo testnet 31611.
**A fresh deploy is required before the fixed bytecode is live**, and
`script/bytecode-match.py` must be re-run against the new deployment
afterwards. Do not cite the old October factory (`0x0632A9Fe…`) — it was
superseded by the Shield redeploy.

## Verification

- `forge build --sizes` passes (via_ir, solc 0.8.24).
- `forge test --match-path "test/account/*"`: 208 passed, 0 failed, 5 skipped.
- `forge test --match-path "test/unit/*"`: 94 passed, 0 failed.
- `forge test --match-path "test/routes/*"`: 8 passed, 0 failed.
- `forge test --match-path "test/invariant/*"`: 2 passed, 0 failed.
- Full counts (all suites, incl. fork + vitest) are in `TESTS.json`,
  regenerated by `FORK=1 make test-all` on this branch — total 495
  passing, 0 failed, 24 skipped; distinct declared 540. Note: the regen
  only exits 0 with the `scripts/summarize.mjs` fix in this branch (the
  account invariant suite had no EXPECTED entry — see the commit message).
