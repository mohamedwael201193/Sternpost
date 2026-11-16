import { defineChain, type Chain } from "viem";

/** Canonical Multicall3, deployed on Mezo testnet + mainnet. */
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const mezoTestnet: Chain = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
});

export const mezoMainnet: Chain = defineChain({
  id: 31612,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-http.mezo.boar.network"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.mezo.org" } },
});

/** Addresses on Mezo testnet (31611). Mezo contracts are official; Sternpost's are ours. */
export const testnetAddresses = {
  factory: "0x39779A8678424CF78c841F9AfEa1EAFF3Cf7F6d8",
  signatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  smusd: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  /** TroveAccount system, Shield redeploy 2026-11-16 (shared/deployments/testnet.json `accounts`). */
  accountFactory: "0x46442898c022e1fAa2BD05a23600C1Ec89DcA200",
  accountImplementation: "0x02Dda72b052fe7b28214C09743d6Ed0DE813F0B8",
  accountRadar: "0xfe74C8e67f0499e4426DD71D6bdf48A9A557DC6C",
  accountBatcher: "0x427D3B9ee181f8658698c1c6c0F8075d003406F8",
  /** Mezo SortedTroves + HintHelpers + BorrowerOperations.
   * SortedTroves: read from the implementation's sortedTroves() view.
   * HintHelpers: the Mezo-documented testnet address (IHintHelpers.sol),
   * verified live via computeNominalCR. BorrowerOperations: testnet.json. */
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
} as const;

export const explorerTx = (hash: string) => `https://explorer.test.mezo.org/tx/${hash}`;
