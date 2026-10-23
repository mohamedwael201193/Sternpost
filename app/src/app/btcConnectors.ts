import { createConnector } from 'wagmi'
import { mezoTestnet } from '../lib/chain'

/**
 * Mezo Passport's Bitcoin connectors (OrangeKit: Xverse, Unisat), loaded only when someone picks one.
 * OrangeKit uses nothing from wagmi but createConnector, whose contract is unchanged in wagmi 3.
 * The connected address is the wallet's Mezo smart account, which can send transactions but not sign EIP-712.
 */
type Id = 'xverse' | 'unisat'
const META: Record<Id, { name: string; icon: string }> = {
  xverse: { name: 'Xverse', icon: '/wallets/xverse.webp' },
  unisat: { name: 'Unisat', icon: '/wallets/unisat.webp' },
}
const btc = { rpcUrl: mezoTestnet.rpcUrls.default.http[0], chainId: mezoTestnet.id }

async function load(id: Id) {
  // OrangeKit's Bitcoin helpers expect Node's Buffer and process globals.
  const g = globalThis as { Buffer?: unknown; process?: unknown }
  if (!g.Buffer) g.Buffer = (await import('buffer')).Buffer
  g.process ??= { env: {}, browser: true, version: '', versions: {}, nextTick: (f: () => void) => queueMicrotask(f) }
  if (id === 'xverse') return (await import('@mezo-org/orangekit/dist/src/wallet/xverse/connector')).default(btc)()
  return (await import('@mezo-org/orangekit/dist/src/wallet/unisat/connector')).getOrangeKitUnisatConnector(btc)()
}

export function lazyBitcoinConnector(id: Id) {
  return createConnector((config) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inner: Promise<any> | undefined
    const get = () => (inner ??= load(id).then((fn) => fn(config)).then(async (c) => { await c.setup?.(); return c }))
    const recent = () => { try { return localStorage.getItem('wagmi.recentConnectorId')?.includes(`orangekit-${id}`) ?? false } catch { return false } }
    return {
      id: `orangekit-${id}`, name: META[id].name, icon: META[id].icon, type: 'orangekit',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async connect(p?: any) { return (await get()).connect(p) },
      async disconnect() { if (inner) await (await get()).disconnect() },
      async getAccounts() { return (await get()).getAccounts() },
      async getChainId() { return inner ? (await get()).getChainId() : mezoTestnet.id },
      // reconnect() probes every connector's provider; stay unloaded unless this wallet was used last.
      async getProvider() { if (!inner && !recent()) throw new Error('not loaded'); return (await get()).getProvider() },
      async isAuthorized() { return recent() ? (await get()).isAuthorized() : false },
      async switchChain(p: { chainId: number }) { return (await get()).switchChain(p) },
      onAccountsChanged(a: string[]) { inner?.then((c) => c.onAccountsChanged(a)) },
      onChainChanged(c: string) { inner?.then((x) => x.onChainChanged(c)) },
      onDisconnect(e?: Error) { inner?.then((x) => x.onDisconnect(e)) },
      async getBitcoinAddress(): Promise<string> { return (await get()).getBitcoinAddress() },
    }
  })
}
