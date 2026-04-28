"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import dynamic from "next/dynamic";
import {
  submitWhitelistRequest,
  type WhitelistRequestSubmitState,
} from "@/lib/whitelist-request";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

interface Props {
  hackathonPubkey?: string | null;
  hackathonName?: string;
  hackathonOptions?: Array<{ pubkey: string; name: string }>;
  isOpen: boolean;
  onClose: () => void;
}

export default function WhitelistRequestModal({
  hackathonPubkey,
  hackathonName,
  hackathonOptions,
  isOpen,
  onClose,
}: Props) {
  const { publicKey, signMessage } = useWallet();
  const { login, ready, authenticated } = usePrivy();
  const [selectedHackathon, setSelectedHackathon] = useState(
    hackathonPubkey ?? hackathonOptions?.[0]?.pubkey ?? "",
  );
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<WhitelistRequestSubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    setSelectedHackathon(hackathonPubkey ?? hackathonOptions?.[0]?.pubkey ?? "");
  }, [hackathonPubkey, hackathonOptions, isOpen]);

  if (!isOpen) return null;

  const resolvedHackathonPubkey = hackathonPubkey ?? selectedHackathon;
  const resolvedHackathonName =
    hackathonName ??
    hackathonOptions?.find((option) => option.pubkey === resolvedHackathonPubkey)?.name;

  function handleClose() {
    setState("idle");
    setSelectedHackathon(hackathonPubkey ?? hackathonOptions?.[0]?.pubkey ?? "");
    setEmail("");
    setNotes("");
    setErrorMsg("");
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey || !signMessage) return;
    if (!resolvedHackathonPubkey) {
      setErrorMsg("Choose a hackathon before submitting.");
      setState("error");
      return;
    }
    setState("loading");
    setErrorMsg("");

    try {
      const result = await submitWhitelistRequest({
        hackathonPubkey: resolvedHackathonPubkey,
        walletAddress: publicKey.toBase58(),
        email,
        notes,
        signMessage,
      });
      setState(result);
    } catch (error: any) {
      setErrorMsg(error.message ?? "Network error — please try again.");
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
          {resolvedHackathonName ? <>using <strong style={{ color: "var(--c-text-3)" }}>{resolvedHackathonName}</strong> as the context for your request</> : "The organizer will review and whitelist your wallet."}
        </p>

        {state === "success" ? (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "20px", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-emerald-text)" }}>Request submitted!</p>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-text-2)" }}>
              The organizer will review and whitelist your wallet across HackBet{resolvedHackathonName ? `, using ${resolvedHackathonName} as the request context` : ""}.
            </p>
            <button onClick={handleClose} style={{ marginTop: "12px", background: "none", border: "none", cursor: "pointer", fontSize: "0.8125rem", color: "var(--c-emerald-text)", textDecoration: "underline", fontFamily: "inherit" }}>Close</button>
          </div>
        ) : state === "duplicate" ? (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "20px", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-amber-text)" }}>Already submitted</p>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-text-2)" }}>You already have a pending staking access request.</p>
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
            {!hackathonPubkey && !!hackathonOptions?.length && (
              <div>
                <label htmlFor="wl-modal-hackathon" style={labelStyle}>
                  Hackathon <span style={{ color: "var(--c-red-text)" }}>*</span>
                </label>
                <select
                  id="wl-modal-hackathon"
                  value={selectedHackathon}
                  onChange={(e) => setSelectedHackathon(e.target.value)}
                  className="ui-input"
                  required
                >
                  {hackathonOptions.map((option) => (
                    <option key={option.pubkey} value={option.pubkey}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
