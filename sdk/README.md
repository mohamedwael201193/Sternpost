# @sternpost/sdk

TypeScript SDK for Sternpost on Mezo testnet (chain 31611). Two surfaces:

- **Classic (Wave 1)** — `createClient`: the Sternpost Governor + SpendWallet
  credit line (`sdk/src/client.ts`, `x402.ts`).
- **Accounts (Wave 2, task 2.2)** — `createAccountClient`: the TroveAccount
  system — per-agent sessions, EIP-712 draw intents, just-in-time
  pay-by-borrow for x402 (`sdk/src/account.ts`, `intent.ts`, `pay.ts`).

Testnet only. `createAccountClient` refuses mainnet: there is no Sternpost
deployment there yet (`shared/deployments/mainnet.json`: productionContracts
all null).

## Install

```bash
cd sdk && npm ci
npm test        # vitest
npx tsc -p tsconfig.json --noEmit
```

## AccountClient

```ts
import { createAccountClient, predictAccount, collateralForICR, computeHints } from "@sternpost/sdk";

const client = createAccountClient({
  network: "testnet",
  account: "0x6B88f1f2C7791cB0cc417297B4590B0392Fbe6a1", // the account (clone) address
  ownerKey: process.env.STERNPOST_OWNER_KEY,   // owner: open / sessions / sweep
  agentKey: process.env.STERNPOST_AGENT_KEY,   // agent: draw / signIntent / payByBorrow
});

// Open a trove (creates the clone first if it does not exist yet).
await client.createAndOpen({
  salt, policy,
  debt: 1_800n * 10n ** 18n,       // 1800 MUSD == minNetDebt
  collateral: 41_400_000_000_000_000n, // 0.0414 BTC
});

// Let one agent spend, capped.
await client.setSession(agent, {
  budget: 10n * 10n ** 18n, perTx: 5n * 10n ** 18n, dailyLimit: 5n * 10n ** 18n,
  expiry: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
  anyPayee: false, canSignX402: true,
});
await client.setPayee(agent, client.address, true); // refill target: the account itself
await client.approveToken(PERMIT2, 5n * 10n ** 18n);

// Health, sessions, previews.
await client.read();            // account + trove + policy + TCR / Recovery Mode
await client.session(agent);    // budget / spent / remaining / flags
await client.previewDraw(agent, payee, amount); // { ok, reason, reasonCode, icrAfter, fee }
await client.needed();          // { icr, repayWanted, collWanted, reason }
await client.shield();          // permissionless keeper (any key pays gas)
```

`predictAccount(publicClient, owner, salt, policy)` returns the CREATE2 address.
The **policy is a required input** — the factory binds it into the salt, so an
address predicted without the policy would be a different account.

### payByBorrow — pay an x402 resource by borrowing just in time

```ts
const r = await client.payByBorrow("https://demo.vativ.io/");
// { status: "paid", amount: 1000000000000000n, payTo, network: "eip155:31611",
//   refillTx: "0x…", settleTx: "0x…", responseStatus: 200,
//   responseBody: '{"ok":true,"message":"Paid! …"}' }
```

Flow (plan §5.2 G2): GET the URL → 402 → parse `payment-required` → refuse
`NETWORK_MISMATCH` / `ASSET_MISMATCH` / `OVER_MAX` without touching the chain
→ `previewDraw` → if the account's MUSD balance is short, `draw` the shortfall
(or `refillTarget`, testnet default 0) to the account itself → sign the x402
payload with the agent key (ExactEvmScheme, Permit2, payer = the account) →
retry with `PAYMENT-SIGNATURE` → read the settle hash from `payment-response`.
A non-402 first response passes through untouched (`{ status: "paid", amount: 0n }`).
A refused preview returns `{ status: "refused", reason }` and never draws.

### signIntent — gasless draw intents (EIP-712)

```ts
const intent = await client.signIntent(payee, amount); // { agent, payee, amount, nonce, deadline, sig }
// Anyone can submit it: account.drawBySig(agent, payee, amount, deadline, sig)
```

Domain: name **`SternpostTroveAccount`**, version `"1"`, chain 31611,
verifyingContract = the account. This is the production domain — the lab
prototypes used `TroveAccountV3`, which gives a different digest and must
never verify against a production account (pinned by a test).

### Hints and collateral

```ts
await computeHints(collateral, debt, rpc); // HintHelpers + SortedTroves -> { up, lo }
collateralForICR(2.5, 1_800n * 10n ** 18n, price); // BTC needed to open at an ICR
```

`collateralForICR` composites debt + 0.1% borrowing fee + 200 MUSD gas
compensation. Note: the plan's worked example (1800 @250% @ $64,160 → 0.07794 BTC)
omits the 1.8 MUSD fee; the stated formula returns 0.07800 BTC, which is the
on-chain principal the lab measured (an 1800 MUSD open composites to 2001.8).

### Reasons

`reasonFromCode(n)` maps `previewDraw`'s 0–9 table; `reasonFromRevert(data)`
maps a revert's 4-byte selector to the same vocabulary (`BELOW_FLOOR`,
`OVER_PER_TX`, `SESSION_INACTIVE`, …); `explain(code)` is the human text.

## Live proof — pay-by-borrow on testnet, 2026-11-16

Run against the Shield-redeploy system (Factory
`0x46442898c022e1fAa2BD05a23600C1Ec89DcA200`, implementation
`0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8`, testnet 31611), price
$64,348.22/BTC at block 16814714.

| Step | Tx | Block |
| --- | --- | --- |
| withdrawColl 0.0285 BTC from the deployer's Classic trove | [0x7db3dd5a…c06411](https://explorer.test.mezo.org/tx/0x7db3dd5adf5a349675fd523f1bafb97c24010159936b47500d7f95dcddc06411) | 16814716 |
| createAndOpen the production account (debt 1800 MUSD, coll 0.0414 BTC) | [0x352891d0…050dd03](https://explorer.test.mezo.org/tx/0x352891d069c06a44afef3d9a269b766e0c4b969a5eb22e0df79c5e08a050dd03) | 16814719 |
| setSession (agent, budget 10 / perTx 5 / daily 5 MUSD, 7d, canSignX402) | [0xf35f1e1f…01f6973](https://explorer.test.mezo.org/tx/0xf35f1e1f310bee658f9ef141af277abb3a712fc48108c55b92559a3f001f6973) | 16814720 |
| setPayee (agent → account) | [0xeee467c1…16ff61e](https://explorer.test.mezo.org/tx/0xeee467c1247225edea1bcb77e24fe08cd02777d6a87497714403ff80216ff61e) | 16814721 |
| approveToken (Permit2, 5 MUSD) | [0x224aaec9…5396a74](https://explorer.test.mezo.org/tx/0x224aaec9122a0809f057efdf212715cdb7792090a3f62e151ddfa77eb5396a74) | 16814723 |
| sweepMusd (1800 MUSD to the owner — forces the refill path) | [0xb0de48b5…9ef91be2](https://explorer.test.mezo.org/tx/0xb0de48b56ce189cb5173a13a6500fa71fd262302f83ad58dcdb700cc9ef91be2) | 16814724 |
| fund agent 0.0002 BTC | [0xef7c3aa0…43a0964d](https://explorer.test.mezo.org/tx/0xef7c3aa0db48614e134f9756ba7d49d2284958d993c6ddf64ff9aabc43a0964d) | 16814726 |
| **refill draw 0.001 MUSD (agent → account)** | [0x292d3705…c6ea9b1](https://explorer.test.mezo.org/tx/0x292d3705d593fae04aa329ac9768e9731ed1af385f7fcb1d1f2ba5d72c6ea9b1) | **16814727** |
| **x402 settle 0.001 MUSD (account → demo.vativ.io payTo)** | [0xc2f27c87…96dd0c6a](https://explorer.test.mezo.org/tx/0xc2f27c874390f58eee1c234574b8b65a2bc7e47231df396463fba17096dd0c6a) | **16814731** |

- Account: [0x6B88f1f2C7791cB0cc417297B4590B0392Fbe6a1](https://explorer.test.mezo.org/address/0x6B88f1f2C7791cB0cc417297B4590B0392Fbe6a1)
  (salt `keccak256("sternpost-sdk-demo-v1")`, policy floor 1.2 / shield 1.15 /
  target 1.5 / bounty 1 MUSD / cooldown 20). After open: coll 0.0414 BTC, debt
  2001.8 MUSD, ICR 1.330, status 1, TCR 2.310, Recovery Mode false. After the
  payment: MUSD 0, ICR 1.330, session spent 0.001001 MUSD (amount + 10 bps fee).
- Agent: `0x94233B50980343bF36A6f217150b3D98E7a785AA` (fresh key, testnet only).
- `payByBorrow('https://demo.vativ.io/')` → **200**,
  `{"ok":true,"message":"Paid! You unlocked the Mezo x402 Quickstart."}`,
  settle hash `0xc2f27c874390f58eee1c234574b8b65a2bc7e47231df396463fba17096dd0c6a`.
- The settle tx's MUSD Transfer log moves exactly 0.001 MUSD from the account
  to `0xC3376296a18ef364eA19287203EEd7a87f18e738` (demo.vativ.io's payTo).

Funding note: the deployer held only 0.01336 BTC, short of the 0.0414 BTC the
new account needed, so 0.0285 BTC was withdrawn from the deployer's own
Classic trove (ICR 2.364 → 1.619, debt unchanged 2460.09 MUSD, still above the
1.6 shield line and well above MCR 1.1). That trove is the Wave 1 artifact's
trove; its ICR is now 1.619 instead of 2.364. Deployer BTC after all steps:
0.000261425211416919.

## Tests

72 tests, all passing (`npx vitest run`): the 30 pre-existing SDK tests plus
42 new ones — `reasons.test.ts` (selector table), `intent.test.ts` (EIP-712
parity with the contract's `intentDigest`, domain-name guard),
`pay.test.ts` (mocked 402/refill/refusal/settle paths against the live
demo.vativ.io 402 fixture), `account-client.test.ts` (mocked-chain client
paths, `collateralForICR` math), `addresses.test.ts` (SDK defaults pinned to
`shared/deployments/testnet.json` `accounts.*`).
