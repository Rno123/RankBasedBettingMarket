"use client";

import { useRef, useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

type ConnectWalletButtonProps = {
  fullWidth?: boolean;
  compact?: boolean;
};

function formatAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function ConnectWalletButton({
  fullWidth = false,
  compact = false,
}: ConnectWalletButtonProps) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Close the dropdown when the wallet disconnects.
  useEffect(() => {
    if (!connected) setOpen(false);
  }, [connected]);

  const label = connected && publicKey
    ? formatAddress(publicKey.toBase58())
    : connecting
      ? "Connecting…"
      : "Connect Wallet";

  function handleClick() {
    setError(null);
    if (connected) {
      setOpen((v) => !v);
    } else {
      setVisible(true);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnect();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative", width: fullWidth ? "100%" : undefined }}>
      <button
        onClick={handleClick}
        className="ui-btn ui-btn-indigo"
        style={{
          width: fullWidth ? "100%" : undefined,
          height: compact ? "36px" : undefined,
          minHeight: compact ? "36px" : undefined,
          padding: compact ? "0 12px" : undefined,
          fontSize: compact ? "13px" : undefined,
          borderRadius: compact ? "8px" : undefined,
          overflow: compact ? "hidden" : undefined,
          textOverflow: compact ? "ellipsis" : undefined,
          whiteSpace: compact ? "nowrap" : undefined,
        }}
      >
        {connected && wallet?.adapter.icon && (
          <img
            src={wallet.adapter.icon}
            alt={wallet.adapter.name}
            style={{ width: "20px", height: "20px", borderRadius: "4px", flexShrink: 0, marginRight: "6px" }}
          />
        )}
        {label}
      </button>

      {open && connected && (
        <div
          className="ui-card"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            left: fullWidth ? 0 : undefined,
            zIndex: 80,
            width: fullWidth ? "100%" : undefined,
            minWidth: fullWidth ? undefined : "100%",
            maxWidth: "min(92vw, 220px)",
            padding: "14px",
          }}
        >
          <button
            onClick={() => void handleDisconnect()}
            disabled={busy}
            className="ui-btn ui-btn-outline"
            style={{
              width: "100%",
              height: compact ? "36px" : undefined,
              minHeight: compact ? "36px" : undefined,
              padding: compact ? "0 12px" : undefined,
              fontSize: compact ? "13px" : undefined,
              borderRadius: compact ? "8px" : undefined,
            }}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
          {error && (
            <p style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "var(--c-red-text)" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
