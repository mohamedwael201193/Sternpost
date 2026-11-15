# @sternpost/mcp — Sternpost MCP server (plan §2.1)

Read-only MCP server over the **live 0.9 deployment on Mezo testnet (chain 31611)**.
Transport: stdio. No sends, no mainnet, no keys in any response.

## Install (Claude Code)

```sh
claude mcp add sternpost -- node /absolute/path/to/mcp/dist/index.js
claude mcp list   # sternpost: node /absolute/path/to/mcp/dist/index.js
```

Build first: `npm ci && npm run build`. The server needs no credentials and
reads no secrets; optional env:

| Var | Default | Notes |
| --- | --- | --- |
| `STERNPOST_RPC_URL` | `https://rpc.test.mezo.org` | Must report chain 31611 or the server refuses every call |
| `X402_PAY_TO` | interim deployer `0xf76e…71a3` | x402 payee; zero/burn rejected |
| `X402_PRICE` | `10000000000000000` (0.01 MUSD) | Per-route price until task 2.3 sets per-route prices |

## Tools (4)

| Tool | Input | Returns (live `eth_call`, never mocked) |
| --- | --- | --- |
| `balance` | `address`, `sandbox?` | MUSD balance (+ symbol/decimals) and native BTC balance, chain 31611, explorer link |
| `preview_draw` | `app`, `amountMusd`, `payee`, `governor?`, `sandbox?` | `Governor.previewDraw` verdict: `allowed`, on-chain `reason` + human explanation, `icrAfter`, floor ICR, remaining budget |
| `governor_status` | `governor?`, `sandbox?` | floor/defend ICR, `frozen`, buffer, standby (amount/deadline/nonce/live), live ICR, feeBps, fee recipient, borrower, factory-recognised flag |
| `x402_quote` | `route` (`radar`\|`brief`\|`muster`), `app?`, `payee?`, `sandbox?` | Exact x402 v2 `402` challenge (same shape as `backend/src/x402/paywall.ts`); with `app`, a live `previewDraw` payable verdict. Quote only — never verifies, settles, or sends |

## Sandbox flag

Every tool takes `sandbox` (default `true`). `sandbox: false` is **refused**
with reason `SANDBOX_REQUIRED` — there is no mainnet mode. Any RPC that
reports a chain id other than 31611 is refused the same way.

## Keys

The server holds no private key and accepts none. Any input field named
`key`, `apiKey`, `privateKey`, `secret`, `password`, `seed`, or `mnemonic`
is rejected before any chain call, and every serialized response is scanned
for the value of `STERNPOST_API_KEY` (if set) before it leaves the server.
See `test/tools.test.ts` ("key never returned").

## Pinned deployment (source: `shared/deployments/testnet.json`)

- Factory `0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8`
- Governor `0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38`
- Router `0xd6833f811e987f06a1e55a435d4be38c6d4188d4`
- SpendWallet `0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a`
- MUSD `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`
- RPC `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`

## Checks

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src test
npm run build       # tsc
npm test            # vitest (offline: schema, 402 fixture, refusal reasons, key-not-in-output)
npm run test:live   # vitest against live testnet; outputs recorded in LIVE_EVIDENCE.md
npm run smoke       # stdio JSON-RPC smoke: initialize, tools/list, all 4 tools live
```

## Live evidence

See `LIVE_EVIDENCE.md` (real testnet reads recorded at build time).
