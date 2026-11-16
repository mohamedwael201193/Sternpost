/**
 * Pay an x402 resource by borrowing just in time (Wave 2 accounts, Mezo testnet).
 *   STERNPOST_ACCOUNT=0x... STERNPOST_AGENT_KEY=0x... npx tsx examples/pay-by-borrow-testnet.ts [url]
 * The account must already be open with an agent session (canSignX402) and a
 * Permit2 approval — see README.md "Live proof" for the full setup. The agent
 * key is read from the environment only and never printed.
 * Default URL is the live outside service demo.vativ.io (0.001 MUSD).
 */
import fs from "node:fs";
import { formatEther, type Address, type Hex } from "viem";
import { createAccountClient } from "../src/index.js";

const account = process.env.STERNPOST_ACCOUNT as Address | undefined;
const agentKey = (process.env.STERNPOST_AGENT_KEY ?? "").trim() as Hex;
if (!account) throw new Error("STERNPOST_ACCOUNT not set (the TroveAccount clone address)");
if (!agentKey) throw new Error("STERNPOST_AGENT_KEY not set");
const url = process.argv[2] ?? "https://demo.vativ.io/";

const client = createAccountClient({ network: "testnet", account, agentKey });
const health = await client.read();
console.log("account", account, "ICR", formatEther(health.icr), "MUSD", formatEther(health.balances.musd), "status", health.troveStatus);

const r = await client.payByBorrow(url);
console.log("payByBorrow:", JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
if (r.status !== "paid") throw new Error(`not paid: ${r.status} ${r.reason}`);
if (r.refillTx) console.log("refill draw:", `https://explorer.test.mezo.org/tx/${r.refillTx}`);
if (r.settleTx) console.log("settle:", `https://explorer.test.mezo.org/tx/${r.settleTx}`);
fs.writeFileSync(process.env.PAY_OUT ?? "pay-by-borrow-testnet.json", JSON.stringify({ account, url, result: r }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log("done");
