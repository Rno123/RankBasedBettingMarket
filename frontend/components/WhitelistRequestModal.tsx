"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

interface Props {
  hackathonPubkey: string;
  hackathonName?: string;
  isOpen: boolean;
  onClose: () => void;
}

type SubmitState = "idle" | "loading" | "success" | "duplicate" | "error";

export default function WhitelistRequestModal({
  hackathonPubkey,
  hackathonName,
  isOpen,
  onClose,
}: Props) {
  const { publicKey, signMessage } = useWallet();
  const { login, ready, authenticated } = usePrivy();
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  function handleClose() {
    setState("idle");
    setEmail("");
    setNotes("");
    setErrorMsg("");
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey || !signMessage) return;
    setState("loading");
    setErrorMsg("");

    try {
      const message = new TextEncoder().encode(
        `hackbet:whitelist-request:${hackathonPubkey}`,
      );
      const signature = await signMessage(message);
      const signatureBase64 = Buffer.from(signature).toString("base64");

      const res = await fetch("/api/whitelist-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hackathon_pubkey: hackathonPubkey,
          wallet_address: publicKey.toBase58(),
          email,
          notes: notes || undefined,
          signature: signatureBase64,
        }),
      });

      const json = await res.json();

      if (res.status === 409) {
        setState("duplicate");
      } else if (!res.ok) {
        setErrorMsg(json.error ?? "Something went wrong.");
        setState("error");
      } else {
        setState("success");
      }
    } catch {
      setErrorMsg("Network error — please try again.");
      setState("error");
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "4px",
    fontSize: "0.6875rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--c-text-4)",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="ui-card"
        style={{ width: "100%", maxWidth: "440px", padding: "28px", position: "relative" }}
      >
        {/* Close */}
        <button
          onClick={handleClose}
          style={{ position: "absolute", top: "12px", right: "16px", background: "none", border: "none", cursor: "pointer", color: "var(--c-text-4)", fontSize: "1.5rem", lineHeight: 1, padding: "4px" }}
        >
          ×
        </button>

        <h2 style={{ margin: "0 0 2px", fontSize: "1.0625rem", fontWeight: 700, color: "var(--c-text)" }}>
          Request whitelist access
        </h2>
        <p style={{ margin: "0 0 24px", fontSize: "0.8125rem", color: "var(--c-text-4)" }}>
          {hackathonName ? <>for <strong style={{ color: "var(--c-text-3)" }}>{hackathonName}</strong></> : "The organizer will review and whitelist your wallet."}
        </p>

        {state === "success" ? (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "20px", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-emerald-text)" }}>Request submitted!</p>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-text-2)" }}>The organizer will review and whitelist your wallet.</p>
            <button onClick={handleClose} style={{ marginTop: "12px", background: "none", border: "none", cursor: "pointer", fontSize: "0.8125rem", color: "var(--c-emerald-text)", textDecoration: "underline", fontFamily: "inherit" }}>Close</button>
          </div>
        ) : state === "duplicate" ? (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "20px", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-amber-text)" }}>Already submitted</p>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-text-2)" }}>You already have a pending whitelist request for this hackathon.</p>
            <button onClick={handleClose} style={{ marginTop: "12px", background: "none", border: "none", cursor: "pointer", fontSize: "0.8125rem", color: "var(--c-amber-text)", textDecoration: "underline", fontFamily: "inherit" }}>Close</button>
          </div>
        ) : !publicKey ? (
          <div>
            <p style={{ margin: "0 0 20px", fontSize: "0.875rem", color: "var(--c-text-3)", textAlign: "center" }}>
              Connect a wallet to identify yourself and sign your request.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "stretch" }}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <WalletMultiButton style={{ borderRadius: "10px", fontSize: "13px", height: "40px" }} />
              </div>
              {ready && !authenticated && (
                <button
                  onClick={() => login()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    height: "40px",
                    borderRadius: "10px",
                    border: "1px solid var(--c-indigo-border)",
                    background: "var(--c-indigo-light)",
                    color: "var(--c-indigo-text)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Sign in with Privy →
                </button>
              )}
            </div>
            <p style={{ marginTop: "14px", fontSize: "0.75rem", color: "var(--c-text-5)", textAlign: "center" }}>
              Privy: sign in first, then connect the embedded wallet above.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Wallet</label>
              <div style={{ borderRadius: "8px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "8px 12px", fontSize: "0.75rem", fontFamily: "monospace", color: "var(--c-text-3)", wordBreak: "break-all" }}>
                {publicKey.toBase58()}
              </div>
            </div>

            <div>
              <label htmlFor="wl-modal-email" style={labelStyle}>
                Email <span style={{ color: "var(--c-red-text)" }}>*</span>
              </label>
              <input
                id="wl-modal-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="ui-input"
              />
            </div>

            <div>
              <label htmlFor="wl-modal-notes" style={labelStyle}>
                Note <span style={{ color: "var(--c-text-4)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </label>
              <textarea
                id="wl-modal-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Briefly describe your interest or project"
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", borderRadius: "8px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "8px 12px", fontSize: "0.875rem", color: "var(--c-text)", resize: "vertical", outline: "none", fontFamily: "inherit" }}
              />
            </div>

            {state === "error" && (
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-red-text)" }}>{errorMsg}</p>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              <button type="submit" disabled={state === "loading"} className="ui-btn ui-btn-indigo" style={{ flex: 1 }}>
                {state === "loading" ? "Submitting…" : "Submit request"}
              </button>
              <button type="button" onClick={handleClose} className="ui-btn ui-btn-outline">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
