import React from "react";

export default function DeathOverlay({
  visible,
  reason,
  lives,
  onContinueRequest,
}: {
  visible: boolean;
  reason?: string | null;
  lives: number;
  onContinueRequest: () => void; // triggers VaultPanel CTA (UI flow)
}) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.65)" }}>
      <div
        className="rounded-2xl p-5"
        style={{
          width: 380,
          background: "linear-gradient(180deg,#121214,#0e0e10)",
          color: "#e8e8ea",
          boxShadow: "0 16px 40px rgba(0,0,0,0.75)",
          border: "1px solid #27272a",
        }}
      >
        <div className="text-xl font-semibold mb-1">Your pet has passed away</div>
        <div className="text-sm opacity-90 mb-4">
          {reason ? `Reason: ${reason}` : "Your pet could not survive while you were away."}
        </div>

        <div className="flex items-center justify-between mb-3 text-sm">
          <span className="opacity-80">Lives remaining</span>
          <span className="font-semibold">{lives}</span>
        </div>

        <button
          className="w-full rounded-xl py-2.5 mb-2 transition"
          style={{ background: "#3b3b3f", color: "#fff" }}
          onClick={onContinueRequest}
        >
          Continue — Send 1 NFT
        </button>

        <div className="text-xs opacity-75 leading-snug">
          After your NFT is confirmed, you'll receive +1 life automatically and the game will restart.
        </div>
      </div>
    </div>
  );
}
