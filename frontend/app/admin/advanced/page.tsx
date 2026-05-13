"use client";

import { useState, useEffect } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet, useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import Navbar from "@/components/Navbar";
import { getProgram } from "@/lib/program";
import { escrowPda, whitelistPda, protocolAdminPda, hashUrl, normalizeGitHubUrl } from "@/lib/pda";
import { useHackathons } from "@/hooks/useHackathons";
import { useProjects } from "@/hooks/useProjects";
import { formatTokens, formatDate } from "@/lib/format";
import { PROTOCOL_ADMIN } from "@/lib/constants";
import { clearAdminSessionCache, ensureAdminSession } from "@/lib/client-admin-auth";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminApiAuth {
  ensureSession: (() => Promise<void>) | null;
  invalidateSession: (message?: string) => void;
  ready: boolean;
}

type HackathonEntry = ReturnType<typeof useHackathons>["hackathons"][number];
type HackathonPhase = "active" | "resolving" | "resolved";

interface Submission {
  id: string;
  hackathon_pubkey: string;
  hackathon_name?: string;
  project_name?: string | null;
  project_pubkey?: string | null;
  github_url: string;
  wallet_address: string;
  twitter_handle?: string;
  telegram?: string;
  discord?: string;
  auth_email?: string;
  status: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TX_CONFIRM_TIMEOUT_MS = 30_000;

function hackathonPhase(h: HackathonEntry): HackathonPhase {
  if (h.isResolved) return "resolved";
  const now = Math.floor(Date.now() / 1000);
  if (now >= h.cutoffTimestamp) return "resolving";
  return "active";
}

const PHASE_LABEL: Record<HackathonPhase, string> = { active: "Active", resolving: "Resolving", resolved: "Resolved" };
const PHASE_COLOR: Record<HackathonPhase, string> = {
  active: "var(--c-indigo-text)",
  resolving: "var(--c-amber-text)",
  resolved: "var(--c-emerald-text)",
};

function getProtocolAdminRemainingAccounts(publicKey: PublicKey | null, hackathonAdmin?: PublicKey) {
  if (!publicKey) return [];
  if (publicKey.toBase58() === PROTOCOL_ADMIN) return [];
  if (hackathonAdmin && hackathonAdmin.equals(publicKey)) return [];
  return [{ pubkey: protocolAdminPda(publicKey), isWritable: false, isSigner: false }];
}

async function sendWalletTransactionWithConfirmation({
  connection, feePayer, sendTransaction, transaction, verifySuccess,
}: {
  connection: any; feePayer: PublicKey;
  sendTransaction: (tx: any, conn: any, opts?: any) => Promise<string>;
  transaction: any; verifySuccess?: () => Promise<boolean>;
}) {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  if ("feePayer" in transaction && !transaction.feePayer) transaction.feePayer = feePayer;
  if ("recentBlockhash" in transaction) transaction.recentBlockhash = latestBlockhash.blockhash;

  let signature: string;
  try {
    const sig = await sendTransaction(transaction, connection, { preflightCommitment: "confirmed" });
    if (!sig || typeof sig !== "string") throw new Error("Wallet returned an invalid transaction signature.");
    signature = sig;
  } catch (sendErr: any) {
    const msg = sendErr?.message ?? String(sendErr);
    if (msg.includes("simulation") || msg.includes("Simulation") || msg.includes("rejected") || msg.includes("Rejected") || msg.includes("User rejected")) throw sendErr;
    throw new Error(`Failed to send transaction: ${msg}`);
  }

  try {
    const confirmation = await Promise.race([
      connection.confirmTransaction({ signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight }, "confirmed"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Transaction confirmation timed out")), TX_CONFIRM_TIMEOUT_MS)),
    ]);
    if (confirmation?.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  } catch (error: any) {
    if (verifySuccess && await verifySuccess()) return signature;
    try {
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      if (status?.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
      if (status?.value?.confirmationStatus === "confirmed" || status?.value?.confirmationStatus === "finalized") return signature;
    } catch { /* fall through */ }
    throw error;
  }
  return signature;
}

async function ensureWalletWhitelistedOnHackathon(
  program: any, admin: PublicKey, hackathonPubkey: PublicKey, hackathonAdmin: PublicKey, wallet: PublicKey, openStaking?: boolean,
) {
  if (openStaking) return;
  const whitelistEntry = whitelistPda(hackathonPubkey, wallet);
  try {
    await (program.methods as any).whitelistWallet()
      .accounts({ admin, hackathon: hackathonPubkey, wallet, whitelistEntry, systemProgram: SystemProgram.programId })
      .remainingAccounts(getProtocolAdminRemainingAccounts(admin, hackathonAdmin))
      .rpc();
  } catch (e: any) {
    if (!(e.message ?? "").includes("already in use")) throw e;
  }
}

// ── HackathonWhitelistPanel ───────────────────────────────────────────────────

function HackathonWhitelistPanel({ hackathon }: { hackathon: HackathonEntry }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [walletInput, setWalletInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function handleWhitelist() {
    if (!publicKey || !anchorWallet) return;
    let wallet: PublicKey;
    try { wallet = new PublicKey(walletInput.trim()); } catch { setErr("Invalid public key"); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      await ensureWalletWhitelistedOnHackathon(program, publicKey, hackathon.pubkey, hackathon.admin, wallet, hackathon.openStaking);
      setOk(`Granted staking access on ${hackathon.name || hackathon.pubkey.toBase58().slice(0, 8)} for ${wallet.toBase58().slice(0, 8)}...${wallet.toBase58().slice(-4)}.`);
      setWalletInput("");
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>Staker access</h3>
      <p style={{ margin: "0 0 12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
        Grant staking access for this hackathon only. This writes the on-chain whitelist PDA for the selected wallet.
      </p>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <input value={walletInput} onChange={(e) => { setWalletInput(e.target.value); setErr(null); }} placeholder="Wallet address to whitelist for this hackathon..." className="ui-input" style={{ flex: 1, minWidth: "220px", fontFamily: "monospace" }} />
        <button onClick={handleWhitelist} disabled={busy || !publicKey || !walletInput.trim()} className="ui-btn ui-btn-indigo ui-btn-sm">{busy ? "..." : "Grant access"}</button>
      </div>
      {err && <p style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
    </div>
  );
}

// ── DepositManagementPanel (advanced view only) ───────────────────────────────

function DepositManagementPanel({ hackathon, adminAuth }: { hackathon: HackathonEntry; adminAuth: AdminApiAuth }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { projects } = useProjects(hackathon.pubkey);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok?: string; err?: string }>>({});

  if (hackathon.depositAmount === 0n) return null;

  const canForfeit = (p: (typeof projects)[number]) =>
    p.depositAmountPaid > 0n && !p.depositForfeited && !p.depositRefunded && !p.builderDeclared && !p.submitted;
  const canEnableRefund = (p: (typeof projects)[number]) =>
    !p.isRefundEnabled && !(hackathon.isResolved && p.rank > 0);
  const visibleProjects = projects.filter((p) => canForfeit(p) || canEnableRefund(p));

  async function forfeitDeposit(projectPubkey: string) {
    if (!publicKey || !anchorWallet) return;
    setBusy(projectPubkey); setMessages((m) => ({ ...m, [projectPubkey]: {} }));
    try {
      const program = getProgram(anchorWallet);
      const feeRecipientAta = getAssociatedTokenAddressSync(hackathon.usdcMint, hackathon.feeRecipient);
      const escrow = escrowPda(hackathon.pubkey);
      await (program.methods as any).forfeitDeposit()
        .accounts({ admin: publicKey, hackathon: hackathon.pubkey, project: new PublicKey(projectPubkey), feeRecipientTokenAccount: feeRecipientAta, escrow, tokenProgram: TOKEN_PROGRAM_ID })
        .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
        .rpc();
      setMessages((m) => ({ ...m, [projectPubkey]: { ok: "Forfeited" } }));
    } catch (e: any) { setMessages((m) => ({ ...m, [projectPubkey]: { err: e.message ?? "Failed" } })); }
    finally { setBusy(null); }
  }

  async function enableRefund(projectPubkey: string) {
    if (!publicKey || !anchorWallet) return;
    setBusy("refund_" + projectPubkey); setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: {} }));
    try {
      const program = getProgram(anchorWallet);
      await (program.methods as any).enableRefund()
        .accounts({ admin: publicKey, hackathon: hackathon.pubkey, project: new PublicKey(projectPubkey) })
        .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
        .rpc();
      setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: { ok: "Exceptional refund enabled" } }));
    } catch (e: any) { setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: { err: e.message ?? "Failed" } })); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>Deposit management</h3>
      <p style={{ margin: "0 0 12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>Emergency override and forfeit paths for deposit-backed hackathons.</p>
      <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.75rem", color: "var(--c-amber-text)" }}>
        <strong>Forfeit deposit</strong> is only valid at least 14 days after the hackathon&apos;s results date, and only if the builder never declared the project as submitted.
      </div>
      <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "10px 14px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>
        <strong>Enable refund override</strong> is the exceptional path. It enables stake refunds and bypasses normal builder deposit checks — only for cancellations, judging mistakes, or explicit organizer exceptions.
      </div>
      {visibleProjects.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No projects with advanced deposit actions.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {visibleProjects.map((p) => {
            const pkStr = p.pubkey.toBase58();
            const msg = messages[pkStr] ?? {};
            const refundMsg = messages["refund_" + pkStr] ?? {};
            return (
              <div key={pkStr} style={{ borderRadius: "10px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "240px" }}>{p.githubUrl.replace("https://github.com/", "")}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                      {p.depositAmountPaid > 0n ? p.depositForfeited ? "Deposit forfeited" : p.depositRefunded ? "Deposit refunded" : `Deposit paid: ${formatTokens(p.depositAmountPaid)} USDC` : "No deposit paid"}
                      {" · "}{p.builderDeclared ? "Builder declared" : "No builder declaration"}
                      {p.isRefundEnabled ? " · Exceptional refund ON" : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {canForfeit(p) && (
                      <button onClick={() => forfeitDeposit(pkStr)} disabled={busy === pkStr} className="ui-btn ui-btn-red ui-btn-xs" title="Only forfeit 14+ days after results, if the builder never declared the project submitted">
                        {busy === pkStr ? "…" : "Forfeit deposit"}
                      </button>
                    )}
                    {canEnableRefund(p) && (
                      <button onClick={() => enableRefund(pkStr)} disabled={busy === "refund_" + pkStr} className="ui-btn ui-btn-amber ui-btn-xs">
                        {busy === "refund_" + pkStr ? "…" : "Enable refund override"}
                      </button>
                    )}
                    {p.isRefundEnabled && <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--c-amber-text)" }}>Refund override active</span>}
                  </div>
                </div>
                {msg.err && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{msg.err}</p>}
                {msg.ok && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{msg.ok}</p>}
                {refundMsg.err && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{refundMsg.err}</p>}
                {refundMsg.ok && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{refundMsg.ok}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SubmissionsSection (compact) ──────────────────────────────────────────────

function SubmissionsSection({ hackathons, adminAuth, hackathonFilter }: {
  hackathons: HackathonEntry[];
  adminAuth: AdminApiAuth;
  hackathonFilter: string;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    if (!adminAuth.ensureSession || !adminAuth.ready) { setSubmissions([]); return; }
    try {
      const response = await fetch("/api/admin/project-submissions", { cache: "no-store" });
      if (response.status === 401) { adminAuth.invalidateSession(); return; }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to load submissions");
      const hMap: Record<string, string> = {};
      for (const h of hackathons) hMap[h.pubkey.toBase58()] = h.name;
      setSubmissions((payload.data ?? []).map((r: any) => ({ ...r, hackathon_name: hMap[r.hackathon_pubkey] })));
    } catch (e: any) { setErr(e.message ?? "Failed"); }
  }

  useEffect(() => { void load(); }, [publicKey?.toBase58(), adminAuth.ready]);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    if (!adminAuth.ensureSession) return;
    setBusy(id); setErr(null); setOk(null);
    try {
      const sub = submissions.find((s) => s.id === id);
      if (!sub) throw new Error("Submission not found");
      const hackathon = hackathons.find((h) => h.pubkey.toBase58() === sub.hackathon_pubkey);
      if (!hackathon) throw new Error("Hackathon not found");

      if (status === "approved") {
        if (!publicKey || !anchorWallet) throw new Error("Connect the organizer wallet to approve on-chain submissions");
        if (!sub.project_pubkey) throw new Error("This submission is missing a project_pubkey");
        const builder = new PublicKey(sub.wallet_address);
        const project = new PublicKey(sub.project_pubkey);
        const normalized = normalizeGitHubUrl(sub.github_url);
        const urlHash = Array.from(await hashUrl(sub.github_url));
        const existingProject = await connection.getAccountInfo(project, "confirmed");
        if (!existingProject) {
          try {
            const program = getProgram(anchorWallet);
            const tx = await (program.methods as any).registerProject(normalized, urlHash)
              .accounts({ caller: publicKey, builder, hackathon: hackathon.pubkey, project, systemProgram: SystemProgram.programId })
              .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
              .transaction();
            await sendWalletTransactionWithConfirmation({ connection, feePayer: publicKey, sendTransaction, transaction: tx, verifySuccess: async () => Boolean(await connection.getAccountInfo(project, "confirmed")) });
          } catch (e: any) {
            const text = e.message ?? "";
            const logs = (e.logs ?? []) as string[];
            if (!text.includes("already in use") && !text.includes("already been processed") && !logs.some((l: string) => l.includes("already in use"))) throw e;
          }
        }
      }

      await adminAuth.ensureSession();
      const response = await fetch("/api/admin/project-submissions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: id, status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to update submission");
      setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
      setOk(status === "approved" ? "Submission approved and project registered on-chain." : "Submission rejected.");
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  const visible = submissions.filter((s) => s.hackathon_pubkey === hackathonFilter && s.status === "pending");
  if (visible.length === 0) return null;

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 12px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>Pending Submissions</h3>
      {err && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {visible.map((s) => (
          <div key={s.id} style={{ borderRadius: "12px", padding: "16px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>{s.project_name?.trim() || s.github_url.replace("https://github.com/", "")}</p>
                <a href={s.github_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", color: "var(--c-indigo-text)", textDecoration: "none" }}>{s.github_url.replace("https://github.com/", "")}</a>
                <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-3)" }}>{s.wallet_address.slice(0, 8)}…{s.wallet_address.slice(-4)}{s.auth_email && ` · ${s.auth_email}`}</p>
                <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                  {s.twitter_handle && <span>𝕏 @{s.twitter_handle}</span>}
                  {s.telegram && <span>✈ {s.telegram}</span>}
                  {s.discord && <span>💬 {s.discord}</span>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button onClick={() => updateStatus(s.id, "approved")} disabled={busy === s.id} className="ui-btn ui-btn-emerald ui-btn-xs">{busy === s.id ? "…" : "Approve"}</button>
                <button onClick={() => updateStatus(s.id, "rejected")} disabled={busy === s.id} className="ui-btn ui-btn-outline-red ui-btn-xs">Reject</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AdvancedHackathonCard ─────────────────────────────────────────────────────

function AdvancedHackathonCard({ hackathon, adminAuth }: { hackathon: HackathonEntry; adminAuth: AdminApiAuth }) {
  const [expanded, setExpanded] = useState(false);
  const phase = hackathonPhase(hackathon);
  return (
    <div className="ui-card">
      <button onClick={() => setExpanded((v) => !v)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: "var(--c-text)" }}>{hackathon.name || hackathon.pubkey.toBase58().slice(0, 16) + "…"}</p>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Deadline: {formatDate(hackathon.irlHackathonDeadlineTimestamp)} · {formatTokens(hackathon.totalPool)} USDC · <span style={{ color: PHASE_COLOR[phase], fontWeight: 600 }}>{PHASE_LABEL[phase]}</span></p>
        </div>
        <span style={{ color: "var(--c-text-4)" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--c-divider-2)", padding: "0 24px 24px" }}>
          <SubmissionsSection hackathons={[hackathon]} adminAuth={adminAuth} hackathonFilter={hackathon.pubkey.toBase58()} />
          <HackathonWhitelistPanel hackathon={hackathon} />
          <DepositManagementPanel hackathon={hackathon} adminAuth={adminAuth} />
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdvancedPage() {
  const { publicKey, signMessage } = useWallet();
  const { hackathons, loading } = useHackathons();
  const { isProtocolAdmin, isSuperAdmin } = useIsProtocolAdmin(publicKey ?? null);
  const managesHackathons = publicKey ? hackathons.some((h) => h.admin.equals(publicKey)) : false;
  const isAdmin = isProtocolAdmin || managesHackathons;

  const [adminSessionReady, setAdminSessionReady] = useState(false);
  const [adminSessionBusy, setAdminSessionBusy] = useState(false);
  const [adminSessionErr, setAdminSessionErr] = useState<string | null>(null);
  const [advancedAllowed, setAdvancedAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    clearAdminSessionCache();
    setAdminSessionReady(false);
    setAdminSessionErr(null);
    async function loadSession() {
      if (!publicKey || !signMessage || !isAdmin) return;
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) return;
        const payload = await res.json() as { wallet_address?: string };
        if (payload.wallet_address !== publicKey.toBase58()) {
          await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
          return;
        }
        if (!cancelled) setAdminSessionReady(true);
      } catch { if (!cancelled) setAdminSessionReady(false); }
    }
    void loadSession();
    return () => { cancelled = true; };
  }, [publicKey?.toBase58(), Boolean(signMessage), isAdmin]);

  useEffect(() => {
    if (!publicKey) { setAdvancedAllowed(null); return; }
    fetch("/api/admin/advanced-access")
      .then((r) => r.json())
      .then((payload) => {
        const wallets: string[] = payload.wallets ?? [];
        setAdvancedAllowed(wallets.includes(publicKey.toBase58()));
      })
      .catch(() => setAdvancedAllowed(false));
  }, [publicKey?.toBase58()]);

  async function startAdminSession() {
    if (!signMessage || !publicKey) throw new Error("Your wallet must support message signing");
    await ensureAdminSession(signMessage, publicKey);
  }

  function invalidateAdminSession(message = "Admin session expired. Sign in again.") {
    clearAdminSessionCache();
    setAdminSessionReady(false);
    setAdminSessionBusy(false);
    setAdminSessionErr(message);
    void fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
  }

  async function handleAdminSignIn() {
    setAdminSessionBusy(true);
    setAdminSessionErr(null);
    try { await startAdminSession(); setAdminSessionReady(true); }
    catch (e: any) { setAdminSessionReady(false); setAdminSessionErr(e?.message ?? "Failed to sign in as admin"); }
    finally { setAdminSessionBusy(false); }
  }

  const adminAuth: AdminApiAuth = {
    ensureSession: publicKey && signMessage ? startAdminSession : null,
    invalidateSession: invalidateAdminSession,
    ready: adminSessionReady,
  };

  const visibleHackathons = isSuperAdmin || !publicKey
    ? hackathons
    : hackathons.filter((h) => h.admin.equals(publicKey!));

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ margin: "0 auto", maxWidth: "768px", padding: "40px 16px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ margin: 0, fontSize: "1.875rem", fontWeight: 800, color: "var(--c-text)" }}>Advanced</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Submission review, staker access, and deposit overrides.</p>
        </div>

        {!isAdmin && (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
            Access restricted. Connect a protocol admin or assigned hackathon admin wallet.
          </div>
        )}

        {isAdmin && !adminSessionReady && (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "16px" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-amber-text)" }}>Click here to sign in as admin. This signature does not cost gas.</p>
            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <button onClick={() => void handleAdminSignIn()} disabled={adminSessionBusy || !signMessage} className="ui-btn ui-btn-indigo ui-btn-sm">
                {adminSessionBusy ? "Waiting for signature..." : "Sign In As Admin"}
              </button>
              {!signMessage && <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>This wallet must support message signing.</span>}
            </div>
            {adminSessionErr && <p style={{ margin: "10px 0 0", fontSize: "0.8125rem", color: "var(--c-red-text)" }}>{adminSessionErr}</p>}
          </div>
        )}

        {isAdmin && adminSessionReady && (
          advancedAllowed === null ? (
            <div className="ui-skeleton" style={{ height: "64px", borderRadius: "16px" }} />
          ) : !advancedAllowed ? (
            <div style={{ borderRadius: "16px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "24px" }}>
              <p style={{ margin: 0, fontWeight: 700, color: "var(--c-red-text)" }}>Access restricted</p>
              <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
                This wallet is not on the Advanced panel access list. Contact the super-admin to request access.
              </p>
            </div>
          ) : loading ? (
            <div className="ui-skeleton" style={{ height: "80px", borderRadius: "16px" }} />
          ) : visibleHackathons.length === 0 ? (
            <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No hackathons assigned to this wallet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {visibleHackathons.map((h) => (
                <AdvancedHackathonCard key={h.pubkey.toBase58()} hackathon={h} adminAuth={adminAuth} />
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
}
