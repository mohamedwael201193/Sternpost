#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ADDRESSES, CHAIN_ID, loadEnv } from "./config.js";
import {
  createContext,
  handleBalance,
  handleGovernorStatus,
  handlePreviewDraw,
  handleX402Quote,
  toolSchemas,
} from "./tools.js";

/**
 * Sternpost MCP server (plan §2.1).
 * Transport: stdio. Read-only tools over the live 0.9 deployment on Mezo
 * testnet (chain 31611). No sends, no mainnet, no keys in any response.
 *
 * Install for Claude Code:
 *   claude mcp add sternpost -- node /absolute/path/to/mcp/dist/index.js
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
        "MUSD + native BTC balance of an address on Mezo testnet (chain 31611). Read-only.",
      inputSchema: toolSchemas.balance,
    },
    (args) => handleBalance(ctx, args),
  );

  server.registerTool(
    "preview_draw",
    {
      description:
        "Preview a draw against a Sternpost governor: allowed?, on-chain reason code + explanation, ICR after, floor, remaining budget. Read-only, never sends.",
      inputSchema: toolSchemas.preview_draw,
    },
    (args) => handlePreviewDraw(ctx, args),
  );

  server.registerTool(
    "governor_status",
    {
      description:
        "Live governor state: floor/defend ICR, frozen flag, buffer, standby (amount/deadline/nonce/live), ICR, fee. Read-only.",
      inputSchema: toolSchemas.governor_status,
    },
    (args) => handleGovernorStatus(ctx, args),
  );

  server.registerTool(
    "x402_quote",
    {
      description:
        "Quote an x402 v2 payment for a priced Sternpost route: returns the exact 402 challenge (scheme/network/asset/amount/payTo) and, when an app address is given, a live preview of whether that draw can pay it. Quote only — never verifies, settles, or sends.",
      inputSchema: toolSchemas.x402_quote,
    },
    (args) => handleX402Quote(ctx, args),
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `sternpost-mcp 0.1.0 listening on stdio (testnet ${CHAIN_ID}, factory ${ADDRESSES.factory})`,
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
