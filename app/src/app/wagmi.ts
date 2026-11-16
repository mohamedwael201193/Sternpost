import { createConfig, http } from 'wagmi'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { mezoMainnet, mezoTestnet } from '../lib/chain'
import { lazyBitcoinConnector } from './btcConnectors'

/** WalletConnect needs a Reown project id. Without one the row is shown as unavailable, never faked. */
export const WC_PROJECT_ID: string | undefined = import.meta.env.VITE_WC_PROJECT_ID || undefined

// EIP-6963 discovery (on by default) adds every installed extension: MetaMask, Rabby, Taho, OKX, Coinbase, Brave…
// Reads use public RPC clients (useAccount hook); writes use wagmi. Mainnet is
// read-only: no mainnet deployment exists yet, so the chain is listed for reads only.
export const wagmiConfig = createConfig({
  chains: [mezoTestnet, mezoMainnet],
  connectors: [
    lazyBitcoinConnector('xverse'),
    lazyBitcoinConnector('unisat'),
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: 'Sternpost', preference: { options: 'all' } }),
    ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true, metadata: { name: 'Sternpost', description: 'Spending governor for Mezo borrowers', url: 'https://sternpost-pink.vercel.app', icons: ['https://sternpost-pink.vercel.app/favicon.svg'] } })] : []),
  ],
  transports: { [mezoTestnet.id]: http(), [mezoMainnet.id]: http() },
})

declare module 'wagmi' {
  interface Register { config: typeof wagmiConfig }
}
