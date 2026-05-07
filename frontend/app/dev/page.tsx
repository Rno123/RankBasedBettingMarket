"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Provider, Session } from "@supabase/supabase-js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import { getSupabase } from "@/lib/supabase";
import { useHackathons } from "@/hooks/useHackathons";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import type { HackathonInfo } from "@/hooks/useHackathons";
import { hackathonStatus, formatDate, timeUntil, formatTokens, parseTokens } from "@/lib/format";
import { getProgram, getReadonlyProgram } from "@/lib/program";
import { buildProjectRegistrationMessage } from "@/lib/project-signing";
import { projectPdaFromUrl, escrowPda, stakePda, hashUrl, normalizeGitHubUrl } from "@/lib/pda";
import { signatureToBase64 } from "@/lib/signature";
import { USDC_MINT } from "@/lib/constants";

import ConnectWalletButton from "@/components/ConnectWalletButton";
const TX_CONFIRM_TIMEOUT_MS = 30_000;
type SubmissionModalState = "depositPrompt" | "depositUnpaid" | "eligible";

async function sendWalletTransactionWithConfirmation({
  connection,
  feePayer,
  sendTransaction,
  transaction,
  verifySuccess,
}: {
  connection: Connection;
  feePayer: PublicKey;
  sendTransaction: (
    transaction: any,
    connection: Connection,
    options?: { preflightCommitment?: "processed" | "confirmed" | "finalized" },
  ) => Promise<string>;
  transaction: any;
  verifySuccess?: () => Promise<boolean>;
}) {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  if ("feePayer" in transaction && !transaction.feePayer) {
    transaction.feePayer = feePayer;
  }
  if ("recentBlockhash" in transaction) {
    transaction.recentBlockhash = latestBlockhash.blockhash;
  }

  let signature: string;
  try {
    const sig = await sendTransaction(transaction, connection, {
      preflightCommitment: "confirmed",
    });
    if (!sig || typeof sig !== "string") {
      throw new Error(
        "Wallet returned an invalid transaction signature. The wallet may have rejected the transaction or encountered a simulation error."
      );
    }
    signature = sig;
  } catch (sendErr: any) {
    // Surface wallet-level errors (simulation failures, user rejection) before
    // they get swallowed by confirmTransaction's opaque RPC error handling.
    const msg = sendErr?.message ?? String(sendErr);
    if (
      msg.includes("simulation") ||
      msg.includes("Simulation") ||
      msg.includes("rejected") ||
      msg.includes("Rejected") ||
      msg.includes("User rejected")
    ) {
      throw sendErr;
    }
    throw new Error(`Failed to send transaction: ${msg}`);
  }

  try {
    const confirmation = await Promise.race([
      connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Transaction confirmation timed out")), TX_CONFIRM_TIMEOUT_MS),
      ),
    ]);
    if (confirmation?.value?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
  } catch (error: any) {
    if (verifySuccess && await verifySuccess()) {
      return signature;
    }

    // Guard against malformed RPC responses — getSignatureStatus may also return
    // a result whose value is undefined when the RPC is undergoing maintenance.
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      if (status?.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      }
      if (
        status?.value?.confirmationStatus === "confirmed" ||
        status?.value?.confirmationStatus === "finalized"
      ) {
        return signature;
      }
    } catch {
      // Fall through to the original error if getSignatureStatus also fails.
    }
    throw error;
  }

  return signature;
}

function SubmissionNoticeModal({
  state,
  depositAmount,
  busy,
  error,
  onPayDeposit,
  onSkipDeposit,
  onClose,
}: {
  state: SubmissionModalState | null;
  depositAmount: bigint;
  busy: boolean;
  error: string | null;
  onPayDeposit: () => void;
  onSkipDeposit: () => void;
  onClose: () => void;
}) {
  if (!state) return null;

  const isPrompt = state === "depositPrompt";
  const isEligible = state === "eligible";
  const accentColor = isEligible ? "var(--c-emerald-text)" : isPrompt ? "var(--c-indigo-text)" : "var(--c-amber-text)";
  const accentBorder = isEligible ? "var(--c-emerald-border)" : isPrompt ? "var(--c-indigo-border)" : "var(--c-amber-border)";
  const accentBg = isEligible ? "var(--c-emerald-light)" : isPrompt ? "var(--c-indigo-light)" : "var(--c-amber-light)";

  let title = "";
  let body = "";
  if (state === "depositPrompt") {
    title = "Pay deposit now?";
    body = `This hackathon does not require admin approval, so your project is already registered. Pay the ${formatTokens(depositAmount)} USDC deposit now to make it eligible for staking.`;
  } else if (state === "depositUnpaid") {
    title = "Project not eligible for staking yet";
    body = "Your project is not eligible for staking since the deposit is not paid.";
  } else {
    title = "Project eligible for staking";
    body = "Your project is eligible for staking. If you're looking to self-stake, you can do so from the builder tab.";
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        padding: "16px",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "30rem",
          borderRadius: "16px",
          border: "1px solid var(--card-border)",
          background: "var(--modal-bg)",
          padding: "24px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ marginBottom: "16px", borderRadius: "12px", border: `1px solid ${accentBorder}`, background: accentBg, padding: "14px 16px" }}>
          <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: accentColor }}>{title}</p>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: accentColor }}>{body}</p>
        </div>
        {error && (
          <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "12px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
            {error}
          </div>
        )}
        {isPrompt ? (
          <div className="mobile-actions-row" style={{ justifyContent: "flex-end" }}>
            <button onClick={onSkipDeposit} disabled={busy} className="ui-btn ui-btn-outline ui-btn-sm mobile-fill">
              {error ? "Close" : "Later"}
            </button>
            <button onClick={onPayDeposit} disabled={busy} className="ui-btn ui-btn-indigo ui-btn-sm mobile-fill">
              {busy ? `Paying ${formatTokens(depositAmount)} USDC...` : error ? "Try again" : `Pay ${formatTokens(depositAmount)} USDC`}
            </button>
          </div>
        ) : (
          <div className="mobile-actions-row" style={{ justifyContent: "flex-end" }}>
            <button onClick={onClose} className={`ui-btn ${isEligible ? "ui-btn-emerald" : "ui-btn-amber"} ui-btn-sm mobile-fill`}>
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Sign in", "Connect wallet", "Submit project"];
  return (
    <div style={{ marginBottom: "32px", display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0, overflowX: "auto", paddingBottom: "4px" }}>
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = current > n;
        const active = current === n;
        return (
          <div key={n} style={{ display: "flex", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  display: "flex",
                  height: "32px",
                  width: "32px",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "9999px",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  transition: "all 0.15s",
                  background: done ? "var(--c-emerald)" : active ? "var(--c-indigo)" : "var(--c-divider)",
                  color: done || active ? "#ffffff" : "var(--c-text-4)",
                }}
              >
                {done ? "✓" : n}
              </div>
              <span
                style={{
                  marginTop: "4px",
                  fontSize: "0.75rem",
                  color: active ? "var(--c-indigo-text)" : done ? "var(--c-emerald-text)" : "var(--c-text-4)",
                }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  margin: "16px 12px 0",
                  height: "2px",
                  width: "40px",
                  flexShrink: 0,
                  background: current > n ? "var(--c-emerald)" : "var(--c-divider)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Auth section ──────────────────────────────────────────────────────────────

function AuthSection({ onSession }: { onSession: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supabase = getSupabase();

  function authRedirectUrl(): string {
    const base =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
      (typeof window !== "undefined" ? window.location.origin : "");
    return `${base}/dev`;
  }

  async function signInEmail() {
    if (!supabase) { setErr("Auth not configured (missing Supabase env vars)"); return; }
    if (!email.trim()) { setErr("Enter an email address"); return; }
    setBusy(true); setErr(null);
    sessionStorage.setItem("authReturnTo", "/dev");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  async function signInOAuth(provider: "google" | "x") {
    if (!supabase) { setErr("Auth not configured"); return; }
    setBusy(true);
    setErr(null);
    sessionStorage.setItem("authReturnTo", "/dev");

    const providers: Provider[] = provider === "x" ? ["x", "twitter"] : [provider];
    let lastError: string | null = null;

    for (const candidate of providers) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: candidate,
        options: { redirectTo: authRedirectUrl() },
      });

      if (!error) return;

      lastError = error.message;
      if (!/provider is not enabled/i.test(error.message)) break;
    }

    setBusy(false);
    if (provider === "x" && lastError && /provider is not enabled/i.test(lastError)) {
      setErr("X / Twitter login is not enabled in Supabase yet. Enable the X (OAuth 2.0) provider or legacy Twitter provider in Supabase Authentication > Providers.");
      return;
    }
    setErr(lastError ?? "Could not start OAuth sign-in.");
  }

  if (!supabase) {
    return (
      <div style={{ borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-amber-text)" }}>
        Supabase not configured. Add <code style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>NEXT_PUBLIC_SUPABASE_URL</code> and <code style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>.env.local</code> to enable sign-in.
      </div>
    );
  }

  const oauthBtnStyle: React.CSSProperties = {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    borderRadius: "12px",
    border: "1px solid var(--c-divider)",
    padding: "10px 16px",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "var(--c-text-2)",
    background: "transparent",
    cursor: "pointer",
    transition: "background 0.15s",
    fontFamily: "inherit",
  };

  return (
    <div className="ui-card" style={{ margin: "0 auto", maxWidth: "24rem", padding: "clamp(20px, 5vw, 32px)" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 700, color: "var(--c-text)" }}>Sign in to submit</h2>
      <p style={{ margin: "0 0 24px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Sign in to register your project and put skin in the game.</p>

      <div style={{ marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <button onClick={() => signInOAuth("google")} style={oauthBtnStyle} disabled={busy}>
          <svg style={{ height: "16px", width: "16px" }} viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>
        <button onClick={() => signInOAuth("x")} style={oauthBtnStyle} disabled={busy}>
          <svg style={{ height: "16px", width: "16px" }} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.264 5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Continue with X / Twitter
        </button>
      </div>

      <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
        <div style={{ flex: 1, borderTop: "1px solid var(--c-divider)" }} />or<div style={{ flex: 1, borderTop: "1px solid var(--c-divider)" }} />
      </div>

      {sent ? (
        <div style={{ borderRadius: "12px", background: "var(--c-emerald-light)", padding: "16px", textAlign: "center", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>
          Check your email — a sign-in link was sent to <strong>{email}</strong>.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && signInEmail()} className="ui-input" />
          <button onClick={signInEmail} disabled={busy} className="ui-btn ui-btn-indigo" style={{ width: "100%" }}>
            {busy ? "Sending…" : "Send magic link"}
          </button>
        </div>
      )}

      {err && <p style={{ marginTop: "12px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
    </div>
  );
}

function normalizeTelegram(v: string): string | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.startsWith("https://t.me/") || t.startsWith("t.me/")) return t;
  const handle = t.startsWith("@") ? t.slice(1) : t;
  return `t.me/${handle}`;
}

// ── Submission form for one hackathon ─────────────────────────────────────────

function SubmitForm({
  hackathon,
  onDone,
  authEmail,
  onProjectUpdated,
  onDepositPaid,
}: {
  hackathon: HackathonInfo;
  onDone: () => void;
  authEmail: string;
  onProjectUpdated: () => void;
  onDepositPaid?: (projectPubkey: string) => void;
}) {
  const { publicKey, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { pubkey: hackathonPubkey, name: hackathonName, requiresApproval, depositAmount, usdcMint } = hackathon;
  const [projectName, setProjectName] = useState("");
  const [url, setUrl] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [busy, setBusy] = useState(false);
  const [depositBusy, setDepositBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [depositErr, setDepositErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [modalState, setModalState] = useState<SubmissionModalState | null>(null);
  const [registeredProjectPubkey, setRegisteredProjectPubkey] = useState<string | null>(null);

  async function handleDepositPayment() {
    if (!registeredProjectPubkey || !publicKey || !anchorWallet) {
      setDepositErr("Connect your wallet to pay the deposit");
      return;
    }
    if (hackathon && Math.floor(Date.now() / 1000) >= hackathon.cutoffTimestamp) {
      setDepositErr("Cutoff has passed — deposit payment is no longer allowed");
      return;
    }

    setDepositBusy(true);
    setDepositErr(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(registeredProjectPubkey);
      const builderAta = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const escrow = escrowPda(hackathonPubkey);
      const tx = await (program.methods as any).payDeposit().accounts({
        builder: publicKey,
        hackathon: hackathonPubkey,
        project: projectPk,
        builderTokenAccount: builderAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction();
      await sendWalletTransactionWithConfirmation({
        connection,
        feePayer: publicKey,
        sendTransaction,
        transaction: tx,
        verifySuccess: async () => {
          const refreshed = await (getReadonlyProgram().account as any).projectAccount
            .fetchNullable(projectPk)
            .catch(() => null);
          return BigInt((refreshed?.depositAmountPaid ?? 0).toString()) > 0n;
        },
      });
      onProjectUpdated();
      if (onDepositPaid) {
        onDepositPaid(registeredProjectPubkey!);
        onDone();
      } else {
        setModalState("eligible");
      }
    } catch (e: any) {
      setDepositErr(e.message ?? "Failed to pay deposit");
    } finally {
      setDepositBusy(false);
    }
  }

  async function resizeIcon(file: File): Promise<string | null> {
    try {
      const bmp = await createImageBitmap(file, { resizeWidth: 256, resizeHeight: 256 });
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return canvas.toDataURL("image/png", 0.7);
    } catch {
      return null;
    }
  }

  async function handleSubmit() {
    if (!publicKey || !signMessage) {
      setErr("Your wallet must support message signing to submit a project");
      return;
    }
    if (!projectName.trim()) { setErr("Project name is required"); return; }
    if (projectName.trim().length > 120) { setErr("Project name too long (max 120 chars)"); return; }
    if (!url.startsWith("https://github.com/")) { setErr("URL must start with https://github.com/"); return; }
    if (url.length > 200) { setErr("URL too long (max 200 chars)"); return; }

    setErr(null); setBusy(true);
    const projectPk: PublicKey = await projectPdaFromUrl(hackathonPubkey, url);
    try {
      if (!requiresApproval) {
        // Open registration: builder registers on-chain directly, no admin step.
        if (!anchorWallet) throw new Error("Connect your wallet to register");

        // Check if this project PDA already exists on-chain (e.g. builder
        // is re-submitting from a different wallet session). If it already
        // exists and the builder_wallet matches, skip the on-chain call.
        const existingOnChain = await (getReadonlyProgram().account as any)
          .projectAccount.fetchNullable(projectPk).catch(() => null);

        if (existingOnChain) {
          const existingBuilder: string =
            (existingOnChain.builderWallet as PublicKey).toBase58();
          if (existingBuilder !== publicKey.toBase58()) {
            throw new Error(
              "This GitHub URL is already registered by a different wallet for this hackathon.",
            );
          }
          // Project already on-chain under this wallet — skip .rpc()
        } else {
          const normalized = normalizeGitHubUrl(url);
          const urlHash = Array.from(await hashUrl(url));
          const program = getProgram(anchorWallet);
          await (program.methods as any)
            .registerProject(normalized, urlHash)
            .accounts({
              caller: publicKey,
              builder: publicKey,
              hackathon: hackathonPubkey,
              project: projectPk,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        }
      }

      // Write to Supabase for My Projects tracking regardless of path.
      const signature = signatureToBase64(
        await signMessage(
          new TextEncoder().encode(
            buildProjectRegistrationMessage(projectPk.toBase58()),
          ),
        ),
      );
      const iconBase64 = iconFile ? await resizeIcon(iconFile) : null;

      const response = await fetch("/api/project-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authEmail: authEmail || null,
          discord: discord.trim() || undefined,
          githubUrl: url,
          hackathonPubkey: hackathonPubkey.toBase58(),
          iconBase64,
          projectName: projectName.trim(),
          projectPubkey: projectPk.toBase58(),
          signature,
          telegram: normalizeTelegram(telegram),
          twitterHandle: twitter.replace(/^@/, "").trim() || undefined,
          walletAddress: publicKey.toBase58(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to submit project");
      }
      onProjectUpdated();
    } catch (e: any) {
      setErr(e.message ?? "Failed to submit project");
      setBusy(false);
      return;
    }

    if (requiresApproval) {
      setOk("Project submitted! The organizer will review your submission.");
    } else if (depositAmount > 0n) {
      setRegisteredProjectPubkey(projectPk.toBase58());
      setModalState("depositPrompt");
    } else {
      setRegisteredProjectPubkey(projectPk.toBase58());
      setModalState("eligible");
    }
    setBusy(false);
  }

  if (ok) {
    return (
      <div style={{ marginTop: "12px", borderRadius: "12px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "16px" }}>
        <p style={{ margin: 0, fontWeight: 500, color: "var(--c-emerald-text)" }}>Submitted successfully!</p>
        <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>
          Your project is now <strong>pending organizer review</strong>. It will appear on the hackathon page after approval. If this hackathon requires a deposit, the normal refund path unlocks after the organizer approves your submission.
        </p>
        <button onClick={onDone} style={{ marginTop: "8px", background: "transparent", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--c-emerald-text)", textDecoration: "underline", fontFamily: "inherit" }}>Close</button>
      </div>
    );
  }

  const subLabelStyle: React.CSSProperties = { display: "block", marginBottom: "4px", fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" };

  return (
    <>
      <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "12px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "16px" }}>
      <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 500, color: "var(--c-indigo-text)" }}>Submit to: {hackathonName}</p>
      <div>
        <label style={subLabelStyle}>Project icon</label>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {iconFile ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ height: "40px", width: "40px", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--c-divider)", flexShrink: 0 }}>
                <img src={URL.createObjectURL(iconFile)} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} />
              </div>
              <button
                onClick={() => setIconFile(null)}
                className="ui-btn ui-btn-outline-red ui-btn-xs"
                style={{ fontSize: "0.75rem" }}
              >
                Remove
              </button>
            </div>
          ) : (
            <label
              style={{
                display: "flex",
                height: "40px",
                width: "40px",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "10px",
                border: "1px dashed var(--c-divider)",
                cursor: "pointer",
                color: "var(--c-text-4)",
                fontSize: "1.25rem",
                flexShrink: 0,
              }}
            >
              +
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
            </label>
          )}
        </div>
      </div>
      <div>
        <label style={subLabelStyle}>Project name <span style={{ color: "var(--c-red-text)" }}>*</span></label>
        <input className="ui-input" placeholder="My awesome project" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      </div>
      <div>
        <label style={subLabelStyle}>GitHub URL <span style={{ color: "var(--c-red-text)" }}>*</span></label>
        <input className="ui-input" placeholder="https://github.com/org/repo" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="grid-auto-2" style={{ gap: "8px" }}>
        <div>
          <label style={subLabelStyle}>Twitter / X</label>
          <input className="ui-input" placeholder="@handle" value={twitter} onChange={(e) => setTwitter(e.target.value)} />
        </div>
        <div>
          <label style={subLabelStyle}>Telegram</label>
          <input className="ui-input" placeholder="@username or t.me/…" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </div>
        <div>
          <label style={subLabelStyle}>Discord</label>
          <input className="ui-input" placeholder="username or discord.gg/…" value={discord} onChange={(e) => setDiscord(e.target.value)} />
        </div>
      </div>
      {err && <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      <div className="mobile-actions-row">
        <button onClick={handleSubmit} disabled={busy || !publicKey || !signMessage} className="ui-btn ui-btn-indigo ui-btn-sm mobile-fill">
          {busy ? "Submitting…" : "Submit project"}
        </button>
        <button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm mobile-fill">Cancel</button>
      </div>
      </div>
      <SubmissionNoticeModal
        state={modalState}
        depositAmount={depositAmount}
        busy={depositBusy}
        error={depositErr}
        onPayDeposit={handleDepositPayment}
        onSkipDeposit={() => {
          setDepositErr(null);
          setModalState("depositUnpaid");
        }}
        onClose={() => {
          setDepositErr(null);
          const wasEligible = modalState === "eligible";
          setModalState(null);
          if (wasEligible && registeredProjectPubkey) onDepositPaid?.(registeredProjectPubkey);
          onDone();
        }}
      />
    </>
  );
}

// ── Hackathon card for devs ────────────────────────────────────────────────────

function DevHackathonCard({
  hackathon,
  authEmail,
  onProjectUpdated,
  onDepositPaid,
  autoExpand,
}: {
  hackathon: HackathonInfo;
  authEmail: string;
  onProjectUpdated: () => void;
  onDepositPaid?: (projectPubkey: string) => void;
  autoExpand?: boolean;
}) {
  const { publicKey } = useWallet();
  const [submitting, setSubmitting] = useState(autoExpand ?? false);
  const status = hackathonStatus(hackathon.irlHackathonDeadlineTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved);

  if (status !== "open") return null;

  return (
    <div className="ui-card" style={{ padding: "20px" }}>
      <div className="mobile-stack-between">
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: "var(--c-text)" }}>{hackathon.name || hackathon.pubkey.toBase58().slice(0, 12) + "…"}</p>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
            Results: {formatDate(hackathon.irlHackathonDeadlineTimestamp)} · Cutoff in {timeUntil(hackathon.cutoffTimestamp)}
          </p>
        </div>
        {!submitting && (
          <button
            onClick={() => setSubmitting(true)}
            disabled={!publicKey}
            className="ui-btn ui-btn-indigo ui-btn-sm mobile-fill"
            style={{ flexShrink: 0 }}
            title={!publicKey ? "Connect wallet first" : undefined}
          >
            Submit project
          </button>
        )}
      </div>
      {submitting && (
        <SubmitForm
          hackathon={hackathon}
          onDone={() => setSubmitting(false)}
          authEmail={authEmail}
          onProjectUpdated={onProjectUpdated}
          onDepositPaid={onDepositPaid}
        />
      )}
    </div>
  );
}

// ── Builder project card ──────────────────────────────────────────────────────

interface OnChainProject {
  depositAmountPaid: bigint;
  builderStaked: bigint;
  builderDeclared: boolean;
  submitted: boolean;
  depositForfeited: boolean;
  depositRefunded: boolean;
  isRefundEnabled: boolean;
}

interface BuilderSubmission {
  project_pubkey: string;
  hackathon_pubkey: string;
  github_url: string;
  icon_url?: string | null;
  project_name?: string | null;
  status: string;
}

function BuilderProjectCard({
  sub,
  hackathon,
  publicKey,
  anchorWallet,
  usdcMint,
  onUpdated,
}: {
  sub: BuilderSubmission;
  hackathon: HackathonInfo | undefined;
  publicKey: PublicKey;
  anchorWallet: AnchorWallet;
  usdcMint: PublicKey;
  onUpdated: () => void;
}) {
  const { connection } = useConnection();
  const { sendTransaction } = useWallet();
  const [project, setProject] = useState<OnChainProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [selfStakeAmt, setSelfStakeAmt] = useState("");
  const [tick, setTick] = useState(0);
  const walletBalance = useTokenBalance(publicKey, usdcMint, tick);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const program = getReadonlyProgram();
    (program.account as any).projectAccount
      .fetchNullable(new PublicKey(sub.project_pubkey))
      .then((d: any) => {
        if (!cancelled) {
          setProject(
            d
              ? {
                  depositAmountPaid: BigInt((d.depositAmountPaid ?? 0).toString()),
                  builderStaked: BigInt((d.builderStaked ?? 0).toString()),
                  builderDeclared: d.builderDeclared as boolean,
                  submitted: d.submitted as boolean,
                  depositForfeited: d.depositForfeited as boolean,
                  depositRefunded: d.depositRefunded as boolean,
                  isRefundEnabled: d.isRefundEnabled as boolean,
                }
              : null,
          );
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sub.project_pubkey, tick]);

  async function payDeposit() {
    if (!hackathon) { setErr("Hackathon not found — try refreshing, or re-submit your project to the current hackathon."); return; }
    if (Math.floor(Date.now() / 1000) >= hackathon.cutoffTimestamp) {
      setErr("Cutoff has passed — deposit payment is no longer allowed");
      return;
    }
    setBusy("deposit"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(sub.project_pubkey);
      const hackathonPk = new PublicKey(sub.hackathon_pubkey);
      const builderAta = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const escrow = escrowPda(hackathonPk);
      const tx = await (program.methods as any).payDeposit().accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
        builderTokenAccount: builderAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction();
      await sendWalletTransactionWithConfirmation({
        connection,
        feePayer: publicKey,
        sendTransaction,
        transaction: tx,
        verifySuccess: async () => {
          const refreshed = await (getReadonlyProgram().account as any).projectAccount
            .fetchNullable(projectPk)
            .catch(() => null);
          return BigInt((refreshed?.depositAmountPaid ?? 0).toString()) > 0n;
        },
      });
      setOk("Deposit paid!");
      setTick((t) => t + 1);
      onUpdated();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function selfStake() {
    const raw = parseTokens(selfStakeAmt);
    if (raw <= 0n) { setErr("Enter a valid amount"); return; }
    if (!hackathon) { setErr("Hackathon not found — try refreshing, or re-submit your project to the current hackathon."); return; }
    if (Math.floor(Date.now() / 1000) >= hackathon.cutoffTimestamp) {
      setErr("Cutoff has passed — self-staking is no longer allowed");
      return;
    }
    setBusy("selfstake"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(sub.project_pubkey);
      const hackathonPk = new PublicKey(sub.hackathon_pubkey);
      const builderAta = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const escrow = escrowPda(hackathonPk);
      const userStake = stakePda(publicKey, projectPk);
      const prevBuilderStaked = project?.builderStaked ?? 0n;
      const tx = await (program.methods as any).selfStake(new BN(raw)).accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
        userStake,
        builderTokenAccount: builderAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction();
      await sendWalletTransactionWithConfirmation({
        connection,
        feePayer: publicKey,
        sendTransaction,
        transaction: tx,
        verifySuccess: async () => {
          const refreshed = await (getReadonlyProgram().account as any).projectAccount
            .fetchNullable(projectPk)
            .catch(() => null);
          return BigInt((refreshed?.builderStaked ?? 0).toString()) > prevBuilderStaked;
        },
      });
      setOk(`Self-staked ${selfStakeAmt} USDC!`);
      setSelfStakeAmt("");
      setTick((t) => t + 1);
      onUpdated();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function submitProject() {
    if (hackathon && Math.floor(Date.now() / 1000) >= hackathon.irlHackathonDeadlineTimestamp) {
      setErr("Submission window closed — builder declarations must happen before results.");
      return;
    }
    setBusy("submit"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(sub.project_pubkey);
      const hackathonPk = new PublicKey(sub.hackathon_pubkey);
      const tx = await (program.methods as any).submitProject().accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
      }).transaction();
      await sendWalletTransactionWithConfirmation({
        connection,
        feePayer: publicKey,
        sendTransaction,
        transaction: tx,
        verifySuccess: async () => {
          const refreshed = await (getReadonlyProgram().account as any).projectAccount
            .fetchNullable(projectPk)
            .catch(() => null);
          return Boolean(refreshed?.builderDeclared);
        },
      });
      setOk(
        hackathon?.requiresApproval
          ? hasDeposit
            ? "Builder declaration saved. The organizer still needs to approve the submission before your deposit refund unlocks."
            : "Builder declaration saved. The organizer still needs to approve the submission before the project is marked verified."
          : "Builder declaration saved. No organizer approval is required for this hackathon.",
      );
      setTick((t) => t + 1);
      onUpdated();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function claimDepositRefund() {
    if (!hackathon) { setErr("Hackathon not found — try refreshing, or re-submit your project to the current hackathon."); return; }
    setBusy("refund"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(sub.project_pubkey);
      const hackathonPk = new PublicKey(sub.hackathon_pubkey);
      const builderAta = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const escrow = escrowPda(hackathonPk);
      const tx = await (program.methods as any).claimDepositRefund().accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
        builderTokenAccount: builderAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction();
      await sendWalletTransactionWithConfirmation({
        connection,
        feePayer: publicKey,
        sendTransaction,
        transaction: tx,
        verifySuccess: async () => {
          const refreshed = await (getReadonlyProgram().account as any).projectAccount
            .fetchNullable(projectPk)
            .catch(() => null);
          return Boolean(refreshed?.depositRefunded);
        },
      });
      setOk("Deposit refunded!");
      setTick((t) => t + 1);
      onUpdated();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  const repoShort = sub.github_url.replace("https://github.com/", "");
  const projectLabel = sub.project_name?.trim() || repoShort;
  const depositAmt = hackathon?.depositAmount ?? 0n;
  const hasDeposit = depositAmt > 0n;
  const stakingActivated = !hasDeposit || project?.depositAmountPaid ? true : false;
  const canSelfStake = hasDeposit && !!project?.depositAmountPaid;
  const MAX_SELF_STAKE = 250_000_000n;
  const nowSecs = Math.floor(Date.now() / 1000);
  const cutoffPassed = hackathon ? nowSecs >= hackathon.cutoffTimestamp : true;
  const resultsPassed = hackathon ? nowSecs >= hackathon.irlHackathonDeadlineTimestamp : true;
  const selfStakeDisabledLabel = cutoffPassed
    ? "Staking closed — cutoff has passed"
    : hasDeposit
      ? "Disabled until deposit is paid"
      : "Staking not enabled";
  const selfStakeCapReached = (project?.builderStaked ?? 0n) >= MAX_SELF_STAKE;
  const canClaimDepositRefund =
    !!project &&
    project.depositAmountPaid > 0n &&
    !project.depositForfeited &&
    !project.depositRefunded &&
    (project.isRefundEnabled || project.submitted);

  const rowStyle: React.CSSProperties = { gap: "12px", padding: "10px 0", borderBottom: "1px solid var(--c-divider-2)" };
  const labelStyle: React.CSSProperties = { fontSize: "0.875rem", color: "var(--c-text-3)" };
  const checkStyle: React.CSSProperties = { fontSize: "0.875rem", fontWeight: 600, color: "var(--c-emerald-text)" };

  // Step states for the progress indicator
  const step2State = sub.status === "rejected" ? "error" : sub.status === "approved" ? "done" : "active";
  const step3State = project ? "done" : sub.status === "rejected" ? "idle" : "idle";
  type StepState = "done" | "active" | "error" | "idle";
  const stepDot = (state: StepState, label: string, icon: string) => (
    <div className="ui-step-node">
      <div className={`ui-step-dot ui-step-dot-${state}`}>{icon}</div>
      <span className={`ui-step-label ui-step-label-${state}`}>{label}</span>
    </div>
  );
  const connector = (done: boolean) => (
    <div className={`ui-step-connector ${done ? "ui-step-connector-done" : "ui-step-connector-idle"}`} />
  );

  const selfStakeBarPct = Math.min(100, Number(project?.builderStaked ?? 0n) / 250_000_000 * 100);

  return (
    <div className="ui-card" style={{ padding: "20px" }}>
      <div style={{ marginBottom: "4px" }}>
        <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>{projectLabel}</p>
        <a href={sub.github_url} target="_blank" rel="noopener noreferrer" className="mobile-link-wrap" style={{ fontSize: "0.875rem", color: "var(--c-indigo-text)", textDecoration: "none" }}>{repoShort}</a>
        <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
          {hackathon?.name || sub.hackathon_pubkey.slice(0, 12) + "…"}
        </p>
      </div>

      {/* Step progress */}
      <div className="ui-steps">
        {stepDot("done", "Submitted", "✓")}
        {connector(step2State === "done")}
        {stepDot(step2State, step2State === "error" ? "Rejected" : step2State === "done" ? "Approved" : "In review", step2State === "error" ? "✕" : step2State === "done" ? "✓" : "…")}
        {connector(step3State === "done")}
        {stepDot(step3State, step3State === "done" ? "Live" : "Live", step3State === "done" ? "✓" : "—")}
      </div>

      {!hackathon && (
        <div style={{ marginBottom: "8px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.8125rem", color: "var(--c-amber-text)" }}>
          Hackathon not found. Re-submit from the submit-projects list above.
        </div>
      )}
      {sub.status === "rejected" && !project && (
        <div style={{ marginBottom: "8px", borderRadius: "8px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "10px 14px", fontSize: "0.8125rem", color: "var(--c-red-text)" }}>
          Submission rejected. You can re-submit if you want another review.
        </div>
      )}

      {loading ? (
        <div className="ui-skeleton" style={{ height: "80px", borderRadius: "8px" }} />
      ) : project ? (
        <div>
          {/* Deposit row */}
          {hasDeposit && (
            <div className="mobile-stack-between" style={rowStyle}>
              <span style={labelStyle}>Deposit ({formatTokens(depositAmt)} USDC)</span>
              {project.depositForfeited ? (
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-red-text)" }}>Forfeited</span>
              ) : project.depositRefunded ? (
                <span style={checkStyle}>✓ Refunded</span>
              ) : project.depositAmountPaid > 0n ? (
                <div className="mobile-actions-row">
                  <span style={checkStyle}>✓ Paid</span>
                  {canClaimDepositRefund ? (
                    <button onClick={claimDepositRefund} disabled={busy === "refund"} className="ui-btn ui-btn-emerald ui-btn-sm mobile-fill">
                      {busy === "refund" ? "…" : "Claim refund"}
                    </button>
                  ) : (
                    <span className="ui-tooltip-wrap">
                      <button
                        disabled
                        className="ui-btn ui-btn-outline ui-btn-sm mobile-fill"
                        style={{ cursor: "help" }}
                      >
                        Claim refund
                      </button>
                      <span className="ui-tooltip">
                        {project.isRefundEnabled
                          ? "Refund override active"
                          : project.builderDeclared
                            ? "Waiting on organizer approval"
                            : "Mark project submitted first"}
                      </span>
                    </span>
                  )}
                </div>
              ) : (
                <span className="ui-tooltip-wrap mobile-fill">
                  <button
                    onClick={payDeposit}
                    disabled={busy === "deposit" || cutoffPassed}
                    className="ui-btn ui-btn-indigo ui-btn-sm mobile-fill"
                  >
                    {busy === "deposit" ? "Paying…" : `Pay ${formatTokens(depositAmt)} USDC`}
                  </button>
                  {cutoffPassed && (
                    <span className="ui-tooltip">Cutoff has passed — deposit window is closed</span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Self-stake row */}
          <div className="mobile-stack-between" style={{ ...rowStyle, paddingTop: "12px" }}>
            <span style={{ ...labelStyle, paddingTop: "2px" }}>Self-stake</span>
            {!canSelfStake ? (
              <span className="ui-tooltip-wrap mobile-fill">
                <button disabled className="ui-btn ui-btn-indigo ui-btn-sm mobile-fill" style={{ cursor: "help" }}>
                  Stake
                </button>
                <span className="ui-tooltip">{selfStakeDisabledLabel}</span>
              </span>
            ) : selfStakeCapReached ? (
              <div className="mobile-fill" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={checkStyle}>✓ {formatTokens(project.builderStaked)} USDC</span>
                <div style={{ width: "120px" }}>
                  <div className="ui-stake-bar-track">
                    <div className="ui-stake-bar-fill" style={{ width: "100%", background: "var(--c-emerald)" }} />
                  </div>
                  <span style={{ fontSize: "0.625rem", color: "var(--c-text-4)" }}>Cap reached</span>
                </div>
              </div>
            ) : (
              <div className="mobile-fill" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {project.builderStaked > 0n && (
                  <div style={{ width: "100%", minWidth: "160px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                      <span style={{ fontSize: "0.625rem", color: "var(--c-text-4)" }}>Self-staked</span>
                      <span style={{ fontSize: "0.625rem", color: "var(--c-text-3)", fontWeight: 600 }}>
                        {formatTokens(project.builderStaked)} / 250 USDC
                      </span>
                    </div>
                    <div className="ui-stake-bar-track">
                      <div className="ui-stake-bar-fill" style={{ width: `${selfStakeBarPct}%`, background: "var(--c-emerald)" }} />
                    </div>
                  </div>
                )}
                {walletBalance !== null && (
                  <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                    Wallet available: <span style={{ fontWeight: 600, color: "var(--c-text-3)" }}>{formatTokens(walletBalance)} USDC</span>
                  </p>
                )}
                <div className="mobile-actions-row">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={cutoffPassed ? "Cutoff passed" : "Add USDC"}
                    value={selfStakeAmt}
                    onChange={(e) => setSelfStakeAmt(e.target.value)}
                    className="ui-input-sm"
                    style={{ width: "100%" }}
                    disabled={cutoffPassed}
                  />
                  <button onClick={selfStake} disabled={busy === "selfstake" || !selfStakeAmt || cutoffPassed} className="ui-btn ui-btn-indigo ui-btn-sm mobile-fill">
                    {busy === "selfstake" ? "…" : "Stake"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Builder declaration row */}
          <div className="mobile-stack-between" style={rowStyle}>
            <span style={labelStyle}>Builder declaration</span>
            {project.builderDeclared ? (
              <span style={checkStyle}>✓ Declared</span>
            ) : (
              <span className="ui-tooltip-wrap mobile-fill">
                <button
                  onClick={submitProject}
                  disabled={busy === "submit" || resultsPassed}
                  className="ui-btn ui-btn-amber ui-btn-sm mobile-fill"
                >
                  {busy === "submit" ? "…" : "Mark submitted"}
                </button>
                {resultsPassed && (
                  <span className="ui-tooltip">Results timestamp has passed — submission window is closed</span>
                )}
              </span>
            )}
          </div>

          {/* Organizer approval row */}
          <div className="mobile-stack-between" style={{ ...rowStyle, borderBottom: "none" }}>
            <span style={labelStyle}>Organizer approval</span>
            {project.submitted ? (
              <span style={checkStyle}>✓ Approved</span>
            ) : (
              <span className="ui-tooltip-wrap">
                <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)", fontWeight: 600 }}>
                  {project.builderDeclared ? "Pending" : "Awaiting declaration"}
                </span>
                <span className="ui-tooltip">
                  {project.builderDeclared
                    ? "Organizer will review and approve your submission"
                    : "Mark your project as submitted before results are posted"}
                </span>
              </span>
            )}
          </div>
        </div>
      ) : null}

      {err && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
    </div>
  );
}

// ── Builder projects section ──────────────────────────────────────────────────

function BuilderProjectsSection({
  publicKey,
  anchorWallet,
  hackathons,
  usdcMint,
  externalRefreshKey,
  authEmail,
  scrollToPubkey,
  onScrollComplete,
}: {
  publicKey: PublicKey;
  anchorWallet: AnchorWallet;
  hackathons: HackathonInfo[];
  usdcMint: PublicKey;
  externalRefreshKey: number;
  authEmail: string;
  scrollToPubkey?: string | null;
  onScrollComplete?: () => void;
}) {
  const [submissions, setSubmissions] = useState<BuilderSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) { setLoading(false); return; }

    supabase
      .from("project_submissions_public")
      .select("project_pubkey, hackathon_pubkey, github_url, icon_url, project_name, status")
      .eq("wallet_address", publicKey.toBase58())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setSubmissions((data as BuilderSubmission[]) ?? []);
        setLoading(false);
      });
  }, [publicKey.toBase58(), refreshKey, externalRefreshKey]);

  useEffect(() => {
    if (!scrollToPubkey || submissions.length === 0) return;
    if (!submissions.some((s) => s.project_pubkey === scrollToPubkey)) return;
    requestAnimationFrame(() => {
      document.getElementById(`project-${scrollToPubkey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      onScrollComplete?.();
    });
  }, [submissions, scrollToPubkey]);

  if (loading) return <div className="ui-skeleton" style={{ height: "64px", borderRadius: "16px" }} />;
  if (submissions.length === 0) return null;

  return (
    <div>
      <h2 style={{ margin: "0 0 12px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Manage submissions</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {submissions.map((sub) => {
          const hackathon = hackathons.find((h) => h.pubkey.toBase58() === sub.hackathon_pubkey);
          const mint = hackathon?.usdcMint ?? usdcMint;
          return (
            <div key={`${sub.project_pubkey}:${refreshKey}:${externalRefreshKey}`} id={`project-${sub.project_pubkey}`}>
              <BuilderProjectCard
                sub={sub}
                hackathon={hackathon}
                publicKey={publicKey}
                anchorWallet={anchorWallet}
                usdcMint={mint}
                onUpdated={() => setRefreshKey((value) => value + 1)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function DevPortalPage() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [builderRefreshKey, setBuilderRefreshKey] = useState(0);
  const [devTab, setDevTab] = useState<"submit" | "manage">("submit");
  const [pendingScrollPubkey, setPendingScrollPubkey] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const deepLinkHackathon = searchParams?.get("hackathon");
  const isPreview = searchParams?.get("preview") !== null;

  function handleDepositPaid(projectPubkey: string) {
    setBuilderRefreshKey((v) => v + 1);
    setDevTab("manage");
    setPendingScrollPubkey(projectPubkey);
  }
  const { hackathons, loading: hLoading } = useHackathons();

  useEffect(() => {
    if (isPreview) {
      setSession({ user: { email: "preview@local.dev" } } as Session);
      setSessionLoading(false);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) { setSessionLoading(false); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoading(false);
      if (session) {
        const returnTo = sessionStorage.getItem("authReturnTo");
        if (returnTo) {
          sessionStorage.removeItem("authReturnTo");
          if (window.location.pathname !== returnTo) {
            window.location.href = returnTo;
          }
        }
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      setSessionLoading(false);
      if (session) {
        const returnTo = sessionStorage.getItem("authReturnTo");
        if (returnTo) {
          sessionStorage.removeItem("authReturnTo");
          if (window.location.pathname !== returnTo) {
            window.location.href = returnTo;
          }
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [isPreview]);

  async function signOut() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
  }

  const authEmail = session?.user?.email ?? session?.user?.user_metadata?.user_name ?? "";
  const ongoingHackathons = hackathons.filter((h) => {
    const s = hackathonStatus(h.irlHackathonDeadlineTimestamp, h.cutoffTimestamp, h.isResolved);
    return s === "open";
  });

  const usdcMint = hackathons[0]?.usdcMint ?? USDC_MINT;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ margin: "0 auto", maxWidth: "672px", padding: "40px 16px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ margin: 0, fontSize: "1.875rem", fontWeight: 800, color: "var(--c-text)" }}>Dev Portal</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
            Register your project for a hackathon. Backers stake real USDC on who they think will win — your project&apos;s backing is a public, on-chain conviction signal.
          </p>
        </div>

        {sessionLoading ? (
          <div className="ui-skeleton" style={{ height: "192px", borderRadius: "16px" }} />
        ) : !session ? (
          <StepIndicator current={1} />
        ) : null}

        {sessionLoading ? null : !session ? (
          <AuthSection onSession={setSession} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Logged-in banner */}
            <div className="mobile-stack-between" style={{ borderRadius: "16px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "12px 20px" }}>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>
                Signed in as <strong>{authEmail || "wallet user"}</strong>
              </p>
              <button onClick={signOut} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--c-emerald-text)", textDecoration: "underline", fontFamily: "inherit" }}>Sign out</button>
            </div>

            {/* Wallet connect */}
            {!publicKey && (
              <div className="ui-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "32px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-3)" }}>Connect your wallet to register a project on-chain.</p>
                <ConnectWalletButton />
              </div>
            )}

            {publicKey && (
              <div style={{ display: "flex", gap: "4px", borderRadius: "12px", border: "1px solid var(--c-divider)", padding: "4px" }}>
                <button onClick={() => setDevTab("submit")} className={`ui-sort-tab ${devTab === "submit" ? "ui-sort-tab-active" : "ui-sort-tab-inactive"}`} style={{ flex: 1 }}>
                  Submit projects
                </button>
                <button onClick={() => setDevTab("manage")} className={`ui-sort-tab ${devTab === "manage" ? "ui-sort-tab-active" : "ui-sort-tab-inactive"}`} style={{ flex: 1 }}>
                  Manage submissions
                </button>
              </div>
            )}

            {/* Hackathon list */}
            {publicKey && devTab === "submit" && (
              <div>
                {/* 3-step ELI5 */}
                <div style={{ marginBottom: "24px", borderRadius: "16px", border: "1px solid var(--c-divider)", background: "var(--card-bg)", padding: "clamp(16px, 4vw, 24px)" }}>
                  <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, color: "var(--c-text)" }}>How it works</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px" }}>
                    {[
                      { step: "1", title: "Fill in the details", desc: "Project name and GitHub URL. Social links are optional. You can choose to keep your repo private, but this is what backers will see." },
                      { step: "2", title: "Pay a deposit", desc: "A small USDC deposit shows you're serious. You get it back after the hackathon — as long as you don't ghost." },
                      { step: "3", title: "Stake to win", desc: "Back your own project (or others) with USDC. The more conviction you show, the more the crowd pays attention — and you earn a share of the pool if you rank." },
                    ].map(({ step, title, desc }) => (
                      <div key={step} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", height: "32px", width: "32px", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: "var(--c-indigo)", color: "#fff", fontSize: "0.875rem", fontWeight: 800 }}>
                          {step}
                        </div>
                        <div>
                          <p style={{ margin: "0 0 2px", fontSize: "0.875rem", fontWeight: 700, color: "var(--c-text)" }}>{title}</p>
                          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-text-3)", lineHeight: 1.5 }}>{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Submit projects</h2>
                <p style={{ margin: "0 0 12px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Ongoing hackathons that are currently accepting builder submissions.</p>
                {hLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>{[...Array(2)].map((_, i) => <div key={i} className="ui-skeleton" style={{ height: "96px" }} />)}</div>
                ) : ongoingHackathons.length === 0 ? (
                  <div className="ui-card" style={{ padding: "32px", textAlign: "center", color: "var(--c-text-4)" }}>
                    No hackathons currently accepting project submissions.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {ongoingHackathons.map((h) => (
                      <DevHackathonCard
                        key={h.pubkey.toBase58()}
                        hackathon={h}
                        authEmail={authEmail}
                        onProjectUpdated={() => setBuilderRefreshKey((value) => value + 1)}
                        onDepositPaid={handleDepositPaid}
                        autoExpand={deepLinkHackathon === h.pubkey.toBase58()}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* My Projects — deposit, self-stake, submit, refund */}
            {publicKey && anchorWallet && devTab === "manage" && (
              <BuilderProjectsSection
                publicKey={publicKey}
                anchorWallet={anchorWallet}
                hackathons={hackathons}
                usdcMint={usdcMint}
                externalRefreshKey={builderRefreshKey}
                authEmail={authEmail}
                scrollToPubkey={pendingScrollPubkey}
                onScrollComplete={() => setPendingScrollPubkey(null)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function DevPortalPageWrapper() {
  return (
    <Suspense fallback={<div className="ui-skeleton" style={{ height: "64px", borderRadius: "16px", margin: "40px auto", maxWidth: "672px" }} />}>
      <DevPortalPage />
    </Suspense>
  );
}
