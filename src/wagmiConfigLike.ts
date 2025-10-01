// src/wagmiConfigLike.ts
// Standalone config for viem/wagmi core actions. Comments in English only.

import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL  = String(import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz");

export const MONAD = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const wagmiConfigLike = createConfig({
  chains: [MONAD],
  transports: { [MONAD.id]: http(RPC_URL) },
  ssr: false,
});
