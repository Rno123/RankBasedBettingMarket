"use client";

import { useState, useEffect } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Session } from "@supabase/supabase-js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import { getSupabase } from "@/lib/supabase";
import { useHackathons } from "@/hooks/useHackathons";
import type { HackathonInfo } from "@/hooks/useHackathons";
import { hackathonStatus, formatDate, timeUntil, formatTokens } from "@/lib/format";
import { getProgram, getReadonlyProgram } from "@/lib/program";
import { buildProjectRegistrationMessage } from "@/lib/project-signing";
import { projectPdaFromUrl, escrowPda, stakePda } from "@/lib/pda";
import { signatureToBase64 } from "@/lib/signature";
import { USDC_MINT } from "@/lib/constants";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Sign in", "Connect wallet", "Submit project"];
  return (
    <div style={{ marginBottom: "32px", display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0 }}>
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
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  async function signInOAuth(provider: "google" | "twitter") {
    if (!supabase) { setErr("Auth not configured"); return; }
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: authRedirectUrl() } });
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
    <div className="ui-card" style={{ margin: "0 auto", maxWidth: "24rem", padding: "32px" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 700, color: "var(--c-text)" }}>Sign in to submit</h2>
      <p style={{ margin: "0 0 24px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Sign in to register your project and put skin in the game.</p>

      <div style={{ marginBottom: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <button onClick={() => signInOAuth("google")} style={oauthBtnStyle}>
          <svg style={{ height: "16px", width: "16px" }} viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>
        <button onClick={() => signInOAuth("twitter")} style={oauthBtnStyle}>
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

// ── Submission form for one hackathon ─────────────────────────────────────────

function SubmitForm({
  hackathonPubkey,
  hackathonName,
  onDone,
  authEmail,
}: {
  hackathonPubkey: PublicKey;
  hackathonName: string;
  onDone: () => void;
  authEmail: string;
}) {
  const { publicKey, signMessage } = useWallet();
  const [url, setUrl] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function handleSubmit() {
    if (!publicKey || !signMessage) {
      setErr("Your wallet must support message signing to submit a project");
      return;
    }
    if (!url.startsWith("https://github.com/")) { setErr("URL must start with https://github.com/"); return; }
    if (url.length > 200) { setErr("URL too long (max 200 chars)"); return; }

    setErr(null); setBusy(true);
    const projectPk: PublicKey = await projectPdaFromUrl(hackathonPubkey, url);
    try {
      const signature = signatureToBase64(
        await signMessage(
          new TextEncoder().encode(
            buildProjectRegistrationMessage(projectPk.toBase58()),
          ),
        ),
      );
      const response = await fetch("/api/project-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authEmail: authEmail || null,
          discord: discord || undefined,
          githubUrl: url,
          hackathonPubkey: hackathonPubkey.toBase58(),
          projectPubkey: projectPk.toBase58(),
          signature,
          telegram: telegram || undefined,
          twitterHandle: twitter.replace(/^@/, "") || undefined,
          walletAddress: publicKey.toBase58(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to submit project");
      }
    } catch (e: any) {
      setErr(e.message ?? "Failed to submit project");
      setBusy(false);
      return;
    }

    setOk("Project submitted! The organizer will review your submission.");
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
    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px", borderRadius: "12px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "16px" }}>
      <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 500, color: "var(--c-indigo-text)" }}>Submit to: {hackathonName}</p>
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
          <input className="ui-input" placeholder="t.me/…" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </div>
        <div>
          <label style={subLabelStyle}>Discord</label>
          <input className="ui-input" placeholder="discord.gg/…" value={discord} onChange={(e) => setDiscord(e.target.value)} />
        </div>
      </div>
      {err && <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={handleSubmit} disabled={busy || !publicKey || !signMessage} className="ui-btn ui-btn-indigo ui-btn-sm">
          {busy ? "Submitting…" : "Submit project"}
        </button>
        <button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm">Cancel</button>
      </div>
    </div>
  );
}

// ── Hackathon card for devs ────────────────────────────────────────────────────

function DevHackathonCard({ hackathon, authEmail }: { hackathon: HackathonInfo; authEmail: string }) {
  const { publicKey } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const status = hackathonStatus(hackathon.resultsTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved);

  if (status !== "open") return null;

  return (
    <div className="ui-card" style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: "var(--c-text)" }}>{hackathon.name || hackathon.pubkey.toBase58().slice(0, 12) + "…"}</p>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
            Results: {formatDate(hackathon.resultsTimestamp)} · Cutoff in {timeUntil(hackathon.cutoffTimestamp)}
          </p>
        </div>
        {!submitting && (
          <button
            onClick={() => setSubmitting(true)}
            disabled={!publicKey}
            className="ui-btn ui-btn-indigo ui-btn-sm"
            style={{ flexShrink: 0 }}
            title={!publicKey ? "Connect wallet first" : undefined}
          >
            Submit project
          </button>
        )}
      </div>
      {submitting && (
        <SubmitForm
          hackathonPubkey={hackathon.pubkey}
          hackathonName={hackathon.name}
          onDone={() => setSubmitting(false)}
          authEmail={authEmail}
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
  const [project, setProject] = useState<OnChainProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [selfStakeAmt, setSelfStakeAmt] = useState("");
  const [tick, setTick] = useState(0);

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
    setBusy("deposit"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(sub.project_pubkey);
      const hackathonPk = new PublicKey(sub.hackathon_pubkey);
      const builderAta = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const escrow = escrowPda(hackathonPk);
      await (program.methods as any).payDeposit().accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
        builderTokenAccount: builderAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setOk("Deposit paid!");
      setTick((t) => t + 1);
      onUpdated();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function selfStake() {
    const raw = Math.round(parseFloat(selfStakeAmt) * 1_000_000);
    if (isNaN(raw) || raw <= 0) { setErr("Enter a valid amount"); return; }
    if (!hackathon) { setErr("Hackathon not found — try refreshing, or re-submit your project to the current hackathon."); return; }
    setBusy("selfstake"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(sub.project_pubkey);
      const hackathonPk = new PublicKey(sub.hackathon_pubkey);
      const builderAta = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const escrow = escrowPda(hackathonPk);
      const userStake = stakePda(publicKey, projectPk);
      await (program.methods as any).selfStake(new BN(raw)).accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
        userStake,
        builderTokenAccount: builderAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setOk(`Self-staked ${selfStakeAmt} USDC!`);
      setSelfStakeAmt("");
      setTick((t) => t + 1);
      onUpdated();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function submitProject() {
    setBusy("submit"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const projectPk = new PublicKey(sub.project_pubkey);
      const hackathonPk = new PublicKey(sub.hackathon_pubkey);
      await (program.methods as any).submitProject().accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
      }).rpc();
      setOk(
        hasDeposit
          ? "Builder declaration saved. The organizer still needs to approve the submission before your deposit refund unlocks."
          : "Builder declaration saved. The organizer still needs to approve the submission before the project is marked verified.",
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
      await (program.methods as any).claimDepositRefund().accounts({
        builder: publicKey,
        hackathon: hackathonPk,
        project: projectPk,
        builderTokenAccount: builderAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setOk("Deposit refunded!");
      setTick((t) => t + 1);
      onUpdated();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  const repoShort = sub.github_url.replace("https://github.com/", "");
  const depositAmt = hackathon?.depositAmount ?? 0n;
  const hasDeposit = depositAmt > 0n;
  const stakingActivated = !hasDeposit || project?.depositAmountPaid ? true : false;
  const canSelfStake = hasDeposit && !!project?.depositAmountPaid;
  const selfStakeDisabledLabel = hasDeposit
    ? "Disabled until deposit is paid"
    : "Disabled for no-deposit FYI entries";
  const canClaimDepositRefund =
    !!project &&
    project.depositAmountPaid > 0n &&
    !project.depositForfeited &&
    !project.depositRefunded &&
    (project.isRefundEnabled || project.submitted);

  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 0", borderBottom: "1px solid var(--c-divider-2)" };
  const labelStyle: React.CSSProperties = { fontSize: "0.875rem", color: "var(--c-text-3)" };
  const checkStyle: React.CSSProperties = { fontSize: "0.875rem", fontWeight: 600, color: "var(--c-emerald-text)" };

  return (
    <div className="ui-card" style={{ padding: "20px" }}>
      <div style={{ marginBottom: "12px" }}>
        <a href={sub.github_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: "var(--c-text)", textDecoration: "none" }}>{repoShort}</a>
        <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
          {hackathon?.name || sub.hackathon_pubkey.slice(0, 12) + "…"}
          {" · "}<span style={{ textTransform: "capitalize" }}>{sub.status}</span>
        </p>
      </div>

      {!hackathon && (
        <div style={{ marginBottom: "8px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.8125rem", color: "var(--c-amber-text)" }}>
          Hackathon not found in current on-chain state. Re-submit this project to the active hackathon from the Open Hackathons section above.
        </div>
      )}
      {loading ? (
        <div className="ui-skeleton" style={{ height: "80px", borderRadius: "8px" }} />
      ) : project ? (
        <div>
          {!stakingActivated && (
            <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "10px 14px", fontSize: "0.8125rem", color: "var(--c-text-4)" }}>
              FYI only for now. This project stays visible on HackBet, but staking stays disabled until you pay the builder activation deposit.
            </div>
          )}

          {/* Deposit row */}
          {hasDeposit && (
            <div style={rowStyle}>
              <span style={labelStyle}>Commitment deposit ({formatTokens(depositAmt)} USDC)</span>
              {project.depositForfeited ? (
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-red-text)" }}>Forfeited</span>
              ) : project.depositRefunded ? (
                <span style={checkStyle}>✓ Refunded</span>
              ) : project.depositAmountPaid > 0n ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={checkStyle}>✓ Paid</span>
                  {canClaimDepositRefund && (
                    <button onClick={claimDepositRefund} disabled={busy === "refund"} className="ui-btn ui-btn-emerald ui-btn-sm">
                      {busy === "refund" ? "…" : "Claim refund"}
                    </button>
                  )}
                  {!canClaimDepositRefund && (
                    <span style={{ fontSize: "0.8125rem", color: "var(--c-text-4)" }}>
                      {project.isRefundEnabled
                        ? "Refund override active"
                        : project.builderDeclared
                          ? "Waiting on organizer approval"
                          : "Refund unlocks after you mark the project submitted"}
                    </span>
                  )}
                </div>
              ) : (
                <button onClick={payDeposit} disabled={busy === "deposit"} className="ui-btn ui-btn-indigo ui-btn-sm">
                  {busy === "deposit" ? "Paying…" : `Pay ${formatTokens(depositAmt)} USDC`}
                </button>
              )}
            </div>
          )}

          {/* Self-stake row */}
          <div style={rowStyle}>
            <span style={labelStyle}>Self-stake</span>
            {project.builderStaked > 0n ? (
              <span style={checkStyle}>✓ {formatTokens(project.builderStaked)} USDC staked</span>
            ) : !canSelfStake ? (
              <span style={{ fontSize: "0.8125rem", color: "var(--c-text-4)" }}>
                {selfStakeDisabledLabel}
              </span>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount USDC"
                  value={selfStakeAmt}
                  onChange={(e) => setSelfStakeAmt(e.target.value)}
                  className="ui-input-sm"
                  style={{ width: "120px" }}
                />
                <button onClick={selfStake} disabled={busy === "selfstake" || !selfStakeAmt} className="ui-btn ui-btn-indigo ui-btn-sm">
                  {busy === "selfstake" ? "…" : "Self-stake"}
                </button>
              </div>
            )}
          </div>

          {/* Submit row */}
          <div style={rowStyle}>
            <span style={labelStyle}>Builder declaration</span>
            {project.builderDeclared ? (
              <span style={checkStyle}>✓ Submitted by builder</span>
              ) : (
                <button onClick={submitProject} disabled={busy === "submit"} className="ui-btn ui-btn-amber ui-btn-sm">
                  {busy === "submit" ? "…" : "Mark as submitted"}
                </button>
              )}
          </div>
          <div style={{ ...rowStyle, borderBottom: "none" }}>
            <span style={labelStyle}>Organizer approval</span>
            {project.submitted ? (
              <span style={checkStyle}>✓ Approved</span>
            ) : (
              <span style={{ fontSize: "0.8125rem", color: "var(--c-text-4)" }}>
                {project.builderDeclared
                  ? "Pending organizer approval"
                  : "Waiting on your builder declaration"}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ borderRadius: "8px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "12px 14px", fontSize: "0.8125rem", color: "var(--c-text-4)" }}>
          {sub.status === "pending"
            ? "Pending organizer review. Your on-chain project isn't confirmed yet — deposit, self-stake, and builder declaration will unlock once it appears on-chain."
            : sub.status === "rejected"
              ? "This submission was rejected. You can submit the repo again if you want the organizer to take another look."
              : "The organizer approved this submission, but the on-chain project is not visible yet. Refresh in a moment and try again."}
        </div>
      )}

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
}: {
  publicKey: PublicKey;
  anchorWallet: AnchorWallet;
  hackathons: HackathonInfo[];
  usdcMint: PublicKey;
}) {
  const [submissions, setSubmissions] = useState<BuilderSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) { setLoading(false); return; }
    supabase
      .from("project_submissions")
      .select("project_pubkey, hackathon_pubkey, github_url, status")
      .eq("wallet_address", publicKey.toBase58())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setSubmissions((data as BuilderSubmission[]) ?? []);
        setLoading(false);
      });
  }, [publicKey.toBase58(), refreshKey]);

  if (loading) return <div className="ui-skeleton" style={{ height: "64px", borderRadius: "16px" }} />;
  if (submissions.length === 0) return null;

  return (
    <div>
      <h2 style={{ margin: "0 0 12px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>My Projects</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {submissions.map((sub) => {
          const hackathon = hackathons.find((h) => h.pubkey.toBase58() === sub.hackathon_pubkey);
          const mint = hackathon?.usdcMint ?? usdcMint;
          return (
            <BuilderProjectCard
              key={sub.project_pubkey}
              sub={sub}
              hackathon={hackathon}
              publicKey={publicKey}
              anchorWallet={anchorWallet}
              usdcMint={mint}
              onUpdated={() => setRefreshKey((value) => value + 1)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DevPortalPage() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const { hackathons, loading: hLoading } = useHackathons();

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) { setSessionLoading(false); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      setSessionLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
  }

  const authEmail = session?.user?.email ?? session?.user?.user_metadata?.user_name ?? "";
  const openHackathons = hackathons.filter((h) => {
    const s = hackathonStatus(h.resultsTimestamp, h.cutoffTimestamp, h.isResolved);
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
        ) : (
          <StepIndicator current={!session ? 1 : !publicKey ? 2 : 3} />
        )}

        {sessionLoading ? null : !session ? (
          <AuthSection onSession={setSession} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Logged-in banner */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "16px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "12px 20px" }}>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>
                Signed in as <strong>{authEmail || "wallet user"}</strong>
              </p>
              <button onClick={signOut} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "var(--c-emerald-text)", textDecoration: "underline", fontFamily: "inherit" }}>Sign out</button>
            </div>

            {/* Wallet connect */}
            {!publicKey && (
              <div className="ui-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "32px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-3)" }}>Connect your wallet to register a project on-chain.</p>
                <WalletMultiButton style={{ borderRadius: "12px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", fontSize: "13px" }} />
              </div>
            )}

            {/* Hackathon list */}
            {publicKey && (
              <div>
                <h2 style={{ margin: "0 0 12px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Open Hackathons</h2>
                {hLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>{[...Array(2)].map((_, i) => <div key={i} className="ui-skeleton" style={{ height: "96px" }} />)}</div>
                ) : openHackathons.length === 0 ? (
                  <div className="ui-card" style={{ padding: "32px", textAlign: "center", color: "var(--c-text-4)" }}>
                    No hackathons currently accepting project submissions.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {openHackathons.map((h) => (
                      <DevHackathonCard key={h.pubkey.toBase58()} hackathon={h} authEmail={authEmail} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* My Projects — deposit, self-stake, submit, refund */}
            {publicKey && anchorWallet && (
              <BuilderProjectsSection
                publicKey={publicKey}
                anchorWallet={anchorWallet}
                hackathons={hackathons}
                usdcMint={usdcMint}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
