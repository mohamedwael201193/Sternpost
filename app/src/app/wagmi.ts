import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { mezoTestnet } from '../lib/chain'

export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [mezoTestnet.id]: http() },
})

declare module 'wagmi' {
  interface Register { config: typeof wagmiConfig }
}
