// Buys the paid demo brief over x402 v2 with MUSD on Mezo testnet.
// EOA mode:          PAYER_PK=0x... node scripts/pay-brief.mjs [apiUrl]
// Spend-wallet mode: AGENT_PK=0x... SPEND_WALLET=0x... node scripts/pay-brief.mjs [apiUrl]   (EIP-1271 wallet signs via its agent)
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = process.argv[2] ?? "https://sternpost-api.vercel.app";
const chain = defineChain({ id: 31611, name: "Mezo Testnet", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } } });
const pub = createPublicClient({ chain, transport: http() });
const hex = (k) => (k.trim().startsWith("0x") ? k.trim() : "0x" + k.trim());

let signer;
if (process.env.SPEND_WALLET) {
  const agent = privateKeyToAccount(hex(process.env.AGENT_PK));
  signer = { address: process.env.SPEND_WALLET, signTypedData: (a) => agent.signTypedData(a), readContract: (a) => pub.readContract(a) };
} else {
  signer = toClientEvmSigner(privateKeyToAccount(hex(process.env.PAYER_PK)), pub);
}

const url = `${API}/v1/paid/brief`;
const challenge = await (await fetch(url)).json();
const req = challenge.accepts[0];
const extensions = process.env.SPEND_WALLET ? undefined : { extensions: { eip2612GasSponsoring: {} } };
const res = await new ExactEvmScheme(signer).createPaymentPayload(2, req, extensions);
const payload = { x402Version: 2, accepted: req, resource: challenge.resource, ...res };
const paid = await fetch(url, { headers: { "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") } });
console.log(paid.status, await paid.text());
