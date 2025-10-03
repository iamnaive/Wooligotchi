'use client';

import { createConfig, http, webSocket } from 'wagmi';
import { createPublicClient, fallback } from 'viem';

/**
 * We switch to WS-first transport to avoid HTTP polling storms.
 * HTTP remains as a gentle fallback (no batching, minimal retries).
 *
 * Required env:
 *  - VITE_CHAIN_ID=10143
 *  - VITE_RPC_URL=https://monad-testnet.blockvision.org/v1/<YOUR_KEY>
 *  - VITE_RPC_WSS=wss://monad-testnet.blockvision.org/v1/<YOUR_KEY>
 */

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_HTTP = String(import.meta.env.VITE_RPC_URL || '');
const RPC_WSS  = String(import.meta.env.VITE_RPC_WSS || ''); // <-- add this on Vercel!

// Minimal Monad Testnet chain object
const MONAD_TESTNET = {
  id: CHAIN_ID,
  name: 'Monad Testnet',
  network: 'monad-testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_HTTP], webSocket: [RPC_WSS] as any },
    public:  { http: [RPC_HTTP], webSocket: [RPC_WSS] as any },
  },
  contracts: {}, // no multicall here
} as const;

// WS first, HTTP fallback — both without batching & with gentle retrying
const wsTransport  = RPC_WSS
  ? webSocket(RPC_WSS, { retryCount: 1, timeout: 20_000 })
  : null;

const httpTransport = http(RPC_HTTP, {
  batch: false,
  retryCount: 1,
  timeout: 20_000,
});

// If WS exists, prefer it; otherwise just HTTP
const transport = wsTransport
  ? fallback([wsTransport, httpTransport])
  : httpTransport;

/**
 * Notes:
 * - pollingInterval kept high (or effectively unused with WS).
 * - batch.multicall disabled.
 * - cacheTime / gcTime a bit longer, reducing re-reads.
 * - multiInjectedProviderDiscovery off to avoid extra noise from other wallets.
 */
export const wagmiConfig = createConfig({
  chains: [MONAD_TESTNET as any],
  transports: { [MONAD_TESTNET.id]: transport },
  ssr: false,
  multiInjectedProviderDiscovery: false,
  pollingInterval: 20_000, // ws will handle updates; http fallback polls rarely
  // @ts-expect-error viem accepts these at runtime
  client: ({ chain }) =>
    createPublicClient({
      chain: chain as any,
      transport,
      cacheTime: 60_000,
      batch: { multicall: false },
      pollingInterval: 20_000,
    }),
});

export default wagmiConfig;
