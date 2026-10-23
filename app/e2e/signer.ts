import type { Page } from '@playwright/test'
import { createWalletClient, defineChain, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
const mezoTestnet = defineChain({ id: 31611, name: 'Mezo Testnet', nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } } })

/**
 * Like injectWallet, but signs for real. The private key stays in the Node test process (MEZO_TESTNET_PK);
 * the page only ever sees signatures and tx hashes through an exposed function.
 * `delayWithdrawMs` simulates a user who takes a while on the first withdraw signature prompt.
 */
export async function injectSigningWallet(page: Page, opts: { delayWithdrawMs?: number; log?: string[] } = {}) {
  const pk = process.env.MEZO_TESTNET_PK!
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as Hex)
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http('https://rpc.test.mezo.org') })
  let withdrawDelayed = 0 // only the first withdraw prompt is slow
  await page.exposeFunction('__sternpostSign', async (method: string, params: any[]) => {
    if (method === 'eth_signTypedData_v4') {
      const td = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]
      const { EIP712Domain: _d, ...types } = td.types
      if (td.primaryType === 'WithdrawMUSD' && opts.delayWithdrawMs && !withdrawDelayed++) await new Promise((r) => setTimeout(r, opts.delayWithdrawMs))
      opts.log?.push(`sign ${td.primaryType} deadline=${td.message.deadline}`)
      return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message })
    }
    if (method === 'eth_sendTransaction') {
      const t = params[0]
      const hash = await wallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined, gas: t.gas ? BigInt(t.gas) : undefined })
      opts.log?.push(`tx ${hash}`)
      return hash
    }
    throw new Error(`unsupported ${method}`)
  })
  await page.addInitScript((addr) => {
    const rpc = async (method: string, params: unknown[]) => {
      const r = await fetch('https://rpc.test.mezo.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      const j = await r.json(); if (j.error) throw j.error; return j.result
    }
    ;(window as any).ethereum = {
      isMetaMask: true,
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case 'eth_requestAccounts': case 'eth_accounts': return [addr]
          case 'eth_chainId': return '0x7b7b'
          case 'net_version': return '31611'
          case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null
          case 'wallet_requestPermissions': case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }]
          case 'eth_signTypedData_v4': case 'eth_sendTransaction': return (window as any).__sternpostSign(method, params)
          default: return rpc(method, params as unknown[])
        }
      },
      on: () => {}, removeListener: () => {},
    }
  }, account.address)
  return account.address
}
