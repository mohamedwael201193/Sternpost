#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ADDRESSES, CHAIN_ID, loadEnv, resolveNetwork } from "./config.js";
import {
  createContext,
  fail,
  handleBalance,
  handlePay,
  handleRadar,
  handleRequestSession,
  toolSchemas,
} from "./tools.js";

/**
 * Sternpost MCP server (plan §5.1).
 * Transport: stdio. Exactly the plan's 4 tools: balance, pay,
 * request_session, radar. Testnet by default (chain 31611); mainnet is
 * refused unless STERNPOST_MAINNET_OK=1 and the account is recorded in
 * shared/deployments/mainnet.json. `pay` spends real session budget.
 * No keys in any response: unknown/credential fields are dropped by the
 * transport, direct handler calls are guarded, and every serialized
 * response — success or error — is scanned before it leaves the server.
 *
 * Run directly (fallback one-liner, plan §5.1):
 *   npx tsx mcp/src/index.ts
 * Or build first and run the compiled server:
 *   npm run build && node mcp/dist/index.js
 * Install for Claude Code:
 *   claude mcp add sternpost -- npx -y @sternpost/mcp
 * (publishing to npm is a USER action; until then use the paths above)
 */
export function createServer() {
  const env = loadEnv();
  const ctx = createContext(env);
  const server = new McpServer({
    name: "sternpost",
    version: "0.1.0",
  });

  server.registerTool(
    "balance",
    {
      description:
        "Show the agent's session on its Sternpost trove account: remaining budget, per-tx cap, daily limit, expiry, account health (ICR, floor, Recovery Mode) and MUSD held by the account. Read-only.",
      inputSchema: toolSchemas.balance,
    },
    (args) => handleBalance(ctx, args).catch((e) => fail(e)),
  );

  server.registerTool(
    "pay",
    {
      description:
        "Pay an x402-protected HTTP resource in MUSD by borrowing exactly that amount just in time against the owner's Bitcoin collateral, then fetch the resource. Spends session budget.",
      inputSchema: toolSchemas.pay,
    },
    (args) => handlePay(ctx, args).catch((e) => fail(e)),
  );

  server.registerTool(
    "request_session",
    {
      description:
        "Ask the account owner for a spending session. Generates a local agent key if needed and sends the owner an approval request. Returns a request id and the approval link; poll with balance.",
      inputSchema: toolSchemas.request_session,
    },
    (args) => handleRequestSession(ctx, args).catch((e) => fail(e)),
  );

  server.registerTool(
    "radar",
    {
      description:
        "Redemption Radar for a trove account or any trove address: rank from the redemption frontier, MUSD of debt ahead, ICR, system TCR vs the 150% Recovery Mode line. Network is labelled; testnet ranks are synthetic. Read-only.",
      inputSchema: toolSchemas.radar,
    },
    (args) => handleRadar(ctx, args).catch((e) => fail(e)),
  );

  return server;
}

async function main() {
  const env = loadEnv();
  const network = resolveNetwork(env);
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `sternpost-mcp 0.1.0 listening on stdio (${network} ${network === "mainnet" ? 31612 : CHAIN_ID}, factory ${ADDRESSES.factory})`,
  );
}

import { fileURLToPath } from "node:url";

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
