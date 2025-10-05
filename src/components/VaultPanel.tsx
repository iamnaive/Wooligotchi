import React, { useMemo, useState } from "react";
import { emit } from "../utils/domEvents";

function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
  return null;
}

export default function VaultPanel({ mode = "full" }: { mode?: "full" | "cta" }) {
  const [rawId, setRawId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeTokenId(rawId), [rawId]);
  const canSend = !!normalized && !busy;

  async function simulateTx(_tokenId: string) {
    // TODO: replace with wagmi approve+deposit flow
    await new Promise((r) => setTimeout(r, 1000));
  }

  const onSend = async () => {
    if (!normalized) { setErr("Enter a valid tokenId"); return; }
    setBusy(true); setErr(null);
    try {
      await simulateTx(normalized);
      setOk(true);
      emit("wg:nft-confirmed", { tokenId: normalized });
    } catch (e: any) {
      setErr(e?.message || "Transaction failed");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "cta") {
    return (
      <button
        disabled={!canSend}
        className="rounded-xl px-4 py-2 transition"
        style={{ background: canSend ? "#444" : "#2b2b2f", color: "#fff", opacity: busy ? 0.7 : 1 }}
        onClick={onSend}
      >
        {busy ? "Processing..." : "Send 1 NFT"}
      </button>
    );
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "linear-gradient(180deg,#141416,#111113)",
        color: "#e8e8ea",
        border: "1px solid #2a2a2e",
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}
    >
      <div className="font-semibold mb-2">Vault</div>
      <div className="text-sm opacity-85 mb-3">Send 1 eligible NFT to gain +1 life.</div>

      <label className="text-xs opacity-80">tokenId</label>
      <div className="flex items-center rounded-xl mt-1 mb-3 px-3 py-2" style={{ background: "#1b1b1f", border: "1px solid #2e2e33" }}>
        <div className="text-xs mr-2 px-2 py-1 rounded-lg" style={{ background: "#242428", border: "1px solid #36363a" }}>#ID</div>
        <input
          className="flex-1 bg-transparent outline-none text-sm"
          placeholder="e.g. 12345 or 0xABC..."
          value={rawId}
          onChange={(e) => setRawId(e.target.value)}
          spellCheck={false}
        />
        <span className="text-[11px] opacity-70 ml-2">{normalized ? "ok" : "invalid"}</span>
      </div>

      <button
        disabled={!canSend}
        className="w-full rounded-xl py-2.5 transition"
        style={{ background: canSend ? "#3b3b3f" : "#26262a", color: "#fff", opacity: busy ? 0.7 : 1 }}
        onClick={onSend}
      >
        {busy ? "Processing..." : "Send 1 NFT"}
      </button>

      {ok && <div className="text-xs mt-2" style={{ color: "#6adf6a" }}>Confirmed. You can continue.</div>}
      {err && <div className="text-xs mt-2" style={{ color: "#ff6b6b" }}>{err}</div>}
    </div>
  );
}
