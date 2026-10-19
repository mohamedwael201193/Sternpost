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

/**
 * Sternpost deployments, imported from shared/deployments/testnet.json at build time.
 * There is deliberately no hardcoded fallback: a missing file fails the build instead of shipping stale addresses.
 */
import deployments from '../../../shared/deployments/testnet.json'
const d: any = deployments
const at = (v: any): Address | undefined => (typeof v === 'string' ? v : v?.address) as Address | undefined

export const STERNPOST: Deployments = {
  factory: at(d.sternpost.SternpostFactory),
  governor: at(d.sternpost.governor),
  spendWallet: at(d.sternpost.spendWallet),
}

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://sternpost-api.vercel.app'

/** First block worth scanning for Sternpost events (factory deployment). */
export const DEPLOY_BLOCK: bigint = BigInt(d.sternpost.SternpostFactory.block)
