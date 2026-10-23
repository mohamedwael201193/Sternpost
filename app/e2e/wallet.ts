import type { Page } from '@playwright/test'

/**
 * Injects a minimal EIP-1193 wallet at `address` on chain 31611. Read calls are proxied to the
 * public Mezo testnet RPC, so the dashboard reads real chain state. Signing is refused.
 */
export async function injectWallet(page: Page, address: string) {
  await page.addInitScript((addr) => {
    const listeners: Record<string, Function[]> = {}
    const rpc = async (method: string, params: unknown[]) => {
      const r = await fetch('https://rpc.test.mezo.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      const j = await r.json()
      if (j.error) throw j.error
      return j.result
    }
    const provider = {
      isMetaMask: true,
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case 'eth_requestAccounts': case 'eth_accounts': return [addr]
          case 'eth_chainId': return '0x7b7b'
          case 'net_version': return '31611'
          case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null
          case 'wallet_requestPermissions': case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }]
          case 'eth_sendTransaction': case 'eth_signTypedData_v4': case 'personal_sign':
            throw { code: 4001, message: 'User rejected the request.' }
          default: return rpc(method, params as unknown[])
        }
      },
      on: (e: string, f: Function) => { (listeners[e] ||= []).push(f) },
      removeListener: (e: string, f: Function) => { listeners[e] = (listeners[e] || []).filter((x) => x !== f) },
    }
    ;(window as any).ethereum = provider
  }, address)
}
