# @sternpost/mcp — Sternpost MCP server (plan §5.1)

MCP server with exactly the plan §5.1 four tools — `balance`, `pay`,
`request_session`, `radar` — over the Wave 2 TroveAccount system on Mezo
testnet (chain 31611). Transport: stdio. `pay` spends real session budget;
everything else is read-only. No keys in any response.

## Live vs fork status (honest)

The Wave 2 system (task 1.9) **is deployed on live testnet**
(2026-11-15 22:45 EET: TroveAccount impl
`0xC4f080498a720887b6086f13fBad5627d8abc470`, Factory
`0xfb4EFE7953AF18DBCaa1124DA721cD3FB8fD85C3`, Radar
`0x9Cd95A420e014da798dbFB74833b9D4DEe868be2`, Batcher
`0xB094e06559F7aF264e515F5363D9E89920b19b33`) — but **no account has
been opened there yet** (deploy-19 broadcast: 4 deploy txs, no
`createAndOpen`). So:

- **Live testnet (verified):** `radar` (system health, frontier, live
  rank walk **and** the deployed Radar's on-chain `rank()` —
  `rankSource: "radar"`, same rank as the walk), the Classic internal
  helpers (`preview_draw`, `governor_status`, `x402_quote` against the
  0.9 governor), and the honest refusal shapes of `balance`/`pay` with
  no account deployed (`ACCOUNT_NOT_SET` / `ACCOUNT_NOT_DEPLOYED`).
- **Testnet fork (verified, FORK=1, anvil, nothing broadcast):**
  `balance` (full session + health), `pay` (dryRun + full flow with a
  real on-fork refill draw), `request_session`, `radar` (deployed
  Radar's on-chain `rank()` — needs the 300 s RPC timeout on a fork
  because anvil fetches remote state per slot; if it times out the
  tool falls back to the direct SortedTroves walk and reports
  `rankSource: "walk"`). See `LIVE_EVIDENCE.md` for the fork
  addresses and what the live facilitator answered for a fork-only account.
- **Not yet live-verifiable:** a `pay` that settles on live testnet, and
  sandbox auto-approval — both need a live TroveAccount (an account
  opened on the live Factory) and the Lane B backend respectively.
  Nothing here claims them.

## Install (Claude Code)

```sh
claude mcp add sternpost -- npx -y @sternpost/mcp
claude mcp list   # sternpost: npx -y @sternpost/mcp
```

Publishing to npm is a USER action. Until then, run it from this repo —
the plan's fallback one-liner (no build needed):

```sh
npx tsx mcp/src/index.ts
```

Or build first and run the compiled server:

```sh
cd mcp && npm ci && npm run build
node mcp/dist/index.js
```

## Install (Cursor) — `mcp.json` snippet

```json
{
  "mcpServers": {
    "sternpost": {
      "command": "npx",
      "args": ["-y", "@sternpost/mcp"],
      "env": { "STERNPOST_NETWORK": "testnet" }
    }
  }
}
```

Until the package is published, replace the command with the local path:
`"command": "npx", "args": ["tsx", "mcp/src/index.ts"]` (run from the
repo root), or `"command": "node", "args": ["/absolute/path/to/mcp/dist/index.js"]`
after `npm run build`.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `STERNPOST_NETWORK` | `testnet` | `testnet` (31611) or `mainnet` (31612). Mainnet is refused unless `STERNPOST_MAINNET_OK=1` **and** the account is recorded in `shared/deployments/mainnet.json` (which does not exist yet — mainnet is refused outright today) |
| `STERNPOST_MAINNET_OK` | — | Set to `1` to enable the gated mainnet path |
| `STERNPOST_ACCOUNT` | — | TroveAccount address; `balance`/`pay` default to it |
| `STERNPOST_AGENT_KEY_FILE` | `~/.sternpost/agent.json` | Local agent key, chmod 600, created by `request_session` if absent. The key is **never** returned in a tool result or logged |
| `STERNPOST_API` | `https://sternpost-api.vercel.app` | Backend for session requests (no `/v1/sessions/request` endpoint yet — requests are recorded locally and returned `pending`) |
| `STERNPOST_RPC` | per network | RPC URL override (plan name). `STERNPOST_RPC_URL` is kept as a legacy alias; `STERNPOST_RPC` wins |
| `STERNPOST_RADAR` | — | Deployed Radar contract address (optional; without it `radar` reads SortedTroves + TroveManager + PriceFeed directly) |
| `X402_PAY_TO` | interim deployer `0xf76e…71a3` | x402 payee; zero/burn rejected |
| `X402_PRICE` | `10000000000000000` (0.01 MUSD) | Per-route price until task 2.3 sets per-route prices |

## Tools (4 — the plan §5.1 set)

| Tool | Input | Returns |
| --- | --- | --- |
| `balance` | `account?` | `session` (`active`, `budget`, `spent`, `remaining`, `perTx`, `dailyRemaining`, `expiry`, `canSignX402`) + `health` (`icr`, `floor`, `recoveryMode`, `troveStatus`) + `accountMusd`. Read-only. Refuses `ACCOUNT_NOT_SET` / `ACCOUNT_NOT_DEPLOYED` when there is no account to read |
| `pay` | `url` (required), `method` (`GET`\|`POST`, default `GET`), `body?`, `maxAmount?`, `dryRun?` (default `false`) | `status` (`paid`\|`dry_run`\|`refused`), `amount`, `payTo`, `network`, `refillTx`, `settleTx`, `responseStatus`, `responseBody` (truncated 8 KB), `reason`. **Spends session budget.** Always calls `previewDraw` first and refuses with a reason code instead of sending a doomed tx. `dryRun` parses the 402 and runs `previewDraw` only — no tx, no payment |
| `request_session` | `account` (required), `purpose` (required, ≤200 chars), `budget` (required), `perTx?`, `days?` (1–90, default 7), `payees?` (≤10), `sandbox?` (default `false`) | `requestId`, `agent` (public key only), `status` (`pending`\|`approved`\|`denied`\|`sandbox_granted`), `approveUrl`, `telegram` (`sent`\|`not_linked`). Poll with `balance`. Sandbox sessions are capped at 5 MUSD/day per agent at approval; auto-approval needs the Lane B backend, which is not live yet — sandbox requests are recorded and returned `pending` |
| `radar` | `account?`, `network?` (`testnet`\|`mainnet`, defaults to `STERNPOST_NETWORK`) | `tcr`, `recoveryMode`, `troveCount`, `rank`, `of`, `debtAheadMusd`, `icr`, `frontierIcr`, `shield` (`armed`, `triggers`). `synthetic: true` on testnet (the plan's label). Read-only |

### `pay` refusal reasons

Plan §5.1: `BELOW_FLOOR`, `OVER_BUDGET`, `OVER_PER_TX`,
`PAYEE_NOT_ALLOWED`, `RECOVERY_MODE`, `TROVE_NOT_ACTIVE`,
`SESSION_INACTIVE`, `OVER_MAX`, `NETWORK_MISMATCH`, `ASSET_MISMATCH`.
Extensions (documented here because the contract / transport needs them):
`OVER_DAILY` and `ZERO_AMOUNT` (from `TroveAccount.previewDraw`,
which has no §5.1 equivalent), `NO_402` (the resource did not answer
402), `SCHEME_MISMATCH` (only `exact` is supported), `VERIFY_FAILED`
(the facilitator rejected the payment signature), `SETTLE_FAILED`
(the resource still answers 402 after payment).

### Internal helpers (not tools)

`preview_draw`, `governor_status`, and `x402_quote` — the Classic 0.9
governor reads from the previous build — are kept as internal helpers
(used by the tests and the smoke script) but are **not** registered
tools: the server advertises exactly the four plan §5.1 tools.

## Sandbox flag

`sandbox` exists only on `request_session`, default `false` (plan §5.1).
`sandbox: true` requests a small, labelled sandbox session on the
Sternpost team account (Lane B). There is no `sandbox` flag on the other
tools and no mainnet mode without the gate above. Any RPC that reports a
chain id other than the configured one is refused.

## Keys

The server holds no private key in any tool result and accepts none as
input. Two layers:

1. **Transport:** over real MCP stdio the SDK parses args against the
   zod schemas, so unknown/credential fields are dropped by the transport
   and never reach a handler (verified by the stdio transport test in
   `test/transport.test.ts` and by the smoke script).
2. **Handler guard (defence in depth):** a direct handler call still
   rejects any input field named `key`, `apiKey`, `api_key`, `apikey`,
   `privateKey`, `private_key`, `secret`, `password`, `seed`,
   `seedPhrase`, or `mnemonic` — all 11 blocked fields, all covered by
   the test loop in `test/tools.test.ts` ("key never returned").

Every serialized response — success or error — is scanned for the value
of `STERNPOST_API_KEY` (if set) before it leaves the server.

## Pinned deployment (source: `shared/deployments/testnet.json`)

Classic 0.9 (internal helpers only):

- Factory `0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8`
- Governor `0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38`
- Router `0xd6833f811e987f06a1e55a435d4be38c6d4188d4`
- SpendWallet `0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a`
- MUSD `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`
- RPC `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src test (eslint 10.15.0, @eslint/js 10.0.1)
npm run build       # tsc
npm test            # vitest (offline: schemas, real 402 fixture, snapshots, refusal reasons, key-not-in-output, stdio transport)
npm run test:live   # vitest against live testnet; outputs recorded in LIVE_EVIDENCE.md
npm run fork        # anvil fork of testnet + TroveAccount deploy + fork tests + fork smoke (nothing broadcast)
npm run test:fork   # fork tests only, against an already-prepared fork (see test/fork.test.ts)
npm run smoke       # stdio JSON-RPC smoke: initialize, tools/list, all 4 tools (live mode by default; STERNPOST_FORK=1 for fork mode)
```

## Live evidence

See `LIVE_EVIDENCE.md` (real testnet + fork values recorded by this
fix round) and `evidence/` (committed run logs: vitest offline/live/fork
+ smoke). `claude mcp add` is **unreproduced on this box** (no `claude`
binary here); the stdio smoke verification is the in-repo substitute
and is recorded as such.
