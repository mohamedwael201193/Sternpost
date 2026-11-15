# Mainnet fork rehearsal — production TroveAccount system (plan task 6.1)

**Label: mainnet fork-tested. NEVER "live on mainnet". Nothing was broadcast
to mainnet; everything ran against a local anvil fork. No mainnet keys were
used (anvil dev keys only).**

- Date: 2026-11-15 (run 2, clean; run 1 failed on the draw step — see note)
- Fork: Mezo mainnet chain 31612, fork block **13250363**
  (`anvil --fork-url https://rpc-http.mezo.boar.network --fork-block-number 13250363 --port 8546 --hardfork shanghai`)
  — `--hardfork shanghai` is required on this VM: anvil 1.8.6 with the
  default Cancun hardfork fails every `eth_call` on a Mezo mainnet fork with
  "Excess blob gas not set". Live mainnet block at run time: 13250913.
- Live mainnet price at run time: **64914581110000000000000** (≈ $64,914/BTC
  scale, 1e18 = $1). The fork's PriceFeed was stubbed to that constant
  (anvil cannot read Mezo's oracle precompile); the stub was verified to
  return the exact value before proceeding.
- Script: `contracts/script/fork-rehearse-prod.sh` (adapted from the lab
  `rehearse.sh` for the production contracts). Raw log:
  `mainnet-fork-rehearsal-2026-11-15.raw.log` (same directory).
- Production contracts deployed on the fork (repo main HEAD 3374eee):
  - TroveAccount implementation: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
    (fee 10 bps, fee recipient = fork owner)
  - TroveAccountFactory: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
  - Policy (production defaults): floor 2.50 / shield 1.60 / target 2.00,
    bounty 1 MUSD, minDebtAhead 0, cooldown 20 blocks.
  - Hints for both opens were computed by walking SortedTroves from the head
    (4 live mainnet troves): up `0x593c427d8C7bf5C555Ed41cd7CB7cCe8C9F15bB5`,
    lo `0x08278D4b1c5F7D652095a2050f1d978AEc5377ac`.

## Results

| Step | Result |
|---|---|
| Deploy implementation + factory | PASS — tx status 1 |
| Account A: `createAndOpen` 1800 MUSD at ICR 2.5 (collateral 0.077093619252039856 BTC) | PASS — tx 0x1, gas 855,533; `status()` 1 (active); ICR 2.499e18 |
| Account B: `createAndOpen` 1800 MUSD at ICR 3.0 (collateral 0.092512343102447840 BTC) | PASS — tx 0x1, gas 881,845; `status()` 1; ICR 2.999e18 |
| Session for agent `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` on B (budget 50, per-tx 10, daily 10 MUSD, 24 h, any payee) | PASS — tx 0x1, gas 145,658 |
| Agent draw 5 MUSD from B to `0x000000000000000000000000000000000000dEaD` | PASS — tx 0x1, gas 461,548; payee MUSD balance 5e18; ICR B 2.992e18; `status()` 1 |
| Park 1000 MUSD into real mainnet sMUSD (account A) | PASS — tx 0x1, gas 233,602; sMUSD balance 1000e18; `status()` 1 |
| Crash fork price 38% (×0.62) | ICR A 1.549e18; `needed()` = (icr 1.549e18, repayWanted 1.8e18, collWanted 2.229e16, **reason 1 = ICR trigger**) — trigger VERIFIED |
| `shield()` from a stranger EOA (`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`) | **NOT PRESENT — tx status 0 (failed), fork tx `0xbafb8d1897e6bbb8fa8d0c36f94eb551f0117b7d9e535ec86389fbe73e8853af`** (see gap below) |
| Restore price | ICR A 2.499e18; `status()` 1 |
| Close A (`closeAccount`, after unpark + 30 MUSD fork-only top-up from an impersonated holder) | PASS — tx 0x1, gas 392,730; account BTC 0 (swept); trove `status()` 2 (closedByOwner); owner BTC delta 0.07709347451925296 (≈ collateral minus gas) |
| Close B (`closeAccount`, same top-up) | PASS — tx 0x1, gas 364,030; account BTC 0; trove `status()` 2; owner BTC delta 0.09251223913365969 (≈ collateral minus gas) |

## Gap: shield() is NOT in the production contract on main

`shield()` is task 1.4 and is **not in `contracts/src/account/TroveAccount.sol`
on main HEAD 3374eee** (the file itself says so at line 50). The probe call
reverts (no fallback function), which is the expected evidence of absence —
not a pass. What IS verified on the fork:

- the shield **trigger** fires: at the crashed price `needed()` returns
  reason 1 with repayWanted 1.8e18 (min-net-debt-bounded, as in the lab V3
  rehearsal where ICR moved only 1.5449 → 1.5502);
- the shield **actuator** is missing until task 1.4 merges
  (implementation exists unjudged as commit `3aaadf1` in a work clone, NOT
  on main). Task 6.1 is therefore PARTIAL: open / session / draw / park /
  close pass on the production contracts; shield passes only at the trigger
  level. Re-run the shield step after 1.4 merges.

## Note: run 1 draw failure (diagnosed, script fixed, re-run clean)

Run 1 (same fork block) drew from account A, opened at exactly ICR 2.50,
and the draw reverted `BelowFloor(2.493e18, 2.5e18)` — reproduced on a
third account and confirmed by `eth_call`. That is the floor rule working
as designed, not a contract bug: an account opened exactly at the 2.50
floor has zero draw headroom. The script was fixed to draw from B
(opened at 3.0), and run 2 passes every step except the expected shield()
probe failure. The lab V3 rehearsal could
draw from a 2.50 account only because the lab policy ordered floor BELOW
shield (0.9 / 1.8 / 2.0); production policy orders shield BELOW floor
(1.60 < 2.50), so the lab's draw-from-2.50 pattern does not transfer.

## What this does NOT prove

- No mainnet deployment, no mainnet x402 settle, no real-money usage.
- No live Recovery Mode (fork price crash only), no redemption prevention
  (the shield only reduces exposure; it was not executed here at all).
- No audit or security guarantee. Per-session cap (task 1.10) and fee
  recipient are fork placeholders, not production values.
