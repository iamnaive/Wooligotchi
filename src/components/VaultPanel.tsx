'use client';

import { useEffect, useRef, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, writeContract, getPublicClient } from "@wagmi/core";

/** VaultPanel (minimal CTA + inline panel)
 * UI rules:
 * - CTA mode: shows "Send 1 NFT → get 1 life" and one main button "Send NFT to Vault".
 *   If ERC721Enumerable is available, a One-click button is enabled.
 *   If not, a secondary "Open panel" reveals manual inputs (721/1155 by ID).
 * - Full mode: shows the whole panel immediately.
 * Game logic untouched: dispatches "wg:nft-confirmed" on success.
 * Comments in English only.
 */

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const VAULT: Address = (import.meta.env.VITE_VAULT_ADDRESS as Address) ?? zeroAddress;

// Keep original collection address hardcoded to avoid breaking current logic.
// If needed, we can move it to env later.
const ALLOWED_CONTRACT: Address = "0x88c78d5852f45935324c6d100052958f694e8446";

const IFACE_ERC165 = "0x01ffc9a7";
const IFACE_ERC721 = "0x80ac58cd";
const IFACE_ERC1155 = "0xd9b67a26";
const IFACE_ERC721_ENUM = "0x780e9d63";

const ERC165_ABI = [
  { type: "function", name: "supportsInterface", stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ type: "bool" }]},
] as const;

const ERC721_READ_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenOfOwnerByIndex", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }],
    outputs: [{ type: "uint256" }] },
] as const;

const ERC721_WRITE_ABI = [
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable",
    inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
    outputs: [] },
] as const;

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

/* ===== Local lives store (unchanged) ===== */
const LIVES_KEY = "wg_lives_v1";
function getLives(chainId: number, addr?: Address | null) {
  if (!addr) return 0;
  try {
    const raw = localStorage.getItem(LIVES_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw) ?? {};
    return Number(map?.[`${chainId}:${addr.toLowerCase()}`] ?? 0);
  } catch { return 0; }
}
function addLife(chainId: number, addr: Address) {
  try {
    const raw = localStorage.getItem(LIVES_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const k = `${chainId}:${addr.toLowerCase()}`;
    map[k] = Number(map[k] ?? 0) + 1;
    localStorage.setItem(LIVES_KEY, JSON.stringify(map));
  } catch {}
}

type Std = "ERC721" | "ERC1155" | "UNKNOWN";

export default function VaultPanel({ mode = "full" }: { mode?: "full" | "cta" }) {
  return <VaultPanelInner mode={mode} />;
}

function VaultPanelInner({ mode }: { mode: "full" | "cta" }) {
  const { address, isConnected, chainId } = useAccount();
  const cfg = useConfig();
  const pc = getPublicClient(cfg);
  const { switchChain } = useSwitchChain();

  const [std, setStd] = useState<Std>("UNKNOWN");
  const [enumSupported, setEnumSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [tx, setTx] = useState<`0x${string}` | null>(null);
  const [lives, setLives] = useState(() => getLives(MONAD_CHAIN_ID, address));

  // manual inputs
  const [manualId721, setManualId721] = useState<string>("");
  const [manualId1155, setManualId1155] = useState<string>("");

  // scan state
  const [scanFrom, setScanFrom] = useState<string>("0");
  const [scanTo, setScanTo] = useState<string>("10000");
  const cancelRef = useRef<boolean>(false);

  // CTA expand
  const [open, setOpen] = useState(false);

  function append(s: string) { setLog((p) => (p ? p + "\n" : "") + s); }
  const canSend = isConnected && VAULT !== zeroAddress;
  const needsSwitch = isConnected && chainId !== MONAD_CHAIN_ID;

  useEffect(() => {
    (async () => {
      try {
        const [is721, is1155, isEnum] = await Promise.all([
          readContract(cfg, { abi: ERC165_ABI, address: ALLOWED_CONTRACT, functionName: "supportsInterface", args: [IFACE_ERC721 as any], chainId: MONAD_CHAIN_ID }).catch(()=>false),
          readContract(cfg, { abi: ERC165_ABI, address: ALLOWED_CONTRACT, functionName: "supportsInterface", args: [IFACE_ERC1155 as any], chainId: MONAD_CHAIN_ID }).catch(()=>false),
          readContract(cfg, { abi: ERC165_ABI, address: ALLOWED_CONTRACT, functionName: "supportsInterface", args: [IFACE_ERC721_ENUM as any], chainId: MONAD_CHAIN_ID }).catch(()=>false),
        ]);
        if (is721) setStd("ERC721");
        else if (is1155) setStd("ERC1155");
        else setStd("UNKNOWN");
        setEnumSupported(Boolean(is721 && isEnum));
      } catch {
        setStd("UNKNOWN");
        setEnumSupported(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ALLOWED_CONTRACT]);

  useEffect(() => { setLives(getLives(MONAD_CHAIN_ID, address)); }, [address]);

  function onSuccess(addr: Address) {
    window.dispatchEvent(new CustomEvent("wg:nft-confirmed"));
    addLife(MONAD_CHAIN_ID, addr);
    setLives(getLives(MONAD_CHAIN_ID, addr));
  }

  async function waitReceipt(hash: `0x${string}`) {
    try {
      const rcpt = await pc.waitForTransactionReceipt({ hash, confirmations: 0, timeout: 45_000 });
      return rcpt;
    } catch {
      append("⏳ Pending… life will be added once it confirms.");
      return null;
    }
  }

  async function ensureChain() {
    try { if (needsSwitch) await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}
  }

  // One-click via Enumerable
  async function sendEnumerableFirst() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog(""); setTx(null);
    try {
      await ensureChain();
      const tokenId = await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT,
        functionName: "tokenOfOwnerByIndex", args: [address, 0n], chainId: MONAD_CHAIN_ID,
      });
      const { hash } = await writeContract(cfg, {
        abi: ERC721_WRITE_ABI, address: ALLOWED_CONTRACT,
        functionName: "safeTransferFrom",
        args: [address, VAULT, BigInt(tokenId as any)],
        account: address, chainId: MONAD_CHAIN_ID,
      });
      setTx(hash); setBusy(false);
      const rcpt = await waitReceipt(hash);
      if (rcpt && rcpt.status === "success") onSuccess(address);
    } catch (e: any) {
      append(`❌ ${e?.shortMessage || e?.message || String(e)}`); setBusy(false);
    }
  }

  // Manual 721
  async function send721ById() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    const idNum = Number(manualId721);
    if (!Number.isFinite(idNum) || idNum < 0 || idNum > 10000) { append("⚠️ Enter 721 id in 0..10000"); return; }
    setBusy(true); setLog(""); setTx(null);
    try {
      await ensureChain();
      const { hash } = await writeContract(cfg, {
        abi: ERC721_WRITE_ABI, address: ALLOWED_CONTRACT,
        functionName: "safeTransferFrom",
        args: [address, VAULT, BigInt(idNum)],
        account: address, chainId: MONAD_CHAIN_ID,
      });
      setTx(hash); setBusy(false);
      const rcpt = await waitReceipt(hash);
      if (rcpt && rcpt.status === "success") onSuccess(address);
    } catch (e: any) {
      append(`❌ ${e?.shortMessage || e?.message || String(e)}`); setBusy(false);
    }
  }

  // Manual 1155 (1 unit)
  async function send1155ById() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    const idNum = Number(manualId1155);
    if (!Number.isFinite(idNum) || idNum < 0 || idNum > 10000) { append("⚠️ Enter 1155 id in 0..10000"); return; }
    setBusy(true); setLog(""); setTx(null);
    try {
      await ensureChain();
      const bal = await readContract(cfg, {
        abi: ERC1155_ABI, address: ALLOWED_CONTRACT,
        functionName: "balanceOf", args: [address, BigInt(idNum)], chainId: MONAD_CHAIN_ID,
      }) as bigint;
      if ((bal ?? 0n) <= 0n) { append("⚠️ You do not own this 1155 id."); setBusy(false); return; }
      const { hash } = await writeContract(cfg, {
        abi: ERC1155_ABI, address: ALLOWED_CONTRACT,
        functionName: "safeTransferFrom",
        args: [address, VAULT, BigInt(idNum), 1n, "0x"],
        account: address, chainId: MONAD_CHAIN_ID,
      });
      setTx(hash); setBusy(false);
      const rcpt = await waitReceipt(hash);
      if (rcpt && rcpt.status === "success") onSuccess(address);
    } catch (e: any) {
      append(`❌ ${e?.shortMessage || e?.message || String(e)}`); setBusy(false);
    }
  }

  // Bounded scan (non-Enumerable 721)
  async function scanAndSendFirstOwned() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    let from = Math.max(0, Math.floor(Number(scanFrom) || 0));
    let to = Math.min(10000, Math.floor(Number(scanTo) || 0));
    if (to < from) [from, to] = [to, from];

    setBusy(true); setLog(""); setTx(null);
    cancelRef.current = false;
    try {
      await ensureChain();
      const chunk = 20;
      for (let i = from; i <= to; i += chunk) {
        if (cancelRef.current) { append("⛔️ Scan canceled."); setBusy(false); return; }
        const end = Math.min(to, i + chunk - 1);
        for (let id = i; id <= end; id++) {
          try {
            const owner = await readContract(cfg, {
              abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT,
              functionName: "ownerOf", args: [BigInt(id)], chainId: MONAD_CHAIN_ID,
            }) as Address;
            if (owner?.toLowerCase() === address?.toLowerCase()) {
              const { hash } = await writeContract(cfg, {
                abi: ERC721_WRITE_ABI, address: ALLOWED_CONTRACT,
                functionName: "safeTransferFrom",
                args: [address, VAULT, BigInt(id)],
                account: address, chainId: MONAD_CHAIN_ID,
              });
              setTx(hash); setBusy(false);
              const rcpt = await waitReceipt(hash);
              if (rcpt && rcpt.status === "success") onSuccess(address);
              return;
            }
          } catch {}
        }
        append(`… scanned up to #${end}`);
      }
      append("No owned token found in the specified range.");
      setBusy(false);
    } catch (e: any) {
      append(`❌ ${e?.shortMessage || e?.message || String(e)}`); setBusy(false);
    }
  }
  function cancelScan() { cancelRef.current = true; }

  /* ===== RENDER ===== */
  const disabled = !canSend || busy;

  if (mode === "cta") {
    return (
      <div className="text-center select-none">
        <h1 className="text-4xl font-extrabold tracking-tight">
          <span className="opacity-90">Wooli</span><span className="opacity-90">gotchi</span>
        </h1>
        <div className="mt-2 text-sm opacity-80">Send 1 NFT → get 1 life</div>

        <div className="mt-4 flex items-center justify-center gap-8">
          <button
            disabled={disabled || !enumSupported}
            onClick={sendEnumerableFirst}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50 border border-white/10"
          >
            One-click (ERC721Enumerable)
          </button>

          <button
            onClick={() => setOpen((v) => !v)}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10"
          >
            {open ? "Close panel" : "Open panel"}
          </button>
        </div>

        {!enumSupported && (
          <div className="mt-2 text-xs opacity-80">Enumerable not available. Use manual ID or scan.</div>
        )}

        {open && (
          <div className="mx-auto mt-6 max-w-[640px] text-left">
            {renderFullPanel()}
          </div>
        )}
      </div>
    );
  }

  return renderFullPanel();

  function renderFullPanel() {
    return (
      <div className="p-3 rounded-2xl border border-gray-700 bg-black/40 text-sm">
        <div className="mb-2">
          <div className="font-semibold">Send NFT to Vault</div>
          <div className="text-xs opacity-80 break-all font-mono">{ALLOWED_CONTRACT}</div>
          <div className="mt-1 text-xs">Std: <b>{std}</b> {enumSupported === null ? "" : enumSupported ? "(Enumerable ✓)" : "(Enumerable ✗)"}</div>
        </div>

        <div className="mb-3">
          <button disabled={disabled || !enumSupported} onClick={sendEnumerableFirst}
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50">
            One-click send (Enumerable)
          </button>
          {!enumSupported && <div className="mt-1 text-xs opacity-80">Enumerable not available — use manual or scan.</div>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded-xl border border-gray-700">
            <div className="font-medium mb-1">Manual 721</div>
            <div className="flex gap-2">
              <input inputMode="numeric" pattern="[0-9]*" placeholder="id (0..10000)"
                     value={manualId721} onChange={(e)=>setManualId721(e.target.value.replace(/[^0-9]/g,''))}
                     className="px-2 py-1 rounded-md bg-black/30 border border-gray-700 w-full" />
              <button disabled={disabled || std!=="ERC721"} onClick={send721ById}
                      className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-50">
                Send
              </button>
            </div>
          </div>

          <div className="p-2 rounded-xl border border-gray-700">
            <div className="font-medium mb-1">Manual 1155</div>
            <div className="flex gap-2">
              <input inputMode="numeric" pattern="[0-9]*" placeholder="id (0..10000)"
                     value={manualId1155} onChange={(e)=>setManualId1155(e.target.value.replace(/[^0-9]/g,''))}
                     className="px-2 py-1 rounded-md bg-black/30 border border-gray-700 w-full" />
              <button disabled={disabled || std!=="ERC1155"} onClick={send1155ById}
                      className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-50">
                Send
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 p-2 rounded-xl border border-gray-700">
          <div className="font-medium mb-1">Scan (non-Enumerable 721)</div>
          <div className="text-xs opacity-80 mb-1">Checks ownerOf(id) in 0..10000 and sends the first found.</div>
          <div className="flex items-center gap-2">
            <input inputMode="numeric" pattern="[0-9]*" value={scanFrom} onChange={(e)=>setScanFrom(e.target.value.replace(/[^0-9]/g,''))}
                  className="px-2 py-1 rounded-md bg-black/30 border border-gray-700 w-24" placeholder="from" />
            <span>…</span>
            <input inputMode="numeric" pattern="[0-9]*" value={scanTo} onChange={(e)=>setScanTo(e.target.value.replace(/[^0-9]/g,''))}
                  className="px-2 py-1 rounded-md bg-black/30 border border-gray-700 w-24" placeholder="to" />
            <button disabled={disabled || std!=="ERC721"} onClick={scanAndSendFirstOwned}
                    className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-50">
              Scan & Send
            </button>
            <button disabled={!busy} onClick={cancelScan}
                    className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>

        <div className="mt-3 log">
          <div className="mb-1 font-semibold">Log</div>
          <pre>{log || "—"}</pre>
        </div>

        <div className="mt-1 text-sm">Lives: <span className="font-semibold">{lives}</span></div>
        {tx && <div className="mt-1 text-xs break-all">Tx: <span className="font-mono">{tx}</span></div>}
      </div>
    );
  }
}
