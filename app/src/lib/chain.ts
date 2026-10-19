import { defineChain, type Address } from 'viem'

export const mezoTestnet = defineChain({
  id: 31611,
  name: 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
  blockExplorers: { default: { name: 'Mezo Explorer', url: 'https://explorer.test.mezo.org' } },
  testnet: true,
})

/** Mezo protocol contracts on testnet 31611 (verified against live calls in our fork tests). */
export const MEZO = {
  signatures: '0xD757e3646AF370b15f32EB557F0F8380Df7D639e',
  borrowerOperations: '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',
  priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
  troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
  musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  smusd: '0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16',
} as const satisfies Record<string, Address>

type Deployments = { factory?: Address; governor?: Address; spendWallet?: Address }

/** Sternpost deployments: shared/deployments/testnet.json at build time, overridable by env. */
const files = import.meta.glob('../../../shared/deployments/testnet.json', { eager: true, import: 'default' }) as Record<string, any>
const fromFile: any = Object.values(files)[0] ?? {}
const at = (v: any) => (typeof v === 'string' ? v : v?.address)
const pick = (...k: string[]) => k.map((x) => at(fromFile.sternpost?.[x] ?? fromFile[x] ?? fromFile.contracts?.[x])).find(Boolean)

export const STERNPOST: Deployments = {
  factory: (import.meta.env.VITE_FACTORY as Address) || pick('SternpostFactory', 'factory') || '0x29bf11Cd948CE845687A21819b2844d5321432Cf',
  governor: (import.meta.env.VITE_GOVERNOR as Address) || pick('SternpostGovernor', 'governor'),
  spendWallet: (import.meta.env.VITE_SPEND_WALLET as Address) || pick('SpendWallet', 'spendWallet'),
}

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://sternpost-api.vercel.app'

/** First block worth scanning for Sternpost events (factory deployment). */
export const DEPLOY_BLOCK: bigint = BigInt(fromFile.sternpost?.SternpostFactory?.block ?? import.meta.env.VITE_DEPLOY_BLOCK ?? 16309865)
