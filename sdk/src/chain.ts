import { defineChain, type Chain } from "viem";

export const mezoTestnet: Chain = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
});

/** Addresses on Mezo testnet (31611). Mezo contracts are official; Sternpost's are ours. */
export const testnetAddresses = {
  factory: "0x29bf11Cd948CE845687A21819b2844d5321432Cf",
  signatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  smusd: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

export const explorerTx = (hash: string) => `https://explorer.test.mezo.org/tx/${hash}`;
