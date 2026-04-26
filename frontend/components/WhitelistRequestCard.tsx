"use client";

import { useState } from "react";

interface Props {
  hackathonPubkey: string;
  walletAddress: string;
}

type SubmitState = "idle" | "loading" | "success" | "duplicate" | "error";

export default function WhitelistRequestCard({ hackathonPubkey, walletAddress }: Props) {
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/whitelist-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hackathon_pubkey: hackathonPubkey,
          wallet_address: walletAddress,
          email,
          notes: notes || undefined,
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

  if (state === "success") {
    return (
      <div
        style={{
          borderRadius: "12px",
          border: "1px solid var(--c-emerald-border, #34d399)",
          background: "var(--c-emerald-light)",
          padding: "16px",
          fontSize: "0.875rem",
          color: "var(--c-emerald-text)",
        }}
      >
        Request submitted. The organizer will review and whitelist your wallet.
      </div>
    );
  }

  if (state === "duplicate") {
    return (
      <div
        style={{
          borderRadius: "12px",
          border: "1px solid var(--c-amber-border, #f59e0b)",
          background: "var(--c-amber-light)",
          padding: "16px",
          fontSize: "0.875rem",
          color: "var(--c-amber-text)",
        }}
      >
        You already submitted a whitelist request for this hackathon.
      </div>
    );
  }

  return (
    <div
      className="ui-card"
      style={{ padding: "20px" }}
    >
      <h3
        style={{
          margin: "0 0 4px",
          fontSize: "0.9375rem",
          fontWeight: 700,
          color: "var(--c-text)",
        }}
      >
        Request whitelist access
      </h3>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: "0.8125rem",
          color: "var(--c-text-3)",
        }}
      >
        Your wallet is not yet approved to stake. Submit a request and the organizer will review it.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Wallet address — read-only */}
        <div>
          <label
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--c-text-4)",
            }}
          >
            Wallet
          </label>
          <div
            style={{
              borderRadius: "8px",
              border: "1px solid var(--c-divider)",
              background: "var(--card-bg-alt)",
              padding: "8px 12px",
              fontSize: "0.8125rem",
              fontFamily: "monospace",
              color: "var(--c-text-3)",
              wordBreak: "break-all",
            }}
          >
            {walletAddress}
          </div>
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="whitelist-email"
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--c-text-4)",
            }}
          >
            Email <span style={{ color: "var(--c-red-text, #f87171)" }}>*</span>
          </label>
          <input
            id="whitelist-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: "100%",
              boxSizing: "border-box",
              borderRadius: "8px",
              border: "1px solid var(--c-divider)",
              background: "var(--card-bg-alt)",
              padding: "8px 12px",
              fontSize: "0.875rem",
              color: "var(--c-text)",
              outline: "none",
            }}
          />
        </div>

        {/* Notes */}
        <div>
          <label
            htmlFor="whitelist-notes"
            style={{
              display: "block",
              marginBottom: "4px",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--c-text-4)",
            }}
          >
            Note <span style={{ color: "var(--c-text-4)" }}>(optional)</span>
          </label>
          <textarea
            id="whitelist-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Briefly describe your project or why you'd like to participate"
            rows={3}
            style={{
              width: "100%",
              boxSizing: "border-box",
              borderRadius: "8px",
              border: "1px solid var(--c-divider)",
              background: "var(--card-bg-alt)",
              padding: "8px 12px",
              fontSize: "0.875rem",
              color: "var(--c-text)",
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>

        {state === "error" && (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-red-text, #f87171)" }}>
            {errorMsg}
          </p>
        )}

        <button
          type="submit"
          disabled={state === "loading"}
          className="ui-btn ui-btn-indigo"
          style={{ alignSelf: "flex-start" }}
        >
          {state === "loading" ? "Submitting…" : "Submit request"}
        </button>
      </form>
    </div>
  );
}
