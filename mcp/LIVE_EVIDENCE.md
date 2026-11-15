# MCP live evidence (plan §2.1)

Recorded 2026-11-15 ~19:20 EET by `npm run smoke` (stdio JSON-RPC against the
built server) and `npm run test:live` (vitest, `STERNPOST_LIVE_TESTS=1`).
RPC: `https://rpc.test.mezo.org`, chain 31611, 0.9 deployment.

## Test runs

- `npm test` (offline): 12/12 pass — schema, 402 fixture, refusal reasons,
  key-not-in-output snapshot.
- `npm run test:live`: 7/7 pass — every tool returns a real on-chain read.
- `npm run smoke`: PASSED — initialize ok, `tools/list` returned exactly the
  4 tools, all 4 called live.
- `npm run typecheck`: pass. `npm run lint`: pass. `npm run build`: pass.

## `balance` — borrower `0xf76e…71a3`

- MUSD: `4122.607536326` (wei `4122607536326000000000`), symbol `MUSD`
- BTC: `0.013361428281097685`
- chainId `31611`, network `Mezo testnet`

## `governor_status` — governor `0x1bF4…71F38`

- floorICR `2.5`, defendICR `1.6`, frozen `false`
- buffer `30` MUSD, standby `30` MUSD, deadline `1797331299`
  (`2026-12-15T10:41:39Z`), nonce `45`, live `true`
- ICR `2.380450065257390321`, feeBps `10`,
  feeRecipient = borrower `0xf76e…71a3`
- `factoryRecognised: true`, borrower `0xf76e…71a3`
- Matches `shared/deployments/testnet.json` `classicRedeploy.finalState`.

## `preview_draw` — app `0x0508…2D1E`, 10 MUSD, payee = spend wallet

- `allowed: false`, `reason: "APP_NOT_AUTHORIZED"`,
  explanation: "This app has no credit line from you."
- `icrAfter: 2.370754426314248947`, floor `2.5`,
  `remainingBudget: 0` MUSD
- Honest finding, not a server bug: the Wave-1 app `0x0508…` was authorized
  on the superseded Wave-1 governor, not on the 0.9 governor. A draw through
  the 0.9 governor needs a fresh `authorizeApp` on it first (not this
  task's scope — this server is read-only and never sends it).
- Oversized draw (1,000,000 MUSD) is likewise refused with a real reason
  code (covered by the live test).

## `x402_quote` — route `radar`

- Challenge: x402 v2, `payment_required`, scheme `exact`,
  network `eip155:31611`, asset MUSD `0x1189…c503`,
  amount `10000000000000000` (0.01 MUSD), payTo interim deployer
  `0xf76e…71a3`, `maxTimeoutSeconds: 300`,
  extra `{ name: "Mezo USD", version: "1", assetTransferMethod: "permit2" }`
- `payable` (live preview for the same app/payee): `allowed: false`,
  `APP_NOT_AUTHORIZED` — same finding as above.
- Quote only: no verify, settle, or send.

## Spend wallet (bonus read, not a tool) — `0x4F87…9Ee4a`

- owner = borrower `0xf76e…71a3`, agent `0x62a4…c1d9`,
  `agentExpiry: 1797330675` — matches the deployment record.

## `claude mcp add` verification (Claude Code 2.1.325, installed scratch to /tmp/claude-cli)

- `claude mcp add sternpost -- node /home/hatch/workspace/mezo-wave2/work/mcp-21/mcp/dist/index.js`
  → exit 0: "Added stdio MCP server sternpost … to local config", and
  `claude mcp list` shows `sternpost: … - ✔ Connected` (Claude Code's own
  health check connected to the server over stdio).
- `balance` runs: verified over the MCP protocol by `npm run smoke`
  (initialize → tools/list → tools/call balance, live testnet read above).
  An interactive `claude -p` invocation was NOT run: the CLI reports
  "Not logged in · Please run /login", and login must be done by the user
  on his own device — not attempted here.
- The registration is left in place (local scope, this project dir) so the
  parent can re-verify; remove with `claude mcp remove sternpost -s local`.

## Full raw outputs

See `/tmp/mcp-smoke.log` (smoke run) and `/tmp/mcp-all.log` (vitest run)
on the build machine; the values above are copied verbatim from them.
