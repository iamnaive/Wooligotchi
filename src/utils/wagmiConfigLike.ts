'use client';

import { createConfig, http } from 'wagmi';
import { createPublicClient, fallback } from 'viem';
import { mainnet } from 'viem/chains'; // not used, but keeps types happy

// Minimal custom Monad Testnet chain
const MONAD_TESTNET = {
  id: Number(import.meta.env.VITE_CHAIN_ID ?? 10143),
  name: 'Monad Testnet',
  network: 'monad-testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [String(import.meta.env.VITE_RPC_URL || '')] },
    public:  { http: [String(import.meta.env.VITE_RPC_URL || '')] },
  },
  // No multicall on this chain (avoid viem multicall attempts)
  contracts: {},
} as const;

// Use BlockVision RPC (key-in-URL) with gentle settings
const RPC_URL = String(import.meta.env.VITE_RPC_URL || '');
const transport = fallback([
  http(RPC_URL, {
    batch: false,            // do not batch -> some testnets throttle batched calls
    retryCount: 1,           // fewer automatic retries
    timeout: 20_000,         // shorter timeouts
    // headers: {}            // not needed for key-in-URL
  }),
]);

/**
 * Lower polling + small caches help avoid 429s on limited RPCs.
 * - pollingInterval: how often viem polls block/tx receipt (ms)
 * - gcTime: cache lifetime (ms)
 */
export const wagmiConfig = createConfig({
  chains: [MONAD_TESTNET as any],
  transports: { [MONAD_TESTNET.id]: transport },
  ssr: false,
  multiInjectedProviderDiscovery: false,
  pollingInterval: 12_000, // 12s (default ~4s) — сильно меньше нагрузки
  // @ts-expect-error viem publicClient options exist at runtime
  client: ({ chain }) =>
    createPublicClient({
      chain: chain as any,
      transport,
      cacheTime: 30_000,     // cache results for 30s
      batch: { multicall: false }, // never try multicall on this chain
      pollingInterval: 12_000,
    }),
});

export default wagmiConfig;
