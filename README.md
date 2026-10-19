<div align="center">

# Sternpost

**Guarded MUSD credit lines for apps and AI agents, on your Mezo trove.**

Give an app a budget instead of your keys. Every draw is checked on-chain against your collateral floor, and a signature sent straight to Mezo is blocked.

[Live app](https://sternpost-pink.vercel.app) · [API](https://sternpost-api.vercel.app) · [For judges](judges/JUDGES.md) · [Testnet txs](judges/TESTNET_TXS.md) · [Threat model](docs/THREAT_MODEL.md)

![contracts](https://github.com/mohamedwael201193/Sternpost/actions/workflows/contracts.yml/badge.svg)
![sdk](https://github.com/mohamedwael201193/Sternpost/actions/workflows/sdk.yml/badge.svg)
![backend](https://github.com/mohamedwael201193/Sternpost/actions/workflows/backend.yml/badge.svg)
![codeql](https://github.com/mohamedwael201193/Sternpost/actions/workflows/codeql.yml/badge.svg)

</div>

## The problem

Mezo lets a borrower sign a `WithdrawMUSD` message so someone else can submit it. That suits apps and agents, but a signed withdraw is all-or-nothing. It carries no budget and no payee, and nothing stops it from pushing your trove toward liquidation.

## What Sternpost does

```
 app / agent ──draw()──▶ SternpostGovernor ──withdrawMUSDWithSignature──▶ Mezo
                         │  per-app budget, cap, expiry, payee            │
                         │  ◀── ActivePool callback (the gate) ───────────┘
                         │  ICR after draw ≥ your floor, or revert
                         ▼
                    SpendWallet (EIP-1271) ──x402 / Permit2──▶ paid API
```

- **The gate.** The withdraw signature names the governor as recipient. During the withdraw, Mezo calls the governor, and the governor accepts that call only inside its own `draw()`. A direct submission to Mezo reverts atomically. [Proof on testnet](https://explorer.test.mezo.org/tx/0xcb54e35d4608952fa0b1a1b379870dee8cf55eeefcae4c22c82690c9cba6aed1).
- **Per-app policy.** Each app gets a budget, a per-draw cap, an expiry and an optional payee lock. `previewDraw()` returns a plain reason (`BELOW_FLOOR`, `OVER_BUDGET`, …) before anything is signed.
- **The floor is enforced on-chain.** The ICR after the draw must stay at or above your floor. [An unsafe draw refused](https://explorer.test.mezo.org/tx/0xa489db6ab1602ba8c2140ebe0451b2d3a84148491f43c37d8e9d73a83f47dd78).
- **One-click revoke.** `revoke()` freezes draws and burns your Mezo nonce, which kills every outstanding signature. [Revoke](https://explorer.test.mezo.org/tx/0xda372cf83477fa33dce7d504681b13d6dcf1845427539b15f7ff746a1a60274e), then [the old signature fails](https://explorer.test.mezo.org/tx/0xe783e1f4223c0a9c9bd9544b17691a89ae6d02650f57319ac7d98459175614b5).
- **Heal and defend.** Each draw carries a paired repay signature. Anyone can call `defend()` below your defend ICR to repay from a reserve buffer, which can earn yield in sMUSD while it waits.
- **Agents pay with x402.** A SpendWallet is an EIP-1271 wallet run by an agent session key, with a Permit2 budget. [It bought the paid API brief](https://explorer.test.mezo.org/tx/0x6ec3ca884a6040e830f9d7548567323f1c42a09a37fed6d534448fcc7637b46b), and a facilitator paid the gas.

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

The full live run is [`sdk/examples/e2e-testnet.ts`](sdk/examples/e2e-testnet.ts) (`npm run e2e`).

## Deployments (Mezo testnet, 31611)

| Contract | Address |
|---|---|
| SternpostFactory | `0x29bf11Cd948CE845687A21819b2844d5321432Cf` |
| Demo governor | `0x48C880DA27b91229d2FcB5992DdC00c9EaCA7fa6` |
| Demo SpendWallet | `0x5433bc33e192d1675807306ef63a92fcD6ac2D87` |

ABIs are in [`shared/abis`](shared/abis), and addresses plus every tx are in [`shared/deployments/testnet.json`](shared/deployments/testnet.json).

## Evidence

| | |
|---|---|
| Contract tests (unit, fuzz, invariant) | 33 passing |
| Fork tests on real Mezo **testnet** and **mainnet** | 7/7 each ([logs](judges/logs)) |
| SDK tests (EIP-712 digests equal Solidity) | 9 passing |
| Coverage, Governor | 100% lines, 92.5% statements, 64% branches ([report](judges/coverage.txt)) |
| Slither | no high findings after triage ([triage](judges/SLITHER_TRIAGE.md)) |
| Live testnet flow | 16 txs ([table](judges/TESTNET_TXS.md)) |

## Repo

| Path | What |
|---|---|
| `contracts/` | Foundry: Governor, Factory, SpendWallet, tests, fork scripts |
| `sdk/` | TypeScript (viem) SDK and the e2e example |
| `backend/` | x402 paid API and indexer (Vercel + Postgres) |
| `app/` | Dashboard (Vercel) |
| `judges/` | Reproduction guide, tx tables, logs, reports |

## Honest limits

The gate relies on how Mezo's ActivePool calls back today. If Mezo removes that callback, draws fail closed. Mezo's single shared nonce means concurrent signers invalidate each other. Sternpost is unaudited and runs on testnet only. Details are in the [threat model](docs/THREAT_MODEL.md).

## License

MIT
