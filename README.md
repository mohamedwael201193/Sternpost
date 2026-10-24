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

- **The gate.** The withdraw signature names the governor as recipient. During the withdraw, Mezo calls the governor, and the governor accepts that call only inside its own `draw()`. A direct submission to Mezo reverts atomically. [Proof on testnet](https://explorer.test.mezo.org/tx/0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2).
- **Per-app policy.** Each app gets a budget, a per-draw cap, an expiry and an optional payee lock. `previewDraw()` returns a plain reason (`BELOW_FLOOR`, `OVER_BUDGET`, …) before anything is signed.
- **The floor is enforced on-chain.** The ICR after the draw must stay at or above your floor. [An unsafe draw refused](https://explorer.test.mezo.org/tx/0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf).
- **One-click revoke.** `revoke()` freezes draws and burns your Mezo nonce, which kills every outstanding signature. [Revoke](https://explorer.test.mezo.org/tx/0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb), then [the old signature fails](https://explorer.test.mezo.org/tx/0x1938e4723094d02f1b36b9e100885b7e4833f462d34b8dd75e023a0827b0be6f).
- **Heal and defend.** Each draw carries a paired repay signature. Anyone can call `defend()` below your defend ICR to repay from a reserve buffer, which can earn yield in sMUSD while it waits.
- **Agents pay with x402.** A SpendWallet is an EIP-1271 wallet run by an agent session key, with a Permit2 budget. [It bought the paid API brief](https://explorer.test.mezo.org/tx/0x2a6d515c2f325a917e33a77c7f611ca86ffbd7fb21489d0225f296e4ecf38d06), and a facilitator paid the gas.

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
| SternpostFactory | `0x0632A9FeA303c0dB4544BF642a8aD0467C6c6980` |
| Demo governor | `0x9eEa9762ED3c1dE2308c800687558064DFf0B832` |
| Demo SpendWallet | `0x6330d69EbcA4ea00969a3f8085FE8BD5FC6D41FA` |
| SternpostRouter | `0xEC30280134f06668f35753D640c6760984179674` (v1 `0x7550a53C…` superseded) |

ABIs are in [`shared/abis`](shared/abis), and addresses plus every tx are in [`shared/deployments/testnet.json`](shared/deployments/testnet.json).

## Composability: where a draw goes

`SternpostRouter` is an app on the governor (payee locked to the router), so every route still passes the governor's veto, per-draw cap, budget and ICR floor. The borrower turns routes on with a bitmask (off by default), and all output goes to the borrower.

| Route | What happens | Live tx |
|---|---|---|
| Keep | plain governed draw to the payee | see [flow](judges/TESTNET_TXS.md) |
| Save | draw → deposit to Mezo sMUSD savings → shares to borrower | [`0x2e775fc4…`](https://explorer.test.mezo.org/tx/0x2e775fc4c97ee6762ad3bbb7b8634f02b888221ef6008f4f0a111f88ac53f311) |
| Swap | draw → MUSD/BTC pool on the Mezo DEX with a min-out | [`0x8f1cffa6…`](https://explorer.test.mezo.org/tx/0x8f1cffa6e45f14b612b5998a1e08ca1666a980fdc877401b6cb9ed5691cb1c91) |
| Loop | draw → swap to BTC → add as collateral to the same trove, up to 2 legs, floor re-checked after each | 2 legs: [`0x589fd815…`](https://explorer.test.mezo.org/tx/0x589fd81568ee61521091b3be036c00c7852a6f030d0d052f32a5794d5d6735c1) |

Exact approvals reset to zero and a residue check close every route. Check it yourself with `judges/verify-routes.sh`.

## Evidence

| | |
|---|---|
| Contract tests (unit, fuzz, invariant) | 85 passing (router: 25 unit, 3 fuzz, 1 no-residue invariant); Save route fork test against live sMUSD: 3 passing |
| Fork tests on real Mezo **testnet** and **mainnet** | 7/7 each ([logs](judges/logs)) |
| SDK tests (EIP-712 digests equal Solidity) | 9 passing |
| Coverage | Factory 100% lines and branches, SpendWallet 100%, Governor 100% lines and 93.6% branches ([report](judges/coverage.txt)) |
| Live code equals this source | byte-for-byte, immutables masked ([how](judges/VERIFY.md)); explorer verification is blocked for now |
| Slither | no high findings after triage ([triage](judges/SLITHER_TRIAGE.md)) |
| Live testnet flow | 16 txs ([table](judges/TESTNET_TXS.md)) |

## Repo

| Path | What |
|---|---|
| `contracts/` | Foundry: Governor, Factory, SpendWallet, tests, fork scripts |
| `sdk/` | TypeScript (viem) SDK and the e2e example |
| `backend/` | x402 paid API and indexer (Vercel + Postgres) |
| `app/` | Chartroom dashboard (Vercel): collateral dial, one-screen Draw MUSD form, wallet picker |
| `judges/` | Reproduction guide, tx tables, logs, reports |

## Wallets

The Sign in sheet follows testnet.mezo.org: Xverse and Unisat first, then MetaMask, Taho, WalletConnect and any wallet the browser announces (EIP-6963), plus Coinbase Wallet. Bitcoin wallets sign in through Mezo Passport's OrangeKit connectors and get a Mezo smart account that can hold, fund and send. They cannot draw: Mezo's `BorrowerOperationsSignatures` checks the EIP-712 signature with `ECDSA.recover` only (no EIP-1271), and OrangeKit has no `signTypedData`. The Draw screens say so and keep Sign & send disabled for those accounts.

Once connected, the wallet pill opens an account menu: copy address, view on the Mezo explorer, and disconnect (asks to confirm).

## Dashboard

- **Draw** starts from a safe amount, the "Max safe" chip. It is the lowest of three limits: your floor (trove health after the draw plus Mezo's fee), the app's per-draw cap, and its remaining budget. The chip says which one binds.
- **Apps** lists every authorized app (Router v1/v2, spend wallet, your own self-draw policy) with budget, remaining, per-draw cap, expiry and a per-app revoke. API draw requests are a separate list.
- **Activity** shows one row per transaction, with an explorer link.
- Below 1024px the sidebar becomes a bottom nav, and no page scrolls sideways at 390px.
- `/pay`, `/apps`, `/activity`, `/revoke` and `/draw` redirect to `/app/*`. Other paths get a 404.

## Honest limits

The gate relies on how Mezo's ActivePool calls back today. If Mezo removes that callback, draws fail closed. Mezo's single shared nonce means concurrent signers invalidate each other. A loop leg's AddColl signature uses the heal nonce, so the standby must be re-armed after a loop. Router swap/loop are proven live, not on forks, because forks lack Mezo's BTC precompile. Loops are capped at 2 legs: on Mezo testnet a third leg fails inside the price precompile. Sternpost is unaudited and runs on testnet only. The explorer would not accept source verification for any contract while we tried, so `judges/VERIFY.md` shows a byte-for-byte match instead. Details are in the [threat model](docs/THREAT_MODEL.md).

## License

MIT
