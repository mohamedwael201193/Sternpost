// LOCAL-ONLY dev server for the x402 gateway (task 2.3 live verification).
// Serves the real app with a PGlite in-memory DB, the real testnet chain
// reader and the real facilitator — no production backend is deployed yet.
//   X402_PAY_TO=0x... npx tsx scripts/serve-gateway-local.ts [port]
// X402_PAY_TO is required (interim: the deployer address). No key is read
// or printed by this script.
import { serve } from "@hono/node-server";
import { createPublicClient, http, defineChain } from "viem";
import { memDb, MUSD } from "../test/helpers.js";
import { createApp } from "../src/app.js";
import { createGatewayChainReader } from "../src/gateway/chain.js";

const PORT = Number(process.argv[2] ?? 8787);
const payTo = process.env.X402_PAY_TO;
if (!/^0x[0-9a-fA-F]{40}$/.test(payTo ?? "")) throw new Error("X402_PAY_TO (0x...) is required");

const chain = defineChain({ id: 31611, name: "Mezo", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } } });
const client = createPublicClient({ chain, transport: http("https://rpc.test.mezo.org", { batch: true, timeout: 30_000 }) });
const db = await memDb();
const basePay = {
  facilitatorUrl: "https://facilitator.vativ.io",
  network: "eip155:31611",
  asset: MUSD as `0x${string}`,
  payTo: payTo as `0x${string}`,
  confirmTx: async (hash: `0x${string}`) => (await client.waitForTransactionReceipt({ hash, timeout: 30_000 })).status === "success",
};
const app = createApp({
  db,
  corsOrigins: ["http://localhost:5173"],
  rateLimitPerMin: 1000,
  snapshot: async () => ({ blockNumber: await client.getBlockNumber() }),
  pay: { ...basePay, amount: "10000000000000000" },
  gateway: {
    pay: basePay,
    amounts: { radar: "1000000000000000", previewDraw: "1000000000000000", riskReport: "10000000000000000" },
    reader: createGatewayChainReader(client as any, {
      radar: "0xfe74C8e67f0499e4426DD71D6bdf48A9A557DC6C",
      troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
      priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
    }),
  },
});
serve({ fetch: app.fetch, port: PORT }, (i) => console.log(`gateway-local listening on ${i.port}`));
