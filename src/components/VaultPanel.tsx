// src/components/VaultPanel.tsx
// One-click: Send EXACTLY 1 NFT from the allowed collection to VAULT.
// Direct writeContract (no simulate) + auto network switch + manual fallback.
// Comments in English only.

'use client';

import { useEffect, useState } from "react";
import { zeroAddress } from "viem";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
} from "wagmi";
import {
  getPublicClient,
  readContract,
  writeContract,
} from "@wagmi/core";

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446";
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;

/* ===== ABIs ===== */
// ERC-165
const ERC165_ABI = [
  { type: "function", name: "supportsInterface", stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ type: "bool" }] },
] as const;
const IFACE_ERC721      = "0x80ac58cd";
const IFACE_ERC1155     = "0xd9b67a26";
const IFACE_ERC721_ENUM = "0x780e9d63";

// ERC-721 minimal
const ERC721_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenOfOwnerByIndex", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }],
    outputs: [{ type: "uint256" }] },
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable",
    inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
    outputs: [] },
] as const;

const ERC721_TRANSFER_EVT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to",   type: "address" },
    { indexed: true, name: "tokenId", type: "uint256" },
  ],
} as const;

// ERC-1155 minimal
const ERC1155_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }] },
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "id", type: "uint256" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }
    ],
    outputs: [] },
] as const;

const ERC1155_TRANSFER_SINGLE = {
  type: "event",
  name: "TransferSingle",
  inputs: [
    { indexed: true,  name: "operator", type: "address" },
    { indexed: true,  name: "from",     type: "address" },
    { indexed: true,  name: "to",       type: "address" },
    { indexed: false, name: "id",       type: "uint256" },
    { indexed: false, name: "value",    type: "uint256" },
  ],
} as const;

const ERC1155_TRANSFER_BATCH = {
  type: "event",
  name: "TransferBatch",
  inputs: [
    { indexed: true,  name: "operator", type: "address" },
    { indexed: true,  name: "from",     type: "address" },
    { indexed: true,  name: "to",       type: "address" },
    { indexed: false, name: "ids",      type: "uint256[]" },
    { indexed: false, name: "values",   type: "uint256[]" },
  ],
} as const;

/* ===== Local lives store (inline) ===== */
const LKEY = "wg_lives_v1";
const lKey = (cid:number, addr:string)=>`${cid}:${addr.toLowerCase()}`;
const getLives = (cid:number, addr?:string|null) => {
  if (!addr) return 0;
  const raw = localStorage.getItem(LKEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return map[lKey(cid, addr)] ?? 0;
};
const addLives = (cid:number, addr:string, d=1) => {
  const raw = localStorage.getItem(LKEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  const k = lKey(cid, addr); map[k] = (map[k] ?? 0) + d;
  localStorage.setItem(LKEY, JSON.stringify(map));
  return map[k];
};

/* ===== Component ===== */
type Std = "ERC721" | "ERC1155" | "UNKNOWN";

export default function VaultPanel() {
  const cfg = useConfig();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [std, setStd] = useState<Std>("UNKNOWN");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [lives, setLives] = useState(() => getLives(chainId ?? 0, address));

  // Advanced manual
  const [advanced, setAdvanced] = useState(false);
  const [manualId, setManualId] = useState("");

  function append(s: string) { setLog((p) => (p ? p + "\n" : "") + s); }

  // Detect standard via ERC-165
  useEffect(() => {
    (async () => {
      try {
        setStd("UNKNOWN"); setLog("");
        append("Detecting token standard via ERC-165...");
        const is721 = await readContract(cfg, {
          abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface", args: [IFACE_ERC721 as `0x${string}`],
        });
        if (is721) { setStd("ERC721"); append("✓ Detected ERC-721"); return; }
        const is1155 = await readContract(cfg, {
          abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface", args: [IFACE_ERC1155 as `0x${string}`],
        });
        if (is1155) { setStd("ERC1155"); append("✓ Detected ERC-1155"); return; }
        append("⚠️ Unknown standard; fallback will try both.");
      } catch {
        append("ℹ️ ERC-165 detection failed; fallback enabled.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  async function ensureMonad() {
    if (chainId !== MONAD_CHAIN_ID) {
      await switchChain({ chainId: MONAD_CHAIN_ID });
    }
  }

  const canSend = isConnected && VAULT !== zeroAddress;

  /* ---------- Light auto-pick helpers ---------- */

  async function pickAnyErc721(user: `0x${string}`): Promise<bigint | null> {
    try {
      const enumerable = await readContract(cfg, {
        abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "supportsInterface", args: [IFACE_ERC721_ENUM as `0x${string}`],
      });
      if (enumerable) {
        const bal = (await readContract(cfg, {
          abi: ERC721_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "balanceOf", args: [user],
        })) as bigint;
        if (bal > 0n) {
          const id0 = (await readContract(cfg, {
            abi: ERC721_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "tokenOfOwnerByIndex", args: [user, 0n],
          })) as bigint;
          return id0;
        }
      }
    } catch {}
    try {
      const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
      const latest = await pc.getBlockNumber();
      const from = latest > 80_000n ? latest - 80_000n : 0n;
      const logs = await pc.getLogs({
        address: ALLOWED_CONTRACT as `0x${string}`,
        event: ERC721_TRANSFER_EVT as any,
        args: { to: user },
        fromBlock: from, toBlock: latest,
      });
      for (let i = logs.length - 1; i >= 0; i--) {
        const id = logs[i].args?.tokenId as bigint;
        try {
          const owner = (await readContract(cfg, {
            abi: ERC721_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "ownerOf", args: [id],
          })) as `0x${string}`;
          if (owner.toLowerCase() === user.toLowerCase()) return id;
        } catch {}
      }
    } catch {}
    return null;
  }

  async function pickAnyErc1155(user: `0x${string}`): Promise<bigint | null> {
    try {
      const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
      const latest = await pc.getBlockNumber();
      const from = latest > 80_000n ? latest - 80_000n : 0n;

      const logsSingle = await pc.getLogs({
        address: ALLOWED_CONTRACT as `0x${string}`,
        event: ERC1155_TRANSFER_SINGLE as any,
        args: { to: user },
        fromBlock: from, toBlock: latest,
      });
      for (let i = logsSingle.length - 1; i >= 0; i--) {
        const id = logsSingle[i].args?.id as bigint;
        const bal = (await readContract(cfg, {
          abi: ERC1155_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "balanceOf", args: [user, id],
        })) as bigint;
        if (bal > 0n) return id;
      }

      const logsBatch = await pc.getLogs({
        address: ALLOWED_CONTRACT as `0x${string}`,
        event: ERC1155_TRANSFER_BATCH as any,
        args: { to: user },
        fromBlock: from, toBlock: latest,
      });
      for (let i = logsBatch.length - 1; i >= 0; i--) {
        const ids = logsBatch[i].args?.ids as bigint[];
        for (let j = ids.length - 1; j >= 0; j--) {
          const id = ids[j];
          const bal = (await readContract(cfg, {
            abi: ERC1155_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "balanceOf", args: [user, id],
          })) as bigint;
          if (bal > 0n) return id;
        }
      }
    } catch {}
    return null;
  }

  /* ---------- Main actions (direct write) ---------- */

  async function sendOne() {
    if (!canSend || !address) return;
    setBusy(true); setLog("");

    try {
      if (VAULT === zeroAddress) {
        append("VAULT not set (VITE_VAULT_ADDRESS).");
        setBusy(false); return;
      }

      await ensureMonad();

      // Try ERC-721 first (or UNKNOWN)
      if (std === "ERC721" || std === "UNKNOWN") {
        const id = await pickAnyErc721(address as `0x${string}`);
        if (id !== null) {
          append(`Sending ERC-721 #${id} → VAULT...`);
          const tx = await writeContract(cfg, {
            abi: ERC721_ABI,
            address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "safeTransferFrom",
            args: [address, VAULT as `0x${string}`, id],
            account: address,
            chainId: MONAD_CHAIN_ID,
          });
          append(`✅ Tx sent: ${tx}`);
          const total = addLives(MONAD_CHAIN_ID, address, 1); setLives(total);
          append(`+1 life (total: ${total})`);
          setBusy(false); return;
        }
        if (std === "ERC721") append("No ERC-721 found in small window.");
      }

      // Try ERC-1155
      const id1155 = await pickAnyErc1155(address as `0x${string}`);
      if (id1155 !== null) {
        append(`Sending ERC-1155 id=${id1155} x1 → VAULT...`);
        const tx2 = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id1155, 1n, "0x"],
          account: address,
          chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Tx sent: ${tx2}`);
        const total2 = addLives(MONAD_CHAIN_ID, address, 1); setLives(total2);
        append(`+1 life (total: ${total2})`);
        setBusy(false); return;
      }

      append("❌ Auto-pick failed. Use Advanced → Send by ID.");
    } catch (e: any) {
      console.error(e);
      const m = e?.shortMessage || e?.message || "write failed";
      if (/user rejected/i.test(m)) append("❌ Rejected in wallet.");
      else if (/insufficient funds/i.test(m)) append("❌ Not enough MON for gas.");
      else if (/chain/i.test(m)) append("❌ Wrong chain; click 'Switch to Monad'.");
      else append(`❌ ${m}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendManual() {
    if (!address || !manualId) return;
    try {
      await ensureMonad();
      const id = BigInt(manualId);

      if (std === "ERC1155") {
        const tx = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id, 1n, "0x"],
          account: address,
          chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Sent 1155 id=${id}: ${tx}`);
      } else {
        const tx = await writeContract(cfg, {
          abi: ERC721_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id],
          account: address,
          chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Sent 721 #${id}: ${tx}`);
      }

      const total = addLives(MONAD_CHAIN_ID, address, 1); setLives(total);
      append(`+1 life (total: ${total})`);
    } catch (e:any) {
      console.error(e);
      append(`❌ ${e?.shortMessage || e?.message || "manual write failed"}`);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-2 text-sm text-zinc-400">
        Vault: <span className="font-mono">{VAULT}</span>
      </div>
      <div className="mb-2 text-sm text-zinc-400">
        Allowed: <span className="font-mono">{ALLOWED_CONTRACT}</span>
      </div>
      <div className="mb-3 text-sm">
        Network: {chainId}{" "}
        {chainId !== MONAD_CHAIN_ID && (
          <button
            className="ml-2 rounded border border-zinc-700 px-2 py-1 text-xs"
            onClick={ensureMonad}
          >
            Switch to Monad
          </button>
        )}
      </div>

      <div className="mb-3 text-lg font-semibold">Send 1 NFT to Vault → get 1 life</div>

      <button
        className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
        disabled={!canSend || busy}
        onClick={sendOne}
      >
        {busy ? "Sending…" : "Send 1 NFT to Vault"}
      </button>

      <div className="mt-3">
        <button
          className="text-xs underline text-zinc-400"
          onClick={() => setAdvanced(v => !v)}
        >
          {advanced ? "Hide" : "Advanced"} (manual id)
        </button>
        {advanced && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm"
              placeholder="tokenId / id"
              value={manualId}
              onChange={(e)=>setManualId(e.target.value)}
            />
            <button
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
              onClick={sendManual}
              disabled={!canSend || !manualId}
            >
              Send by ID
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
        <div className="mb-1 font-medium">Log</div>
        <pre className="whitespace-pre-wrap break-all">{log || "—"}</pre>
      </div>

      <div className="mt-1 text-sm">
        Lives: <span className="font-semibold">{lives}</span>
      </div>
    </div>
  );
}
