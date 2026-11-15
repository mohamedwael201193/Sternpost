<div align="center">

<img src="docs/media/hero.webp" alt="Sternpost landing: Borrow against Bitcoin. Never sail past the floor." width="900" />

# Sternpost

**Guarded MUSD credit lines for apps and AI agents, on your Mezo trove.**

[![contracts](https://github.com/mohamedwael201193/Sternpost/actions/workflows/contracts.yml/badge.svg)](https://github.com/mohamedwael201193/Sternpost/actions/workflows/contracts.yml)
[![sdk](https://github.com/mohamedwael201193/Sternpost/actions/workflows/sdk.yml/badge.svg)](https://github.com/mohamedwael201193/Sternpost/actions/workflows/sdk.yml)
[![backend](https://github.com/mohamedwael201193/Sternpost/actions/workflows/backend.yml/badge.svg)](https://github.com/mohamedwael201193/Sternpost/actions/workflows/backend.yml)
[![CodeQL](https://github.com/mohamedwael201193/Sternpost/actions/workflows/codeql.yml/badge.svg)](https://github.com/mohamedwael201193/Sternpost/actions/workflows/codeql.yml)
[![tests](https://img.shields.io/badge/tests-256%20passing-2ea44f)](#tests)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[**Live app**](https://sternpost-pink.vercel.app) · [**Deck**](https://sternpost-deck.vercel.app) · [**Demo video**](https://youtu.be/EyLSaYiIX5M) · [**API**](https://sternpost-api.vercel.app) · [**Telegram bot**](https://t.me/sternpost_bot) · [For judges](judges/JUDGES.md) · [All testnet txs](judges/TESTNET_TXS.md) · [Threat model](docs/THREAT_MODEL.md)

</div>

## TL;DR

- **Problem:** a Mezo `WithdrawMUSD` signature is all-or-nothing. It has no budget, no payee, and nothing stops it pushing your trove toward liquidation.
- **Solution:** give an app or agent a *budget*, not your keys. The `SternpostGovernor` checks budget, cap, expiry and payee, then re-checks your collateral ratio **after** the withdraw and reverts below your floor ([`0xf3920683…`](https://explorer.test.mezo.org/tx/0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf)) (Wave-1 run).
- **The gate:** a signature sent straight to Mezo reverts ([`0xfd93314c…`](https://explorer.test.mezo.org/tx/0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2)) (Wave-1 run). **Revoke** kills every outstanding signature in one tx ([`0xf0763cf4…`](https://explorer.test.mezo.org/tx/0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb)) (Wave-1 run).
- **Composable:** Keep / Save / Swap / Loop routes, x402 payments from an EIP-1271 SpendWallet, and a Telegram bot.
- **Proof:** live on Mezo testnet, fork-tested on Mezo testnet *and* mainnet, deployed bytecode matched byte-for-byte to this repo.

## Screenshots

| Dashboard | Wallet picker |
|---|---|
| <img src="docs/media/dashboard.webp" width="420" alt="Dashboard" /> | <img src="docs/media/wallet-modal.webp" width="420" alt="Wallet picker" /> |
| **Routes (landing)** | **Telegram bot (landing)** |
| <img src="docs/media/landing-routes.webp" width="420" alt="Routes section" /> | <img src="docs/media/landing-telegram.webp" width="420" alt="Agents and Telegram section" /> |

## How it works

1. **Set a floor.** The borrower deploys a governor from the factory with a floor ICR (demo: 250%) and a defend ICR (demo: 160%).
2. **Authorize an app.** Budget, per-draw cap, expiry and an optional payee lock. `previewDraw()` returns a plain reason (`BELOW_FLOOR`, `OVER_BUDGET`, …) before anything is signed.
3. **Draw.** The borrower signs `withdraw@n` + `heal@n+1`; the app submits through `draw()`. The governor enforces policy and the post-draw floor, or the whole tx reverts.

```mermaid
flowchart LR
  B[Borrower<br/>Mezo trove] -- "sign withdraw@n + heal@n+1" --> A[App / AI agent]
  A -- "draw()" --> G[SternpostGovernor<br/>budget · cap · expiry · payee]
  G -- "withdrawMUSDWithSignature" --> M[Mezo BorrowerOperationsSignatures]
  M -- "ActivePool callback (gate)" --> G
  G -- "ICR after ≥ floor, else revert" --> P{payee}
  P --> SW[SpendWallet EIP-1271] -- "x402 / Permit2" --> API[Paid API]
  P --> R[SternpostRouter] --> S[Save: sMUSD] & SWP[Swap: MUSD/BTC pool] & L[Loop: add collateral]
  K[Keeper / anyone] -- "defend() below defend ICR" --> G
  TG[Telegram bot] -. reads/alerts .-> API
```

## Mezo integration

| Mezo component | How Sternpost uses it |
|---|---|
| `BorrowerOperationsSignatures` | Draws via `withdrawMUSDWithSignature`; heals/loops via signed repay and AddColl |
| `ActivePool` callback | The gate: the governor accepts the BTC callback only inside its own `draw()` |
| `TroveManager` + `PriceFeed` | Post-draw ICR check against the floor |
| `MUSD` / `sMUSD` | Credit asset; the defend reserve and the Save route earn in sMUSD |
| Mezo DEX MUSD/BTC pool | Swap and Loop routes, with a min-out |
| Mezo Passport (OrangeKit) | Bitcoin-wallet sign-in in the app |

## SDK

```ts
import { Sternpost, pay, musdRequirements } from "@sternpost/sdk";

const sp = new Sternpost(publicClient);
const p = await sp.previewDraw(governor, app, parseEther("10"), spendWallet); // { ok, reason, text, icrAfter }
const auth = await sp.authorizeDraw(borrowerWallet, governor, parseEther("10")); // withdraw@n + heal@n+1
await sp.requestDraw(appWallet, governor, spendWallet, auth);                   // refuses a stale nonce locally
await pay({ wallet: spendWallet, agent, publicClient, requirements: musdRequirements(merchant, 10n ** 17n), resource });
await sp.revoke(borrowerWallet, governor);                                       // freeze + nonce burn
await sp.rearm(borrowerWallet, governor, parseEther("5"));
```

The script for the full live run is [`sdk/examples/e2e-testnet.ts`](sdk/examples/e2e-testnet.ts) (`npm run e2e`) — last run in full in Wave 1; on the 0.9 deployment only `defend()` was re-run.

## Deployments (Mezo testnet, chain 31611)

| Sternpost contract | Address |
|---|---|
| SternpostFactory | [`0x3977…F6d8`](https://explorer.test.mezo.org/address/0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8) |
| SternpostGovernor (demo) | [`0x1bF4…1F38`](https://explorer.test.mezo.org/address/0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38) |
| SpendWallet (demo) | [`0x4F87…Ee4a`](https://explorer.test.mezo.org/address/0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a) |
| SternpostRouter v2 | [`0xd683…88d4`](https://explorer.test.mezo.org/address/0xd6833f811e987f06a1e55a435d4be38c6d4188d4) |
| SternpostRouter v1 (superseded) | [`0x7550…284c`](https://explorer.test.mezo.org/address/0x7550a53Cc5510B192A3B486368B8330D1CC7284c) |

| Mezo contract used | Address |
|---|---|
| BorrowerOperationsSignatures | [`0xD757…639e`](https://explorer.test.mezo.org/address/0xD757e3646AF370b15f32EB557F0F8380Df7D639e) |
| TroveManager | [`0xE47c…6bb0`](https://explorer.test.mezo.org/address/0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0) |
| PriceFeed | [`0x86bC…9366`](https://explorer.test.mezo.org/address/0x86bCF0841622a5dAC14A313a15f96A95421b9366) |
| MUSD | [`0x1189…c503`](https://explorer.test.mezo.org/address/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503) |
| sMUSD | [`0x6f46…8e16`](https://explorer.test.mezo.org/address/0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16) |
| DEX router | [`0x9a1f…D7E9`](https://explorer.test.mezo.org/address/0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9) |
| MUSD/BTC pool | [`0xd16A…6AA9`](https://explorer.test.mezo.org/address/0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9) |

ABIs: [`shared/abis`](shared/abis). Every address and hash: [`shared/deployments/testnet.json`](shared/deployments/testnet.json).

The 0.9 Classic redeploy (2026-11-15): the Factory was deployed in [`0x1c66a1c5…`](https://explorer.test.mezo.org/tx/0x1c66a1c572024a808645abbb7163496c4b7252c800246a1b9aabc6f303cbd1e1) at [block 16794393](https://explorer.test.mezo.org/block/16794393) (gas 4,773,613). The governor, spend wallet and router deploys from the same redeploy are in [`shared/deployments/testnet.json`](shared/deployments/testnet.json).

### Shield redeploy (1.9-redeploy, 2026-11-16, Mezo testnet 31611) — CURRENT

**This redeploy supersedes the 1.9 deployment below.** The 1.9 implementation `0xC4f080…470` **did contain `shield()`** (the base Shield version, already in main before the 22:45 deploy) — the gap was not the function's absence. The 22:45 implementation + Factory predate the Shield fix rounds [`e7a4177`](https://github.com/mohamedwael201193/Sternpost/commit/e7a4177) (F1–F9: 50 MUSD lifetime bounty cap, `armExit`/`ExitArmed`, `ZeroPrice` guard, `needed()` reason 3, single price fetch, hints re-read, cooldown 1..10,000) and [`3271231`](https://github.com/mohamedwael201193/Sternpost/commit/3271231) (Factory rejects a bad cooldown up front with `BadCooldown`). The Factory has no upgrade path (immutable implementation), so the fixes only go live via this fresh deploy from main `3271231`. The 1.9 deployment is preserved as prior history in [`shared/deployments/testnet.json`](shared/deployments/testnet.json) (`accounts.previous`).

Deployer [`0xf76e…71a3`](https://explorer.test.mezo.org/address/0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3) (also the fee recipient, feeBps 10). Total deploy cost 1,036,001,798 wei ≈ 0.000000001036 BTC (7,091,664 gas; 146 wei, Factory 147 wei) — proven by the deployer balance delta 0.013361427276718716 → 0.013361426240716918 BTC. Compiler 0.8.24, optimizer 200, via_ir, evm_version paris. Full proof: [`docs/proof/accounts-2026-11-16.md`](docs/proof/accounts-2026-11-16.md); record: [`shared/deployments/testnet.json`](shared/deployments/testnet.json).

| Contract | Address | Deploy tx | Block | Gas used | Verification |
|---|---|---|---|---|---|
| TroveAccount (implementation) | [`0x02Dd…0B8`](https://explorer.test.mezo.org/address/0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8) | [`0xf98d…c083`](https://explorer.test.mezo.org/tx/0xf98de49f1f16d38edcfaa9108ed1f5f978bd08c7fdbf871e8be5fa4f163dc083) | [16804465](https://explorer.test.mezo.org/block/16804465) | 4,958,837 | Blockscout source-verified (v2 API `is_verified: true`) |
| TroveAccountFactory | [`0x4644…200`](https://explorer.test.mezo.org/address/0x46442898c022e1fAa2BD05a23600C1Ec89DcA200) | [`0xd1d0…28c`](https://explorer.test.mezo.org/tx/0xd1d0227b0ed91ac1d80add1570b0441d51443ec00edc7c984ac11890e897728c) | [16804466](https://explorer.test.mezo.org/block/16804466) | 618,854 | v2 `is_verified: true` — see note below |
| Radar | [`0xfe74…C6C`](https://explorer.test.mezo.org/address/0xfe74C8e67f0499e4426DD71D6bdf48A9A557DC6C) | [`0x1b73…e3ca`](https://explorer.test.mezo.org/tx/0x1b73bfb0642eb19debb9ceeae17cd5ee04888f06d0d99212a7fe8090e520e3ca) | [16804467](https://explorer.test.mezo.org/block/16804467) | 859,130 | Source present — see note below |
| Batcher | [`0x427D…6F8`](https://explorer.test.mezo.org/address/0x427D3B9ee181f8658698c1c6c0F8075d003406F8) | [`0x339c…3587`](https://explorer.test.mezo.org/tx/0x339c550ab276f609bed44377a103602850cf373e3ffe1c3908bc2ea7e17b3587) | [16804468](https://explorer.test.mezo.org/block/16804468) | 654,843 | Source present — see note below |

**Verification, stated honestly:** the Factory's v2 record is `is_verified: true` but also classifies it as `proxy_type: basic_implementation` pointing at the verified TroveAccount implementation — Blockscout's proxy-detector misfiring on the ERC-1167 clone bytecode (same as 1.9); the factory is NOT functionally a proxy. Radar and Batcher: `forge verify-contract` reports "already verified" (bytecode unchanged from the verified 1.9 contracts) and the Blockscout v1 `getsourcecode` API returns full source + ABI for both (compiler v0.8.24), but the v2 `is_verified` flag still reads `false` — a Blockscout indexer quirk. Independent proof: all four deployed bytecodes MATCH the local forge build (immutables masked) — Impl 22,713 B, Factory 2,539 B, Radar 3,726 B, Batcher 2,784 B. Factory immutables read from chain: implementation `0x02Dd…0B8`, feeRecipient deployer, feeBps 10.

**Demo account: still BLOCKED on funding.** The deployer holds 0.013361426240716918 BTC after the redeploy; a minimum trove needs ≥0.0340 BTC at 110% MCR (≥0.0774 BTC at 250% ICR). No demo account was created and none is claimed. The new addresses flow into the frontend from [`shared/deployments/testnet.json`](shared/deployments/testnet.json) (`app/src/lib/chain.ts` `ACCOUNTS`, no hardcoded addresses); the Shield fix rounds changed the interfaces, so [`shared/abis/TroveAccount.json`](shared/abis/TroveAccount.json) (117 → 129 entries) and [`shared/abis/TroveAccountFactory.json`](shared/abis/TroveAccountFactory.json) (20 → 21, +`BadCooldown`) were refreshed from the fresh build.

### Wave 2 account contracts (1.9, 2026-11-15, Mezo testnet 31611) — SUPERSEDED by the Shield redeploy above

Deployer [`0xf76e…71a3`](https://explorer.test.mezo.org/address/0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3) (also the fee recipient, feeBps 10). Total deploy cost ~0.000000001 BTC (6,879,308 gas at 146 wei). Compiler 0.8.24, optimizer 200, via_ir, evm_version paris. Full proof: [`docs/proof/accounts-2026-11-15.md`](docs/proof/accounts-2026-11-15.md); record: [`shared/deployments/testnet.json`](shared/deployments/testnet.json) (`accounts.previous`).

| Contract | Address | Deploy tx | Block | Gas used | Verification |
|---|---|---|---|---|---|
| TroveAccount (implementation) | [`0xC4f0…470`](https://explorer.test.mezo.org/address/0xC4f080498a720887b6086f13fBad5627d8abc470) | [`0x0c21…b7a2`](https://explorer.test.mezo.org/tx/0x0c2128c6357dbbaa6ea669d4d741bbd054c98825b41447cf08580ef3fe09b7a2) | [16803284](https://explorer.test.mezo.org/block/16803284) | 4,773,582 | Blockscout source-verified (`forge verify-contract` Pass - Verified; v2 API `is_verified: true`) |
| TroveAccountFactory | [`0xfb4E…85C3`](https://explorer.test.mezo.org/address/0xfb4EFE7953AF18DBCaa1124DA721cD3FB8fD85C3) | [`0x9716…b6f4`](https://explorer.test.mezo.org/tx/0x9716cdf72b414bf8e99f5818d67d2c2da355a2cee1c915866d94ffe6ffbcb6f4) | [16803285](https://explorer.test.mezo.org/block/16803285) | 591,753 | See note below — **not** a flat "verified" |
| Radar | [`0x9Cd9…be2`](https://explorer.test.mezo.org/address/0x9Cd95A420e014da798dbFB74833b9D4DEe868be2) | [`0x7a08…dc8d`](https://explorer.test.mezo.org/tx/0x7a084aae58be89f31849595980176da7670f2e7652c77f0583c5051e367fdc8d) | [16803285](https://explorer.test.mezo.org/block/16803285) | 859,130 | Blockscout source-verified |
| Batcher | [`0xB094…b33`](https://explorer.test.mezo.org/address/0xB094e06559F7aF264e515F5363D9E89920b19b33) | [`0xa7b4…fec8`](https://explorer.test.mezo.org/tx/0xa7b4cf963933293b9c3141237940e8b957ddc831269618e5ea2f62e49f60fec8) | [16803285](https://explorer.test.mezo.org/block/16803285) | 654,843 | Blockscout source-verified |

**Factory verification, stated honestly:** Blockscout classifies the factory as `proxy_type: basic_implementation` pointing at the verified TroveAccount implementation, so its own v2 record reports `is_verified: false` and `forge verify-contract` reported "already verified" at deploy time. The factory is NOT functionally a proxy — this is Blockscout's proxy-detector misfiring on the ERC-1167 clone bytecode. Independent proof: all four deployed bytecodes MATCH the local forge build artifacts (immutables masked) — Factory 2,414 B, Impl 21,857 B, Radar 3,726 B, Batcher 2,784 B.

**Demo account: BLOCKED on funding.** The deployer holds 0.01336 BTC; a minimum trove needs ≥0.0340 BTC at 110% MCR (≥0.0774 BTC at 250% ICR) — derived at deploy time from min debt 2,000 MUSD (1,800 min + 200 gas comp): 2,200 / price and 5,000 / price at an implied price of ≈$64.6k/BTC (exact price-feed value not preserved in the record). No demo account was created and none is claimed. The new addresses and ABIs are exported as constants (`app/src/lib/chain.ts` `ACCOUNTS`, `app/src/lib/abi.ts`, [`shared/abis`](shared/abis)) but no UI caller exists yet; a local vite build is green with the new addresses in the bundle.

### Live site (Vercel)

Deployment [`dpl_FvNpvLatELYXPLvF8BM5oRcSr7Wj`](https://vercel.com/mohamedwael201193s-projects/sternpost/dpl_FvNpvLatELYXPLvF8BM5oRcSr7Wj) (dashboard, login required), READY 22:46 EET 2026-11-15 — [sternpost-pink.vercel.app](https://sternpost-pink.vercel.app) (HTTP 200, bundle `index-fcnQEoGc.js`), version **v0.9 LIVE**. This deployment is main [`d9e584c`](https://github.com/mohamedwael201193/Sternpost/commit/d9e584c976dca1add3e8bcf9bd77d8baf8bb2cc3) and does **not** yet contain the new Wave 2 contract addresses above — the redeploy with the new addresses follows the merge. That redeploy only puts the addresses in the bundle: no page calls the new contracts yet, and a UI caller is still needed (follow-up work: demo mode 3.2 / frontend P3). The live site does not yet call the new contracts.

## Live proof (Wave-1 run on the superseded deployment, plus the 0.9 `defend()` re-run)

Every row marked **Wave 1** ran on the Wave-1 deployment, superseded by the 0.9 Classic redeploy on 2026-11-15 (see [Deployments](#deployments-mezo-testnet-chain-31611)). Those rows demonstrate the flows on the pre-0.9 contracts — the 0.9 redeploy changed the governor code, so they are not proof of the current deployment. The only flow re-run on the current 0.9 deployment is `defend()` (last row); the full 0.9 run is in [`judges/TESTNET_TXS.md`](judges/TESTNET_TXS.md).

| What it proves | Deployment | Tx |
|---|---|---|
| Factory deployed ([block 16794393](https://explorer.test.mezo.org/block/16794393), gas 4,773,613) | 0.9 (current) | [`0x1c66a1c5…`](https://explorer.test.mezo.org/tx/0x1c66a1c572024a808645abbb7163496c4b7252c800246a1b9aabc6f303cbd1e1) |
| Safe draw by an app key → SpendWallet | Wave 1 (superseded) | [`0xba4eb129…`](https://explorer.test.mezo.org/tx/0xba4eb1299298aa6ad661cb6ed83accc9ed07ff2a42ec1b4576bb3c5f67c71523) |
| Unsafe draw refused (`Unsafe`, ICR 218% < floor 250%) | Wave 1 (superseded) | [`0xf3920683…`](https://explorer.test.mezo.org/tx/0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf) |
| Direct Mezo submission blocked by the gate | Wave 1 (superseded) | [`0xfd93314c…`](https://explorer.test.mezo.org/tx/0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2) |
| Revoke + nonce burn | Wave 1 (superseded) | [`0xf0763cf4…`](https://explorer.test.mezo.org/tx/0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb) |
| Pre-revoke signature is dead (`BadHeal`) | Wave 1 (superseded) | [`0x1938e472…`](https://explorer.test.mezo.org/tx/0x1938e4723094d02f1b36b9e100885b7e4833f462d34b8dd75e023a0827b0be6f) |
| Reserve parked in sMUSD | Wave 1 (superseded) | [`0x00a348fc…`](https://explorer.test.mezo.org/tx/0x00a348fc43ea08e94451d4c340ef5af1d3f74ed98738b1bd27fb39f243ffb3e6) |
| x402 settle from the SpendWallet | Wave 1 (superseded) | [`0x4833c4a8…`](https://explorer.test.mezo.org/tx/0x4833c4a878d7efc6a7d7c47baca8a6901b12dfa7e3ca63d9985a5b565f114140) |
| x402 purchase of the paid API brief (live API) | Wave 1 (superseded) | [`0x2a6d515c…`](https://explorer.test.mezo.org/tx/0x2a6d515c2f325a917e33a77c7f611ca86ffbd7fb21489d0225f296e4ecf38d06) |
| Save route: draw → sMUSD | Wave 1 (superseded) | [`0x2e775fc4…`](https://explorer.test.mezo.org/tx/0x2e775fc4c97ee6762ad3bbb7b8634f02b888221ef6008f4f0a111f88ac53f311) |
| Swap route: draw → BTC with min-out | Wave 1 (superseded) | [`0x8f1cffa6…`](https://explorer.test.mezo.org/tx/0x8f1cffa6e45f14b612b5998a1e08ca1666a980fdc877401b6cb9ed5691cb1c91) |
| Loop route: 2 legs, floor re-checked each leg | Wave 1 (superseded) | [`0x589fd815…`](https://explorer.test.mezo.org/tx/0x589fd81568ee61521091b3be036c00c7852a6f030d0d052f32a5794d5d6735c1) |
| `defend()` re-run on 0.9: repaid 30 MUSD, ICR 2.3791 → 2.4081 ([block 16794538](https://explorer.test.mezo.org/block/16794538)) | 0.9 (current) | [`0x3e57c0b2…`](https://explorer.test.mezo.org/tx/0x3e57c0b2b71099c01cbb4e47facd97eccece12f46bbe675bed0f4013f87600c2) |

The full 16-step flow and the router runs are in [`judges/TESTNET_TXS.md`](judges/TESTNET_TXS.md).

## Wave 2 — what landed

| Landing | Commit |
|---|---|
| 1.3 — `draw()` / `drawBySig()` acceptance tests + J3 fixes | acceptance tests [`cac8ef2`](https://github.com/mohamedwael201193/Sternpost/commit/cac8ef2e4f407e3459cf370ffe5ec6d96c243381) + J3 fixes [`b8845bb`](https://github.com/mohamedwael201193/Sternpost/commit/b8845bb40b62969990fab4d57941af21f0b3de3e) |
| 1.3/1.6 — `closeAccount` tolerates zero surplus on a redeemed trove; Batcher mock fix | `closeAccount` [`026d0c4`](https://github.com/mohamedwael201193/Sternpost/commit/026d0c4984e3922dc83c2d015fc933849ff742cf) + Batcher mock [`47eb2b0`](https://github.com/mohamedwael201193/Sternpost/commit/47eb2b0dc6f13ee614f5c0c97cb01e1e1f749845) |
| 1.6 — Batcher `promote` / claims + saturating balance delta + `MAX_BATCH` docs (J3) | promote / claims [`1dd55ed`](https://github.com/mohamedwael201193/Sternpost/commit/1dd55edee934b7bf0db6b6dc98c70e30d9cd36bf) + saturating delta / `MAX_BATCH` docs [`ad48467`](https://github.com/mohamedwael201193/Sternpost/commit/ad48467bb7c66a6fa7b2d666a1ec5baf3295449c) |
| 0.8 — test-all hardening + [`TESTS.json`](TESTS.json); fresh FORK=1 counts 256 / 270 / 273 / 137 | hardening [`47d5623`](https://github.com/mohamedwael201193/Sternpost/commit/47d562356c3eba03a2ecb48bd1582874be9abdf2) + counts [`3374eee`](https://github.com/mohamedwael201193/Sternpost/commit/3374eee7ae2f6d35b88e00fbb5182e9033825551) |
| 1.9 — TroveAccount + Factory + Radar + Batcher deployed to testnet 31611, source-verified (Factory via its verified implementation), constants + ABIs exported, no UI caller yet | deploy [`d3da23b`](https://github.com/mohamedwael201193/Sternpost/commit/d3da23bcd2696e54e93623cf83c46a86ec857c22) + proof [`docs/proof/accounts-2026-11-15.md`](docs/proof/accounts-2026-11-15.md) |
| 1.9-redeploy — Shield fix rounds live: same four contracts redeployed from main `3271231` (impl + Factory pre-1.9 predated e7a4177 F1–F9 + 3271231; 1.9 preserved as `accounts.previous`), ABIs refreshed, demo still blocked on funding | deploy [`e990c71`](https://github.com/mohamedwael201193/Sternpost/commit/e990c71aa7ae9606e158dff5c880ca02224eeb7f) + proof [`docs/proof/accounts-2026-11-16.md`](docs/proof/accounts-2026-11-16.md) |

## Tests

Counts are from [`TESTS.json`](TESTS.json) @ [`3374eee`](https://github.com/mohamedwael201193/Sternpost/commit/3374eee7ae2f6d35b88e00fbb5182e9033825551) (generated 2026-11-15 11:39 UTC; refresh pending) — **256 passing (non-fork subtotal; E2E not counted)**, **270 distinct** declared (258 non-fork + 10 fork + 2 invariant properties), **273 incl. fork** (256 + 10 testnet + 7 mainnet). The account suite was re-verified separately (row below) — the **137** and **161** rows are different snapshots, not one run: 137 is the TESTS.json contracts total (account 33 inside it), while 161 is the later account-suite re-verification @ `6c69ab2`. Note on the citation: the `commit` field embedded inside `TESTS.json` still records `7b1ffcd`, the pre-landing run commit, which does not resolve in this repository's history; `3374eee` is the commit that landed the file, and the counts above are from the file as landed at `3374eee`.

| Suite | Command | Result |
|---|---|---|
| Contracts: unit, branch, fuzz, invariant, reentrancy | `cd contracts && forge test` | **137 passing** ([TESTS.json](TESTS.json) @ `3374eee`; refresh pending) — Governor 31 + 15 branch + 4 fuzz, Router 25 + 3 fuzz, SpendWallet 10, Factory 5 (unit), RouterSlippage 8, Reentrancy 1, invariants 2, account 33 (32 + 1 fuzz) |
| Contracts: account suite (`test/account/*`) | `cd contracts && forge test --match-path "test/account/*"` | **161 passed, 0 failed, 3 skipped** ([`6c69ab2`](https://github.com/mohamedwael201193/Sternpost/commit/6c69ab2bb415fed73db960b768ced0737bfda80b); [artifact](judges/forge-account.json)) — TroveAccountTest 57/57, Draw 36, RadarUnit 17, FactoryTest 23/23, BatcherTest 28 (+1 skipped), RadarFork 2 skipped |
| Fork, real Mezo **testnet** | `cd contracts && ./script/fork.sh testnet` | **10/10** (Governor 7 + Router 3) ([log](judges/logs/fork_testnet.txt)) |
| Fork, real Mezo **mainnet** | `cd contracts && ./script/fork.sh mainnet` | **7/10** (3 skipped — Router fork skipped: no router on mainnet) ([log](judges/logs/fork_mainnet.txt)) |
| SDK (EIP-712 digests equal Solidity) | `cd sdk && npm ci && npm test` | **10/10** |
| Backend (x402 API, indexer) | `cd backend && npm ci && npm test` | **74 passed of 80 declared** (word-boundary `it(` declarations; API, indexer, x402, Telegram bot) — `test/config.test.ts` (6 tests) was not in the TESTS.json run, so only 74 executed; the 6 pass standalone |
| App unit | `cd app && npx vitest run` | **35/35** |
| App E2E (Playwright) | `cd app && npx playwright test` | 6 passing; 3 live-draw specs need `MEZO_TESTNET_PK` |
| Coverage (contracts) | `forge coverage` | Factory and SpendWallet 100%; Governor 100% lines, 93.6% branches ([report](judges/coverage.txt)) |

## CI and security

- **CI:** [contracts](https://github.com/mohamedwael201193/Sternpost/actions/workflows/contracts.yml) (forge test + **Slither `--fail-high`**), [sdk](https://github.com/mohamedwael201193/Sternpost/actions/workflows/sdk.yml), [backend](https://github.com/mohamedwael201193/Sternpost/actions/workflows/backend.yml).
- **CodeQL:** [codeql.yml](https://github.com/mohamedwael201193/Sternpost/actions/workflows/codeql.yml).
- **Dependabot:** weekly for `sdk`, `backend` and GitHub Actions ([config](.github/dependabot.yml)).
- **Slither:** no high findings after triage ([triage](judges/SLITHER_TRIAGE.md), [raw](judges/slither.txt)).
- **Bytecode:** 3/3 deployed contracts match this source byte-for-byte, immutables masked ([how](judges/VERIFY.md)).

### Security model

- The borrower's key never leaves the borrower. Apps hold only an app key that can call `draw()` within policy.
- **Floor:** ICR after every draw ≥ floor, or revert. **Gate:** direct submission to Mezo reverts atomically. **Revoke:** freezes draws and burns the Mezo nonce. **Heal:** `defend()` repays from a reserve below the defend ICR, callable by anyone.
- Router routes are governor apps with the payee locked to the router, so they pass the same checks. Approvals reset to zero and a residue check ends every route.

### Residual risks

- The gate relies on Mezo's current ActivePool callback. If it is removed, draws **fail closed** (`CallbackMismatch`); a fork test covers this.
- Mezo has one signature nonce per borrower, so other signed actions disarm the defend standby until `rearm()`. A loop leg uses the heal nonce, so re-arm after a loop.
- Swap/Loop were proven live in Wave 1 (superseded deployment) but not on forks (forks lack Mezo's BTC precompile). Loops are capped at 2 legs.
- Bitcoin wallets (OrangeKit) cannot draw: Mezo checks signatures with `ECDSA.recover` only.
- **Unaudited, testnet only.** Full analysis: [threat model](docs/THREAT_MODEL.md).

## For judges

1. Read [`judges/JUDGES.md`](judges/JUDGES.md).
2. `cd contracts && forge test`, then `./script/fork.sh testnet` and `./script/fork.sh mainnet`.
3. `forge build && python3 script/bytecode-match.py` → 3/3 MATCH.
4. `./judges/verify-routes.sh` to re-check the router txs on-chain.
5. Open any hash in [Live proof](#live-proof) on the explorer.

## Fit for the tracks

- **Track 1: DeFi (Borrowing, Lending, Looping, and Yield).** Governed MUSD borrowing against a Mezo trove with an on-chain floor, Save into sMUSD, Swap on the Mezo DEX, and Loop back into collateral (see [Live proof](#live-proof)).
- **Track 2: Access and Distribution for MUSD/MEZO.** The [Telegram bot](https://t.me/sternpost_bot) for monitoring and approvals, x402 MUSD payments for agents from an EIP-1271 SpendWallet, and Mezo-style multi-wallet access (Xverse, Unisat, MetaMask, WalletConnect and more).

## Telegram

[@sternpost_bot](https://t.me/sternpost_bot) is the chat front door to Sternpost. It is linked from the landing page and its footer.

<img src="docs/media/telegram-bot.webp" alt="@sternpost_bot: /start menu and /status for the demo trove" width="820" />

<sub>Rendered from the bot's reply templates in <code>backend/src/telegram/ui.ts</code> with the demo trove's testnet values (Wave-1 render).</sub>

- **Link:** `/link` asks for one wallet signature (no gas); the API checks it and binds the chat to your borrower address.
- **Watch:** `/status` reads ICR, floor, defend line and buffer from your Governor; `/balances` shows MUSD and MEZO.
- **Approve:** when an app posts a draw request through the API, the bot pushes a card with Approve, View, Verify and Deny. Approving opens the app to sign `authorizeApp`; status changes need your EIP-191 signature.
- **Alert and revoke:** a cron sweep pings you before ICR nears the floor, with a one-tap link to Revoke. The bot never holds keys.

## Roadmap

The 0.9 (Classic) redeploy is live on Mezo testnet now (chain 31611); Wave 1 is superseded.

| When | Milestone |
|---|---|
| Wave 2 (November 2026) | Mezo mainnet launch: Governor, Router and SpendWallet with capped limits and source-verified contracts |
| Next | External audit, then higher caps |
| Then | More routes into Mezo DeFi (pool liquidity and gauges) and an agent SDK quickstart |

## Wallets

The Sign in sheet follows testnet.mezo.org: Xverse and Unisat first, then MetaMask, Taho, WalletConnect and any wallet the browser announces (EIP-6963), plus Coinbase Wallet. Bitcoin wallets sign in through Mezo Passport's OrangeKit connectors and get a Mezo smart account that can hold, fund and send. They cannot draw: Mezo's `BorrowerOperationsSignatures` checks the EIP-712 signature with `ECDSA.recover` only (no EIP-1271), and OrangeKit has no `signTypedData`. The Draw screens say so and keep Sign & send disabled for those accounts.

Once connected, the wallet pill opens an account menu: copy address, view on the Mezo explorer, and disconnect (asks to confirm).

## Dashboard

- **Draw** starts from a safe amount, the "Max safe" chip. It is the lowest of three limits: your floor (trove health after the draw plus Mezo's fee), the app's per-draw cap, and its remaining budget. The chip says which one binds.
- **Apps** lists every authorized app (Router v1/v2, spend wallet, your own self-draw policy) with budget, remaining, per-draw cap, expiry and a per-app revoke. API draw requests are a separate list.
- **Activity** shows one row per transaction, with an explorer link.
- Below 1024px the sidebar becomes a bottom nav, and no page scrolls sideways at 390px.
- `/pay`, `/apps`, `/activity`, `/revoke` and `/draw` redirect to `/app/*`. Other paths get a 404.

## Repo

| Path | What |
|---|---|
| `contracts/` | Foundry: Governor, Factory, SpendWallet, Router, tests, fork scripts |
| `sdk/` | TypeScript (viem) SDK and the e2e example |
| `backend/` | x402 paid API and indexer (Vercel + Postgres) |
| `app/` | Chartroom landing and dashboard (Vercel) |
| `judges/` | Reproduction guide, tx tables, logs, reports |

## License

[MIT](LICENSE)
