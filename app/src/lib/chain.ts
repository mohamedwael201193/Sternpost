import { defineChain, type Address } from 'viem'

export const mezoTestnet = defineChain({
  id: 31611,
  name: 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
  blockExplorers: { default: { name: 'Mezo Explorer', url: 'https://explorer.test.mezo.org' } },
  testnet: true,
})

/** Mezo mainnet (31612), read-only. Lab-documented working RPC; rpc.mezo.org does not resolve (LAB_METHODS.md). */
export const mezoMainnet = defineChain({
  id: 31612,
  name: 'Mezo Mainnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-http.mezo.boar.network'] } },
  blockExplorers: { default: { name: 'Mezo Explorer', url: 'https://explorer.mezo.org' } },
})

/** Mezo protocol contracts on testnet 31611 (verified against live calls in our fork tests). */
export const MEZO = {
  signatures: '0xD757e3646AF370b15f32EB557F0F8380Df7D639e',
  borrowerOperations: '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',
  priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
  troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
  musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  smusd: '0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16',
  // MEZO token. Sources: mezo.org/docs/users/resources/contracts-reference (MEZO token and bridge),
  // explorer.test.mezo.org/token/0x7B7c…0001; verified on rpc.test.mezo.org: symbol MEZO, 18 decimals.
  mezo: '0x7B7c000000000000000000000000000000000001',
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

/** Route adapter (Save / Swap / Loop after a governed draw). */
export const ROUTER: Address | undefined = at(d.sternpost.SternpostRouter)

/** Wave 2 account contracts (task 1.9, deployed 2026-11-15, testnet 31611). */
export type AccountDeployments = {
  implementation?: Address
  factory?: Address
  radar?: Address
  batcher?: Address
}
export const ACCOUNTS: AccountDeployments = {
  implementation: at(d.accounts.implementation),
  factory: at(d.accounts.factory),
  radar: at(d.accounts.radar),
  batcher: at(d.accounts.batcher),
}

/** First block worth scanning for Account events (implementation deployment). */
export const ACCOUNTS_DEPLOY_BLOCK: bigint = BigInt(d.accounts.implementation.block)

/**
 * Every known TroveAccount factory, newest first — read from
 * `shared/deployments/testnet.json` `accounts.factories[]`, the full history
 * array (oldest first in the file; reversed here so the newest factory scans
 * first). A future redeploy appends ONE entry to that array — `factory` /
 * `previous` are NOT the history: `previous` holds only the single last
 * factory, so a second redeploy would overwrite it and orphan every account
 * created through the factory it replaced. fetchOwnAccount scans ALL of
 * them: a redeploy must not orphan existing accounts into a false "no credit
 * account yet". When the array is absent (older deployments file) the reader
 * falls back to `[factory, previous.factory]`.
 */
export type AccountFactoryDeployment = { address: Address; deployBlock: bigint }
const accountFactory = (v: any): AccountFactoryDeployment | null => {
  const address = at(v)
  const block = v?.block
  const blockOk = typeof block === 'number' || (typeof block === 'string' && /^\d+$/.test(block))
  return address && blockOk ? { address, deployBlock: BigInt(block) } : null
}
const factoriesFromArray = (v: any): AccountFactoryDeployment[] | null => {
  if (!Array.isArray(v)) return null
  const out: AccountFactoryDeployment[] = []
  for (const entry of v) {
    const f = accountFactory(entry)
    if (f) out.push(f)
    else console.warn(`[chain] ignoring malformed accounts.factories entry (needs an address and a numeric block): ${JSON.stringify(entry)}`)
  }
  return out
}
export const ACCOUNT_FACTORIES: AccountFactoryDeployment[] = (() => {
  const fromArray = factoriesFromArray((d.accounts as any)?.factories)
  if (fromArray && fromArray.length > 0) return [...fromArray].reverse()
  return [
    accountFactory(d.accounts.factory),
    accountFactory(d.accounts.previous?.factory),
  ].filter((f): f is AccountFactoryDeployment => f !== null)
})()

/**
 * Demo account for read-only demo mode (plan §6.3): `shared/deployments/testnet.json` →
 * `accounts.demo` when it is a deployed account address. It is NOT one yet — the record
 * holds `{status: 'BLOCKED'}` (funding gap, deployer short of the minimum trove) — so the
 * plan's exact fallback applies: the lab TroveAccountV2 with the `LAB PROTOTYPE` badge.
 * Never invent a demo account; never fake its numbers.
 */
export const LAB_DEMO_ACCOUNT = '0x5A1166eC096e12C0C6187695F82B7F4b285389Df' as Address
const demoRaw: unknown = (d.accounts as { demo?: unknown } | undefined)?.demo
export const DEMO_ACCOUNT: Address = typeof demoRaw === 'string' && demoRaw.startsWith('0x') ? (demoRaw as Address) : LAB_DEMO_ACCOUNT
export const DEMO_ACCOUNT_SOURCE: 'production' | 'lab' = DEMO_ACCOUNT === LAB_DEMO_ACCOUNT ? 'lab' : 'production'
export const DEMO_ACCOUNT_BADGE: string | null = DEMO_ACCOUNT_SOURCE === 'lab' ? 'LAB PROTOTYPE' : null

/** First block worth scanning for the lab account's events (deployed shortly before its open at 16790909). */
export const LAB_ACCOUNT_LOGS_FROM_BLOCK = 16790000n

/** Testnet Radar (Shield redeploy 2026-11-16). */
export const RADAR_TESTNET: Address | undefined = ACCOUNTS.radar

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://sternpost-api.vercel.app'

/** First block worth scanning for Sternpost events (factory deployment). */
export const DEPLOY_BLOCK: bigint = BigInt(d.sternpost.SternpostFactory.block)
