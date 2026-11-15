# MCP live evidence (plan §5.1)

Recorded 2026-11-15 ~22:15 EET by the fix-round builder (commit d101fcc).
RPC: `https://rpc.test.mezo.org`, chain 31611, 0.9 Classic deployment.
Fork: anvil fork of testnet (see "Fork evidence" below).

## Test runs

- `npm test` (offline): **36/36 pass** — schemas, real 402 fixture,
  snapshots, refusal reasons, key-not-in-output, stdio transport,
  the Radar-rank fallback (stubbed Radar rank() throws → direct walk,
  `rankSource: "walk"`), the pay refill branch (partial-balance
  full-amount draw, reverted receipt → `REFILL_FAILED`, refill-leg
  preview), the mainnet gate on pay/request_session/helpers, and the
  agent-key output guard. (32/32 before this fix round; +4 new tests.)
- `npm run test:live`: **13/13 pass** — every tool returns a real
  on-chain read, plus the honest refusal shapes where no TroveAccount
  exists yet (see below), plus the deployed Wave 2 Radar's on-chain
  `rank()` through the tool (`rankSource: "radar"`). An early attempt
  failed part-way: the radar rank walk's 50-wide read batches throttled
  the public RPC (`eth_chainId` timeouts in the following tests). Fixed
  by 10-wide batches + 100 ms pauses + a 30 s viem timeout; the final
  run is 13/13 (vitest-live.log, Duration 59.82 s) including the Radar
  test. No 7/12 or 12/12 intermediate log is committed — the attempt
  counts above are not logged, only the fix and the final 13/13 run are.
- `npm run smoke` (live): **PASSED** — initialize ok, `tools/list`
  returned exactly the plan §5.1 4 tools, all 4 called live.
- `npm run fork`: **PASSED** — fork tests 6/6 + fork smoke PASSED
  (see "Fork evidence"). The first fork run failed twice on the way
  there, both fixed and recorded below (PayeeNotAllowed self-payee;
  anvil fork slowness → 300 s RPC timeout + Radar-rank fallback).
- `npm run typecheck`: pass. `npm run lint`: pass (eslint 10.15.0,
  @eslint/js 10.0.1). `npm run build`: pass. Logs:
  `mcp/evidence/typecheck.log`, `lint.log`, `build.log`.

## Live testnet — what is verified, and what is not

The Wave 2 system (task 1.9) **is deployed on live testnet**
(2026-11-15, `shared/deployments/testnet.json` `accounts`, blocks
16803284–16803285: TroveAccount impl
`0xC4f080498a720887b6086f13fBad5627d8abc470`, Factory
`0xfb4EFE7953AF18DBCaa1124DA721cD3FB8fD85C3`, Radar
`0x9Cd95A420e014da798dbFB74833b9D4DEe868be2`, Batcher
`0xB094e06559F7aF264e515F5363D9E89920b19b33` — all four verified to
hold code by `getBytecode`: impl 21,857 B, Factory 2,414 B, Radar
3,726 B, Batcher 2,784 B; deploy txs in
`work/deploy-19/contracts/broadcast/DeployAccounts.s.sol/31611/run-latest.json`).
But **no account has been opened there yet** (that broadcast is 4
deploy txs, no `createAndOpen`). So on live testnet:

- `balance` with no account → `ACCOUNT_NOT_SET` refusal (no chain
  call). `balance` with the borrower address (not a TroveAccount) →
  `ACCOUNT_NOT_DEPLOYED` refusal (real `getBytecode` read).
- `pay` dryRun with no account → `ACCOUNT_NOT_SET` refusal.
- The full `balance` / `pay` success paths are verified on the fork
  below, not on live testnet. A `pay` that settles on live testnet
  needs a live TroveAccount (an account opened on the live Factory) —
  not claimed here.

## `radar` — live testnet

Smoke run (no account — system health + frontier only), values quoted
from the committed `mcp/evidence/smoke-live.log`:

- TCR `2.3323661410042025`, `recoveryMode: false`, `troveCount: 279`
- Frontier trove `0x5eaA8bdc315608E8Cf873CFAbA05e42826f68C4d`
  (the whale — same frontier as the lab run), frontier ICR
  `1.267957819699666`, frontier debt `426003946.349859583251431214` MUSD
- `synthetic: true`, `network: "testnet"`

Full walk (live test + values script), Wave-1 wallet
`0xf76e…71a3`:

- **rank 241 / 279**, `debtAheadMusd: 426579945.644167063996648951`,
  `icr: 2.3767080790130355`, `frontierIcr: 1.2630549465626084`,
  `tcr: 2.323347471323506`, `complete: true`
- Rank moved 234 (lab, block 16791591, 271 troves) → 241 (279 troves):
  the list grew; the rank is read live, not copied. Lab source:
  `build-pack/mezo/lab/LAB_METHODS.md` §9 (Wave-1 wallet rank 234 of
  271 troves) and plan §3.8; pinned fork block 16791591 per
  `docs/proof/accounts-2026-11-15.md` and `build-pack/TASK_BOARD.md`.

Deployed Wave 2 Radar (live, `STERNPOST_RADAR` set to
`0x9Cd95A420e014da798dbFB74833b9D4DEe868be2`):

- `rank()` through the tool: **rank 241 / 279, `rankSource: "radar"`,
  `complete: true`, `steps: 241`, in 1,992 ms** — the deployed Radar's
  on-chain rank works on the real chain and **agrees exactly with the
  direct walk above (241)**; `debtAheadMusd: 426580307.188409946144635135`
  (vs the walk's 426579945.64 — 0.0085% price drift between the two
  calls, different blocks), `tcr: 2.336748971370031`,
  `frontierIcr: 1.270340483410701`.
- This is the `npm run test:live` Radar test (13th test) — the Radar
  path is a repo test, not a one-off probe.

## `request_session` — live smoke

Values quoted from the committed `mcp/evidence/smoke-live.log`:

- `requestId: req_918d4d597c1d91ea`, agent
  `0x4089677C9A7Bf4E1f0c97D8061E066D434312548`,
  `status: "pending"`,
  `approveUrl: https://sternpost-pink.vercel.app/app/crew?request=req_918d4d597c1d91ea`,
  `telegram: "not_linked"`, `backend: "unavailable"`
- `backend: "unavailable"` is the honest probe result: the API has no
  `/v1/sessions/request` endpoint (root 200, `/v1/radar`, `/v1/muster`,
  `/paid/brief` all 404), so the request was recorded locally and
  returned `pending` for the owner to approve in Crew. Sandbox
  auto-approval needs the Lane B backend — not claimed.
- The agent key was generated fresh for the smoke run
  (`/tmp/sternpost-mcp-smoke-agent.json`, chmod 600) and its private
  key appears nowhere in any output (the stdio transport test asserts
  this with a sentinel).

## Classic internal helpers — live testnet

Governor `0x1bF4…71F38`:

- floorICR `2.5`, defendICR `1.6`, frozen `false`
- buffer `30` MUSD, standby `30` MUSD, deadline `1797331299`
  (`2026-12-15T10:41:39.000Z`), nonce `45`, live `true`
- ICR `2.376708117423202905`, feeBps `10`,
  feeRecipient = borrower `0xf76e…71a3`
- `factoryRecognised: true`, borrower `0xf76e…71a3`
- Matches `shared/deployments/testnet.json`
  `sternpost.classicRedeploy.defend.finalState`.

`preview_draw` — app `0x0508…2D1E`, 10 MUSD, payee = spend wallet:

- `allowed: false`, `reason: "APP_NOT_AUTHORIZED"`,
  explanation: "This app has no credit line from you."
- `icrAfter: 2.367076699935294515`, floor `2.5`,
  `remainingBudget: 0` MUSD
- Honest finding, not a server bug: the Wave-1 app `0x0508…` was authorized
  on the superseded Wave-1 governor, not on the 0.9 governor. A draw through
  the 0.9 governor needs a fresh `authorizeApp` on it first (not this
  task's scope).
- Oversized draw (1,000,000 MUSD) is likewise refused with a real reason
  code (`APP_NOT_AUTHORIZED`, covered by the live test).

`x402_quote` — route `radar`:

- Challenge: x402 v2, `payment_required`, scheme `exact`,
  network `eip155:31611`, asset MUSD `0x1189…c503`,
  amount `10000000000000000` (0.01 MUSD), payTo interim deployer
  `0xf76e…71a3`, `maxTimeoutSeconds: 300`,
  extra `{ name: "Mezo USD", version: "1", assetTransferMethod: "permit2" }`
- `payable` (live preview for the same app/payee): `allowed: false`,
  `APP_NOT_AUTHORIZED` — same finding as above.
- Quote only: no verify, settle, or send.

Spend wallet (bonus read, not a tool) — `0x4F87…9Ee4a`:

- owner = borrower `0xf76e…71a3`, agent `0x62a4773191747994c0368664cA68BC476897c1d9`,
  `agentExpiry: 1797330675`, MUSD balance `0` — matches the deployment record.

## Fork evidence

`npm run fork` (final run 2026-11-15 ~21:51 UTC): anvil fork of
testnet at **block 16804167**, live BTC price stubbed per plan G3
(**$65,140.95225**), TroveAccount impl
`0x9084ba1feb86b1b1d30c0619383be90b0ae52aae`, Factory
`0x4e8b6c2f669173b6be365285cbe906804309a4e4`, Radar
`0xe558159617b0199bb328f1a4d4baaa23e6fcc7c7`, account
`0x07d7525dF8a377D40b96A827bE99b3b795Ca7b61` (owner
`0x4BE9978EbFDB79566295fBCEf06b9C19BBF50F69`, agent
`0x08746589c1105719e257cB1D42f4DCC560A1E9F1` — fresh throwaway keys,
fork-only, key file at `/tmp/sternpost-fork-agent.json`, never in the
repo). `createAndOpen` tx
`0x1de393942ba89e4056c1ac365c730e2ace1f6d107100a779a7733cc1ab77ac11`
(0.095 BTC collateral, 2100 MUSD debt, policy floor 2.5 / shield 1.6 /
target 2.0, bounty 1, minDebtAhead 1000, cooldown 20); session tx
`0x9e39fc320883d85e70b275ed774c94f6741bd1806f531b3485d6ce41aae77ed5`
(agent, budget 10, perTx 5, daily 5, 7 days, canSignX402); borrowed
MUSD swept to 0 so `pay` must refill. **Fork tests 6/6 pass, fork
smoke PASSED.**

- `balance` (full §5.1 shape): session `active: true`, budget `10`,
  spent `0`, remaining `10`, perTx `5`, dailyRemaining `5`, expiry
  `2026-11-22T21:47:25.000Z`, `canSignX402: true`; health
  `icr: 2.688150150640275`, floor `2.5`, `recoveryMode: false`,
  `troveStatus: "active"`; `accountMusd: "0"` (before the pay test).
  After the pay test the smoke's `balance` shows `spent: "0.001001"`,
  `remaining: "9.998999"`, `accountMusd: "0.001"` — the refill draw's
  0.001 MUSD + 0.000001 fee, on-chain.
- `radar`: **rank 260 / 280, `rankSource: "radar"`, `complete: true`,
  `steps: 260`**, `tcr: 2.3395435563399802`,
  `icr: 2.688148810241433`, `frontierIcr: 1.2718587034831528`,
  `debtAheadMusd: 427781912.189685191074008317`, shield `armed: true`,
  triggers `ICR<1.6` + `RANK`. The deployed (fork) Radar's on-chain
  `rank()` completed here — it needed the 300 s RPC timeout (see below).
- `pay` dryRun: real demo.vativ.io 402, `status: "dry_run"`,
  amount `0.001`, preview `allowed: true`, reason `""`,
  `icrAfter: "2.688147640211773472"`, fee `0.000001`, `refillTx: null`.
- `pay` full flow: **refill draw tx
  `0x954477a03e19b6f3f0750d771074a374050d5ad03d77ac2da2051a35ce62c0df`
  (real tx on the fork, agent → account, 0.001 MUSD)**; then the live
  facilitator's verdict: **`status: "refused"`, `reason:
  "VERIFY_FAILED"`, `settleTx: null`, `responseStatus: 402`** — the
  fork-only account has no code on live testnet, so its EIP-1271
  Permit2 signature cannot verify there. This is the expected honest
  outcome; `paid` needs a live TroveAccount.
- `request_session`: `requestId: req_fbe82180f739506c`, agent
  `0x08746589c1105719e257cB1D42f4DCC560A1E9F1`, `status: "pending"`,
  `backend: "unavailable"`, `keyFileCreated: false` (reused the fork
  key).

Two fork failures on the way here, both fixed (not hidden):

1. First run: `pay` full flow reverted `PayeeNotAllowed(account)`
   (`0xbc2f3a3f`) — the refill draws to self, but the fork session's
   payee list held only the demo payee. Fixed by allowlisting the
   account itself as a payee in fork-setup (TroveAccount.sol:603-607
   documents `payee == address(this)` as "the x402 pay-by-borrow
   refill" — the designed configuration, not a test hack).
2. First two runs: the deployed Radar's `rank()` is one heavy eth_call
   and anvil fetches remote state per slot through the public RPC, so
   with the 30 s client timeout it was abandoned client-side while
   anvil kept executing it — which then poisoned the following tests
   (pay tests timing out on `eth_chainId` against an unresponsive
   anvil). Fixed by `STERNPOST_RPC_TIMEOUT_MS` (fork runs use 300 s)
   plus a fallback in `handleRadar`: if the Radar `rank()` throws,
   the direct SortedTroves walk runs instead and the output reports
   `rankSource: "walk"` + `rankNote`. The fallback is pinned by a
   stub test offline; on the final fork run the Radar `rank()`
   completed (`rankSource: "radar"`).

## `claude mcp add` verification

**Unreproduced on this box:** no `claude` binary exists here (checked:
`command -v claude` → missing; `/tmp/claude-cli` from the previous
build no longer exists). The stdio smoke verification above
(`npm run smoke`: initialize → `tools/list` → `tools/call` for all 4
tools) is the in-repo substitute and is recorded as such. Re-verify
with `claude mcp add sternpost -- npx -y @sternpost/mcp` on a machine
with Claude Code installed.

## Full raw outputs

See `mcp/evidence/` in this repo: `vitest-offline.log` (36/36),
`vitest-live.log` (13/13), `smoke-live.log` (live smoke),
`live-values.json` (governor / preview_draw / x402_quote / radar-walk /
spend-wallet values above), `live-radar.json` (deployed Radar rank()
through the tool + `getBytecode` on all four Wave 2 contracts),
`fork-run.log` + `fork-addresses.json` (final fork run: 6/6 + fork
smoke), `typecheck.log`, `lint.log`, `build.log` (verification runs).
Test-name coverage: the committed vitest logs were run with
`--reporter=verbose`, so every test is named (offline 36, live 13,
fork 6); the counts rest on the logs' summary lines, which agree with
the `it(` counts in the test files. No `/tmp` pointers: the logs live in the repo. Note:
`fork-run.log` contains anvil's startup banner with the 10 well-known
anvil default test private keys — those are public Foundry test keys,
not secrets, and they are redacted in the committed log (see the
`[anvil default test keys — public, redacted]` marker).
