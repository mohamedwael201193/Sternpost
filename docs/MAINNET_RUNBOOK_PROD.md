# MAINNET RUNBOOK (PRODUCTION) — TroveAccount on Mezo mainnet (chain 31612)

**Status: DRAFT — do not run the broadcast steps yet.** Task 6.1 (production
rehearsal on an anvil fork of mainnet) has NOT been run for the production
contracts, and the gate checklist below is NOT green. This file is the
runbook for the USER to run, step by step, once the gates pass. No agent
broadcasts anything on mainnet — ever. No mainnet private key appears in this
file, in the repo, or in any agent output.

Source: plan §8 (which adapts `lab/mainnet/MAINNET_RUNBOOK.md`, the lab V3
runbook — lab numbers use the OLD policy ordering `floor < shield < target`
and MUST NOT be mixed with the production policy below). Production policy is
plan §3.3: `floorICR 2.50e18`, `shieldICR 1.60e18`, `targetICR 2.00e18`,
`bounty 1e18` (1 MUSD), `minDebtAhead 10_000e18` on mainnet,
`cooldownBlocks 20`, fee 10 bps (cap 50 bps).

Label everywhere: **"capped pilot, unaudited, own funds"**.

## 0. Gate checklist (all must be true before the user is asked to fund it)

From plan §8.1, with the honest status of each item on 2026-11-15:

| # | Gate | Status |
|---|---|---|
| 1 | Phase 1 tests green and production contracts source-verified on testnet | PARTIAL. Tests: `TESTS.json` 256 passed / 0 failed / 2 skipped (non-fork subtotal), account suite 161 / 0 / 3 on re-execution. BUT the production account contracts (Factory / Implementation / Radar / Batcher) have NOT been deployed to testnet, so they are NOT source-verified anywhere. Classic 0.9 is verified (`judges/VERIFY.md`). |
| 2 | A production-contract fork rehearsal passes (task 6.1) | NOT DONE. The lab rehearsal (`lab/mainnet/rehearsal_output2.txt`) covered the LAB V3 contracts, not the production contracts. |
| 3 | The 4-trove mainnet count re-checked against the official addresses | STALE. Last read: 4 troves, TCR 3,852%, Recovery Mode false (plan §8.1). Re-run `python lab/radar.py mainnet` (step B below) before funding. |
| 4 | Per-session cap built into the mainnet implementation (task 1.10: immutable `MAX_SESSION_BUDGET`, default 20 MUSD) and visible in the UI | NOT DONE. `MAX_SESSION_BUDGET` does not exist anywhere in this repo (grep: zero hits). Until task 1.10 lands, the cap is ENFORCED MANUALLY: never open a session with `budget` above 20 MUSD (step F). The UI must show "Pilot cap: 20 MUSD per session". |
| 5 | A real `{{FEE_RECIPIENT}}` and `{{X402_PAY_TO}}` (not `0x…dEaD`) | NOT FILLED. Both are placeholders in this file. The user supplies them; the fee recipient is immutable at Factory deployment, so it must be right the first time. |
| 6 | External review | NONE. Say "unaudited" and keep the cap. |
| 7 | First test of a mainnet x402 settle | UNTESTED. Only `/supported` and `/health` have been seen for 31612. Step H is the first test. |

If any gate is red, STOP. Do not fund, do not broadcast.

## 1. What you need and what it costs

BTC = $64,160 on 2026-11-15 (plan §8.2). Re-run the step-B reads for fresh
numbers before funding — do not trust these prices.

| Item | Amount | Comes back? |
|---|---|---|
| BTC collateral for ICR 300% (recommended) | **0.09353 BTC** (about $6,000) | yes, at close |
| BTC collateral for ICR 250% | 0.07794 BTC (about $5,000) | yes, at close |
| Absolute minimum ICR 110% | 0.0343 BTC | do NOT use |
| Borrow fee 0.1% of 1,800 | 1.8 MUSD | no (cost) |
| Interest 1% APR on 2,001.8 MUSD | 0.055 MUSD/day, 1.67 MUSD/month | no (cost) |
| Gas deposit | 200 MUSD (inside the 2,001.8 debt) | yes |
| Gas for the whole lifecycle (about 40M gas worst case at 1,462,500 wei) | about 0.00006 BTC ($3.8); one 5M-gas tx about 0.0000073 BTC ($0.47) | no (cost) |
| Extra MUSD to hold at close | about 5 MUSD (fee and interest are not minted back) | — |
| **Total real cost of a one-day demo** | about 1.8 MUSD fee + 0.06 MUSD interest + about $4 gas = **about $6**, plus about $5-6k BTC locked and about 5 MUSD bought beforehand | — |

Redemption risk (plan §8.5): mainnet has only 4 troves (TCR 3,852%,
Recovery Mode false). A 250–300% minimum trove ranks 4th of 5 with about
13,813 MUSD of debt ahead of it (2 troves of ~2k plus a ~9.8k trove). Low but
not zero — the lab's testnet V3 trove was redeemed within minutes at a lower
NICR. Monitor with `radar.py` (step I) and keep `claimCollateral()` in mind.

## 2. Environment (Git Bash). You load your own key; never paste it into chat

```bash
cd D:/route/mezo/lab
set -a; . D:/route/mezo/.env; set +a
export PK="$private_key_metamask"; unset private_key_metamask GITHUB_TOKEN VERCEL_TOKEN
export M=https://rpc-http.mezo.boar.network ME=$(cast wallet address --private-key "$PK")
# Mainnet Mezo addresses (verified — see MEZO_RESOURCES.md lane 3):
export BO=0x44b1bac67dDA612a41a58AAf779143B181dEe031 TM=0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193 PF=0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88
export MUSD=0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186 SMUSD=0xb4D498029af77680cD1eF828b967f010d06C51CC SP=0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32
export ST=0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f
# PLACEHOLDERS — fill with real addresses before any broadcast:
export FEE_RECIPIENT={{FEE_RECIPIENT}}   # receives the 10 bps draw fee; immutable once deployed. NOT 0x0, NOT the burn address.
export X402_PAY_TO={{X402_PAY_TO}}       # x402 settlement payee; backend config rejects zero/burn (backend/src/config.ts)
echo "wallet $ME  BTC $(cast balance $ME --ether --rpc-url $M)  MUSD $(cast call $MUSD 'balanceOf(address)(uint256)' $ME --rpc-url $M)"
```

ABORT if the wallet printed is not the wallet you intend to fund the pilot
with. ABORT if `FEE_RECIPIENT` or `X402_PAY_TO` still contains `{{` — a
placeholder must never be broadcast.

## 3. Pre-flight reads (nothing is sent)

```bash
cast chain-id --rpc-url $M                                        # expect 31612 — ABORT on anything else
cast call $PF "fetchPrice()(uint256)" --rpc-url $M                # expect about 6.4e22 (BTC USD, 1e18 scale)
cast call $BO "minNetDebt()(uint256)" --rpc-url $M                # expect 1800000000000000000000 (1800 MUSD)
cast call $BO "getBorrowingFee(uint256)(uint256)" 1800000000000000000000 --rpc-url $M   # expect 1800000000000000000 (1.8 MUSD)
python frontier.py mainnet                                        # expect: troves=4, TCR above 3000%, RM=False — ABORT if the count or RM changed; re-check the plan §8.5 risk
curl -s https://facilitator.vativ.io/supported | python -c "import sys,json;[print(k['network'],[a['symbol']+' '+a['address'] for a in k['extra']['assets']]) for k in json.load(sys.stdin)['kinds']]"
# expect eip155:31612 listing MUSD 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186 with permit2
curl -s https://facilitator.vativ.io/health | head -c 400; echo
# expect the 31612 signer funded and healthy mainnet RPC hosts
# exact collateral for 300% (change 3.0 to 2.5 for 250%):
export COLL_WEI=$(python -c "P=$(cast call $PF 'fetchPrice()(uint256)' --rpc-url $M | cut -d' ' -f1)/1e18; print(int(3.0*(1800*1.001+200)/P*1e18))")
echo "COLL_WEI=$COLL_WEI"
```

## 4. Deploy the production contracts (you broadcast)

PREREQUISITE: task 6.1 must have rehearsed these exact commands on an anvil
fork of mainnet first. No production deploy script exists in this repo
(`contracts/script/` holds only the Classic testnet deploy scripts) — the
commands below are the rehearsal's output form, not a script that has been
run. Do NOT broadcast until 6.1 passes. Run the `forge` commands from the
Sternpost repo checkout (`cd <path-to-Sternpost>/contracts`); the `cast`
commands run from anywhere.

Dry run first (no broadcast — `forge create` without `--broadcast` only
prints the plan):

```bash
# A. Deploy the TroveAccount implementation (constructor: BO, TM, PF, MUSD, sMUSD, SortedTroves, feeRecipient, feeBps)
forge create contracts/src/account/TroveAccount.sol:TroveAccount --rpc-url $M --private-key "$PK" --gas-limit 8000000 \
  --constructor-args $BO $TM $PF $MUSD $SMUSD $ST $FEE_RECIPIENT 10
# without --broadcast this prints the plan only. Expect no error; ABORT on any revert.
```

Broadcast (real — only after the dry run and the 6.1 rehearsal):

```bash
forge create contracts/src/account/TroveAccount.sol:TroveAccount --rpc-url $M --private-key "$PK" --gas-limit 8000000 --broadcast \
  --constructor-args $BO $TM $PF $MUSD $SMUSD $ST $FEE_RECIPIENT 10
# expect: "Deployed to: 0x..."   "Transaction hash: 0x..."
export IMPL=0x...   # paste the deployed implementation address
cast code $IMPL --rpc-url $M | wc -c        # expect non-zero code (a few tens of KB of hex)
# B. Deploy the TroveAccountFactory (constructor: implementation, feeRecipient, feeBps)
forge create contracts/src/account/TroveAccountFactory.sol:TroveAccountFactory --rpc-url $M --private-key "$PK" --gas-limit 8000000 --broadcast \
  --constructor-args $IMPL $FEE_RECIPIENT 10
# expect: "Deployed to: 0x..."   "Transaction hash: 0x..."
export FACTORY=0x...   # paste the deployed factory address
```

Verify both on the mainnet Blockscout (https://explorer.mezo.org):

```bash
ARGS_IMPL=$(cast abi-encode "f(address,address,address,address,address,address,address,uint16)" $BO $TM $PF $MUSD $SMUSD $ST $FEE_RECIPIENT 10)
forge verify-contract $IMPL contracts/src/account/TroveAccount.sol:TroveAccount --chain-id 31612 --verifier blockscout \
  --verifier-url https://api.explorer.mezo.org/api/ --compiler-version 0.8.24 --constructor-args $ARGS_IMPL --watch
# expect: "Pass - Verified"
ARGS_FAC=$(cast abi-encode "f(address,address,uint16)" $IMPL $FEE_RECIPIENT 10)
forge verify-contract $FACTORY contracts/src/account/TroveAccountFactory.sol:TroveAccountFactory --chain-id 31612 --verifier blockscout \
  --verifier-url https://api.explorer.mezo.org/api/ --compiler-version 0.8.24 --constructor-args $ARGS_FAC --watch
# expect: "Pass - Verified"; then open https://explorer.mezo.org/address/$FACTORY?tab=contract
```

Compiler settings (from `foundry.toml`): solc 0.8.24, optimizer 200,
`via_ir`, EVM Paris.

## 5. Open the pilot account at 300% (you broadcast)

One transaction: `Factory.createAndOpen(salt, policy, debt, upHint, loHint,
minDebtAhead)` — payable, value = `$COLL_WEI`. Policy tuple
`(floorICR, shieldICR, targetICR, bounty, minDebtAhead, cooldownBlocks)` =
`(2500000000000000000, 1600000000000000000, 2000000000000000000,
1000000000000000000, 10000000000000000000000, 20)`.
Debt = `1800000000000000000000` (1800 MUSD net). Hints `(0,0)` are fine with
4 troves. Salt: pick any `bytes32` you record (e.g. `0x50494c4f54000000000000000000000000000000000000000000000000000000`
— "PILOT" — or a random one); the address is deterministic per owner+salt+
policy, so re-using a salt+policy reverts.

Dry run first (`cast call` the factory with the same args — a revert here
costs nothing):

```bash
export SALT={{SALT}}   # your chosen bytes32 salt, recorded below
cast call $FACTORY "createAndOpen(bytes32,(uint64,uint64,uint64,uint128,uint128,uint32),uint256,address,address,uint256)(address)" \
  $SALT "(2500000000000000000,1600000000000000000,2000000000000000000,1000000000000000000,10000000000000000000000,20)" \
  1800000000000000000000 0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 10000000000000000000000 \
  --value $COLL_WEI --rpc-url $M
# expect: returns an address (the predicted account). ABORT on any revert.
```

Broadcast:

```bash
cast send $FACTORY "createAndOpen(bytes32,(uint64,uint64,uint64,uint128,uint128,uint32),uint256,address,address,uint256)" \
  $SALT "(2500000000000000000,1600000000000000000,2000000000000000000,1000000000000000000,10000000000000000000000,20)" \
  1800000000000000000000 0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 10000000000000000000000 \
  --value $COLL_WEI --gas-limit 8000000 --rpc-url $M --private-key "$PK"
# expect status 1.
export ACC=0x...   # paste the account address from the receipt / the dry-run prediction
cast call $ACC "owner()(address)" --rpc-url $M   # expect your wallet $ME
cast call $TM "getEntireDebtAndColl(address)(uint256,uint256,uint256,uint256,uint256,uint256)" $ACC --rpc-url $M
# expect principal 2001800000000000000000 (1800 + 1.8 fee + 200 gas comp)
cast call $TM "getCurrentICR(address,uint256)(uint256)" $ACC $(cast call $PF 'fetchPrice()(uint256)' --rpc-url $M | cut -d' ' -f1) --rpc-url $M
# expect about 3.0e18 (300%)
cast call $MUSD "balanceOf(address)(uint256)" $ACC --rpc-url $M    # expect 1800000000000000000000
```

If the RPC answers `null response` or `handler crashed`, the tx may still
have landed: check `cast call $TM "getTroveStatus(address)(uint256)" $ACC`
(1 = active) before retrying. Never re-send blindly.

## 6. Agent session + draw (you broadcast; the agent key never touches your main key)

Create a fresh agent key and store it yourself (this prints a NEW private
key — never paste it into chat, never put it in the repo):

```bash
cast wallet new   # store the output in a file only you hold
export AGENT=0x... AGENT_PK=0x...   # from that output; load them from your file, not from chat
cast send $ACC "setSession(address,uint128,uint128,uint128,uint64,bool,bool)" $AGENT 20000000000000000000 10000000000000000000 20000000000000000000 $(( $(date +%s) + 7*24*3600 )) false false \
  --gas-limit 6000000 --rpc-url $M --private-key "$PK"
# budget 20 MUSD = THE PILOT CAP (manual until task 1.10 lands — never above 20 MUSD), perTx 10, daily 20, expiry +7 days, anyPayee false, canSignX402 false
cast send $ACC "setPayee(address,address,bool)" $AGENT $ME true --gas-limit 3000000 --rpc-url $M --private-key "$PK"
# payee = your wallet (draws may only pay you in the pilot)
# fund the agent with a little BTC for gas:
cast send $AGENT --value 0.0002ether --gas-limit 3000000 --rpc-url $M --private-key "$PK"
# agent draws 5 MUSD to you:
cast send $ACC "draw(address,uint256)" $ME 5000000000000000000 --gas-limit 6000000 --rpc-url $M --private-key "$AGENT_PK"
# expect status 1; then:
cast call $TM "getCurrentICR(address,uint256)(uint256)" $ACC $(cast call $PF 'fetchPrice()(uint256)' --rpc-url $M | cut -d' ' -f1) --rpc-url $M
# expect still above 2.5e18 (floor) — ABORT the demo if it is not
```

To revoke everything later (one tx): `cast send $ACC "revokeAll()"`.

## 7. Shield demo — NOT APPLICABLE until task 1.4 lands

`shield()` does not exist in `contracts/src/account/TroveAccount.sol` on
main. Do NOT run the lab's shield-line trick here: the lab used the old
policy ordering (`floor < shield < target`) and raised the shield line above
the ICR. Production validation requires `shieldICR < floorICR`, so that
command would revert — and even if it did not, it would prove nothing about
the production `shield()`. When task 1.4 lands, this section gets the real
steps (stranger calls `shield()`, bounty 1 MUSD, cooldown 20 blocks) plus the
fork-rehearsal evidence. Until then the pilot page must say the shield step
was skipped.

## 8. x402 settle on mainnet — first test (you run it)

Prerequisite: step 3 showed `eip155:31612` with MUSD on
`https://facilitator.vativ.io/supported` and a healthy `/health`. Mainnet
settle is UNTESTED (only `/supported` and `/health` have been seen for
31612). Prepare `lab/x402/pay.mjs` env per task 6.4 (agent key from a JSON
file shaped like `cast wallet new --json` output; the testnet equivalent was
proven against the outside service). Run it yourself and record the settle
hash with `network: eip155:31612` — or record the documented failure. A
failed first test is a result, not a reason to retry blindly.

## 9. Close the trove and get all collateral back (you broadcast)

```bash
cast send $ACC "unpark(uint256)" 1000000000000000000000 --gas-limit 6000000 --rpc-url $M --private-key "$PK"   # also pays out accrued sMUSD yield, if any
cast call $TM "getEntireDebtAndColl(address)(uint256,uint256,uint256,uint256,uint256,uint256)" $ACC --rpc-url $M   # debt D = principal + interest (about 2001.8 + interest)
cast call $MUSD "balanceOf(address)(uint256)" $ACC --rpc-url $M     # must be >= D - 200e18 (the 200 MUSD gas comp is paid by the protocol pool)
```

If the balance is short (it will be by about 1.8 MUSD + interest, plus
anything you spent), top the account up from your wallet (buy MUSD on a
DEX/Mezo app first if you do not hold it):

```bash
cast send $MUSD "transfer(address,uint256)" $ACC 10000000000000000000 --gas-limit 3000000 --rpc-url $M --private-key "$PK"   # 10 MUSD
cast send $ACC "closeAccount()" --gas-limit 6000000 --rpc-url $M --private-key "$PK"
cast call $TM "getTroveStatus(address)(uint256)" $ACC --rpc-url $M   # expect 2 (closedByOwner)
BAL=$(cast balance $ACC --rpc-url $M); echo "collateral in account: $BAL wei"
cast send $ACC "sweepBtc(uint256)" $BAL --gas-limit 3000000 --rpc-url $M --private-key "$PK"     # BTC back to your wallet
cast send $ACC "sweepMusd(uint256)" $(cast call $MUSD 'balanceOf(address)(uint256)' $ACC --rpc-url $M | cut -d' ' -f1) --gas-limit 3000000 --rpc-url $M --private-key "$PK"   # leftover MUSD
```

If the trove was redeemed meanwhile (status 4): run
`cast send $ACC "claimCollateral()"` first, then `sweepBtc`.

## 10. Monitoring

```bash
python radar.py mainnet $ACC      # rank from redemption frontier, ICR delta, MUSD debt ahead of you
cast call $ACC "needed()(uint256,uint256,uint256,uint8)" --rpc-url $M   # (icr, repayWanted, collWanted, reason)
cast call $TM "getTroveStatus(address)(uint256)" $ACC --rpc-url $M    # 1 active, 2 closedByOwner, 3 liquidated, 4 redeemed
```

## 11. Abort / safety rules

- Never run `forge create` / `cast send` with `--rpc-url $M` unless you
  intend a real broadcast. Every broadcast step above has a dry run first.
- ABORT if `cast chain-id` is not 31612, if `minNetDebt` is not 1800e18, if
  the facilitator does not list `eip155:31612` with MUSD, or if the trove
  count / Recovery Mode state changed since the last check.
- ABORT if any `{{PLACEHOLDER}}` is still unfilled (`FEE_RECIPIENT`,
  `X402_PAY_TO`, `SALT`).
- The account has no admin: if you lose the owner key you lose the trove.
  The owner is immutable.
- If an RPC call returns `null response` or `handler crashed`, the tx may
  still have landed — check `getTroveStatus` before retrying. Never re-send
  blindly.
- Do not mix lab numbers with production numbers: lab policy was
  floor 1.5 / shield 1.8 / target 2.0 (old ordering); production is
  floor 2.5 / shield 1.6 / target 2.0. Lab collateral figures (0.07794 /
  0.09353 BTC) were computed at BTC = $64,160 — recompute at step 3 prices.
- Keep the pilot cap: no session budget above 20 MUSD, no draw that takes
  ICR below 2.5, close the trove at the end of the demo (or leave it open
  with the cap and say so on the pilot page).

## 12. After the run — record it

Fill in `docs/proof/mainnet-<date>.md` with the real hashes (deploy,
factory, open, draw, close) and update `shared/deployments/mainnet.json`.
If any step was skipped (e.g. shield, x402), the page says which step and
why. The pilot badge is `MAINNET PILOT` only after the open tx exists.
