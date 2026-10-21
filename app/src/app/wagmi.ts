import { createConfig, http } from 'wagmi'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { mezoTestnet } from '../lib/chain'

/** WalletConnect needs a Reown project id. Without one the row is shown as unavailable, never faked. */
export const WC_PROJECT_ID: string | undefined = import.meta.env.VITE_WC_PROJECT_ID || undefined

// EIP-6963 discovery (on by default) adds every installed extension: MetaMask, Rabby, Taho, OKX, Coinbase, Brave…
export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: 'Sternpost', preference: { options: 'all' } }),
    ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true, metadata: { name: 'Sternpost', description: 'Spending governor for Mezo borrowers', url: 'https://sternpost-pink.vercel.app', icons: ['https://sternpost-pink.vercel.app/favicon.svg'] } })] : []),
  ],
  transports: { [mezoTestnet.id]: http() },
})

declare module 'wagmi' {
  interface Register { config: typeof wagmiConfig }
}
