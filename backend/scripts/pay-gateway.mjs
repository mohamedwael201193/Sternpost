// Pay any x402 gateway route from the Sternpost demo account (GET or POST).
//   AGENT_KEY=0x... node scripts/pay-gateway.mjs <url> <account> [json-body]
//   e.g. node scripts/pay-gateway.mjs http://localhost:8787/v1/risk-report 0x6B88... '{"account":"0x6B88..."}'
// Spend-wallet mode: the agent signs, the TroveAccount pays via EIP-1271.
// The key comes from the environment only and is never printed.
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const [url, account, jsonBody] = process.argv.slice(2);
if (!url || !/^0x[0-9a-fA-F]{40}$/.test(account ?? "")) throw new Error("usage: node scripts/pay-gateway.mjs <url> <account> [json-body]");
const agentKey = (process.env.AGENT_KEY ?? "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error("AGENT_KEY (0x + 64 hex) is required");
const agent = privateKeyToAccount(agentKey);
const chain = defineChain({ id: 31611, name: "Mezo Testnet", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } } });
const pub = createPublicClient({ chain, transport: http() });
const signer = { address: account, signTypedData: (a) => agent.signTypedData(a), readContract: (a) => pub.readContract(a) };

const init = jsonBody
  ? { method: "POST", headers: { "content-type": "application/json" }, body: jsonBody }
  : { method: "GET" };
const challenge = await (await fetch(url, init)).json();
console.log("challenge status: 402 expected; accepts[0].amount =", challenge.accepts?.[0]?.amount);
const req = challenge.accepts[0];
const res = await new ExactEvmScheme(signer).createPaymentPayload(2, req);
const payload = { x402Version: 2, accepted: req, resource: challenge.resource, ...res };
const paid = await fetch(url, { ...init, headers: { ...init.headers, "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") } });
console.log("paid status:", paid.status);
console.log(await paid.text());
