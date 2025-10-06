// src/wagmi.ts
import { createConfig, http } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { defineChain } from 'viem'

const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143)
const RPC_HTTP = String(import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz')
const RPC_WSS  = String(import.meta.env.VITE_RPC_WSS || 'wss://testnet-rpc.monad.xyz/ws')

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_HTTP], webSocket: [RPC_WSS] } },
  blockExplorers: { default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' } },
  testnet: true,
})

export const config = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(RPC_HTTP),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID!,
      showQrModal: true,
    }),
  ],
})
