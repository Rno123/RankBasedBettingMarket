"use client";

import { useState, useEffect, useMemo } from "react";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import Navbar from "@/components/Navbar";
import { getProgram } from "@/lib/program";
import { hackathonPda, escrowPda, hashUrl, normalizeGitHubUrl, whitelistPda, protocolAdminPda } from "@/lib/pda";
import { useHackathons } from "@/hooks/useHackathons";
import { useProjects } from "@/hooks/useProjects";
import { formatTokens, formatDate } from "@/lib/format";
import { USDC_MINT, PROTOCOL_ADMIN, DEPLOYER } from "@/lib/constants";
import { clearAdminSessionCache, ensureAdminSession } from "@/lib/client-admin-auth";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";
import { getSupabase } from "@/lib/supabase";

interface AdminApiAuth {
  ensureSession: (() => Promise<void>) | null;
  invalidateSession: (message?: string) => void;
  ready: boolean;
}

interface WhitelistRequest {
  id: string;
  hackathon_pubkey: string;
  wallet_address: string;
  email: string;
  notes?: string | null;
  status: string;
  created_at: string;
}

type HackathonEntry = ReturnType<typeof useHackathons>["hackathons"][number];
type HackathonPhase = "active" | "resolving" | "resolved";

function hackathonPhase(h: HackathonEntry): HackathonPhase {
  if (h.isResolved) return "resolved";
  const now = Math.floor(Date.now() / 1000);
  if (now >= h.cutoffTimestamp) return "resolving";
  return "active";
}

const PHASE_LABEL: Record<HackathonPhase, string> = {
  active: "Active",
  resolving: "Resolving",
  resolved: "Resolved",
};

const PHASE_COLOR: Record<HackathonPhase, string> = {
  active: "var(--c-indigo-text)",
  resolving: "var(--c-amber-text)",
  resolved: "var(--c-emerald-text)",
};

function groupByPhase(hackathons: HackathonEntry[]): Record<HackathonPhase, HackathonEntry[]> {
  return {
    active: hackathons.filter((h) => hackathonPhase(h) === "active"),
    resolving: hackathons.filter((h) => hackathonPhase(h) === "resolving"),
    resolved: hackathons.filter((h) => hackathonPhase(h) === "resolved"),
  };
}

const RESULTS_DATE_STEP_SECONDS = 30 * 60;
const TIME_OPTIONS_30MIN = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});
type ResultsDateParse =
  | { timestamp: number; error?: never }
  | { timestamp?: never; error: string };
const TX_CONFIRM_TIMEOUT_MS = 30_000;

function getProtocolAdminRemainingAccounts(
  publicKey: PublicKey | null,
  hackathonAdmin?: PublicKey,
) {
  if (!publicKey) return [];
  if (publicKey.toBase58() === PROTOCOL_ADMIN) return [];
  if (hackathonAdmin && hackathonAdmin.equals(publicKey)) return [];
  return [{
    pubkey: protocolAdminPda(publicKey),
    isWritable: false,
    isSigner: false,
  }];
}

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

async function ensureWalletWhitelistedOnHackathon(
  program: any,
  admin: PublicKey,
  hackathonPubkey: PublicKey,
  hackathonAdmin: PublicKey,
  wallet: PublicKey,
  openStaking?: boolean,
) {
  // When open_staking is true the program skips whitelist PDA checks,
  // so there's nothing to write on-chain — approval lives in Supabase only.
  if (openStaking) return;

  const whitelistEntry = whitelistPda(hackathonPubkey, wallet);
  try {
    await (program.methods as any)
      .whitelistWallet()
      .accounts({
        admin,
        hackathon: hackathonPubkey,
        wallet,
        whitelistEntry,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(getProtocolAdminRemainingAccounts(admin, hackathonAdmin))
      .rpc();
  } catch (e: any) {
    const text = e.message ?? "";
    if (!text.includes("already in use")) {
      throw e;
    }
  }
}

async function ensureWalletWhitelistedAcrossHackathons(
  program: any,
  admin: PublicKey,
  hackathons: Array<Pick<HackathonEntry, "pubkey" | "admin" | "openStaking">>,
  wallet: PublicKey,
) {
  for (const hackathon of hackathons) {
    await ensureWalletWhitelistedOnHackathon(
      program,
      admin,
      hackathon.pubkey,
      hackathon.admin,
      wallet,
      hackathon.openStaking,
    );
  }
}

async function fetchApprovedWhitelistWallets(adminAuth: AdminApiAuth) {
  if (!adminAuth.ensureSession || !adminAuth.ready) return [] as string[];
  await adminAuth.ensureSession();

  const response = await fetch("/api/admin/whitelist-requests", {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load approved stakers");
  }

  return [...new Set(
    ((payload.data ?? []) as WhitelistRequest[])
      .filter((request) => request.status === "approved")
      .map((request) => request.wallet_address),
  )];
}

// ── Admin Delegation ──────────────────────────────────────────────────────────

function AdminDelegationPanel() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [newAdminInput, setNewAdminInput] = useState("");
  const [delegatedAdmins, setDelegatedAdmins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const isSuperAdmin = publicKey?.toBase58() === PROTOCOL_ADMIN;

  useEffect(() => {
    async function load() {
      try {
        const { getReadonlyProgram } = await import("@/lib/program");
        const roProgram = getReadonlyProgram();
        const entries = await (roProgram.account as any).protocolAdminEntry.all();
        setDelegatedAdmins(entries.map((e: any) => (e.account.wallet ?? e.account.admin ?? e.publicKey).toBase58()));
      } catch { setDelegatedAdmins([]); }
      finally { setLoading(false); }
    }
    load();
  }, [ok]);

  async function addAdmin() {
    if (!publicKey || !anchorWallet) return;
    let wallet: PublicKey;
    try { wallet = new PublicKey(newAdminInput.trim()); } catch { setErr("Invalid public key"); return; }
    setBusy("add"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const adminEntry = protocolAdminPda(wallet);
      await (program.methods as any).addProtocolAdmin().accounts({
        authority: publicKey,
        newAdmin: wallet,
        adminEntry,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setOk(`Granted admin: ${wallet.toBase58().slice(0, 8)}…`);
      setNewAdminInput("");
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function removeAdmin(adminWallet: string) {
    if (!publicKey || !anchorWallet) return;
    const wallet = new PublicKey(adminWallet);
    setBusy(adminWallet); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const adminEntry = protocolAdminPda(wallet);
      await (program.methods as any).removeProtocolAdmin().accounts({
        authority: publicKey,
        adminWallet: wallet,
        adminEntry,
      }).rpc();
      setOk(`Revoked admin: ${adminWallet.slice(0, 8)}…`);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Admin Delegation</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Grant or revoke protocol admin role. Only the super-admin (<code style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{PROTOCOL_ADMIN.slice(0, 8)}…</code>) can call this on-chain.
      </p>
      {!isSuperAdmin && (
        <div style={{ marginBottom: "16px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.875rem", color: "var(--c-amber-text)" }}>
          Connect the super-admin wallet to grant or revoke admins.
        </div>
      )}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input
          value={newAdminInput}
          onChange={(e) => { setNewAdminInput(e.target.value); setErr(null); }}
          placeholder="Wallet address to grant admin…"
          className="ui-input"
          style={{ flex: 1, fontFamily: "monospace" }}
          disabled={!isSuperAdmin}
        />
        <button onClick={addAdmin} disabled={busy === "add" || !isSuperAdmin || !newAdminInput.trim()} className="ui-btn ui-btn-indigo ui-btn-sm">
          {busy === "add" ? "…" : "Grant"}
        </button>
      </div>
      {err && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      <div>
        <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
          Delegated admins {loading ? "" : `(${delegatedAdmins.length})`}
        </p>
        {loading ? (
          <div className="ui-skeleton" style={{ height: "32px", borderRadius: "8px" }} />
        ) : delegatedAdmins.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No delegated admins.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {delegatedAdmins.map((addr) => (
              <div key={addr} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", borderRadius: "8px", border: "1px solid var(--c-divider)", padding: "8px 12px" }}>
                <code style={{ fontSize: "0.75rem", color: "var(--c-text-2)" }}>{addr}</code>
                <button
                  onClick={() => removeAdmin(addr)}
                  disabled={busy === addr || !isSuperAdmin}
                  className="ui-btn ui-btn-outline-red ui-btn-xs"
                >
                  {busy === addr ? "…" : "Revoke"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Deposit management (per hackathon) ────────────────────────────────────────

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
    try {
      wallet = new PublicKey(walletInput.trim());
    } catch {
      setErr("Invalid public key");
      return;
    }

    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const program = getProgram(anchorWallet);
      await ensureWalletWhitelistedOnHackathon(
        program,
        publicKey,
        hackathon.pubkey,
        hackathon.admin,
        wallet,
        hackathon.openStaking,
      );
      setOk(
        `Granted staking access on ${hackathon.name || hackathon.pubkey.toBase58().slice(0, 8)} for ${wallet.toBase58().slice(0, 8)}...${wallet.toBase58().slice(-4)}.`,
      );
      setWalletInput("");
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>
        Staker access
      </h3>
      <p style={{ margin: "0 0 12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
        Grant staking access for this hackathon only. This writes the on-chain whitelist PDA for the selected wallet.
      </p>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <input
          value={walletInput}
          onChange={(e) => {
            setWalletInput(e.target.value);
            setErr(null);
          }}
          placeholder="Wallet address to whitelist for this hackathon..."
          className="ui-input"
          style={{ flex: 1, minWidth: "220px", fontFamily: "monospace" }}
        />
        <button
          onClick={handleWhitelist}
          disabled={busy || !publicKey || !walletInput.trim()}
          className="ui-btn ui-btn-indigo ui-btn-sm"
        >
          {busy ? "..." : "Grant access"}
        </button>
      </div>
      {err && <p style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
    </div>
  );
}

function DepositManagementPanel({ hackathon, view }: { hackathon: HackathonEntry; view: "resolutions" | "advanced" }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { projects } = useProjects(hackathon.pubkey);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok?: string; err?: string }>>({});
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  if (hackathon.depositAmount === 0n) return null;

  const approvalEligible = projects.filter(
    (p) =>
      p.depositAmountPaid > 0n &&
      !p.depositForfeited &&
      !p.depositRefunded &&
      p.builderDeclared &&
      !p.submitted,
  );

  const canForfeit = (project: (typeof projects)[number]) =>
    project.depositAmountPaid > 0n &&
    !project.depositForfeited &&
    !project.depositRefunded &&
    !project.builderDeclared &&
    !project.submitted;

  // For view filtering — which projects have relevant actions?
  const hasResolutionsAction = (p: (typeof projects)[number]) =>
    p.builderDeclared && !p.submitted && !p.depositForfeited && !p.depositRefunded;
  const canEnableRefund = (p: (typeof projects)[number]) =>
    !p.isRefundEnabled && !(hackathon.isResolved && p.rank > 0);
  const hasAdvancedAction = (p: (typeof projects)[number]) =>
    canForfeit(p) || canEnableRefund(p);

  async function approveProjectPubkeys(projectPubkeys: PublicKey[]) {
    if (!publicKey || !anchorWallet || projectPubkeys.length === 0) return;
    const program = getProgram(anchorWallet);
    const tx = await (program.methods as any)
      .approveSubmissions()
      .accounts({
        admin: publicKey,
        hackathon: hackathon.pubkey,
      })
      .remainingAccounts([
        ...getProtocolAdminRemainingAccounts(publicKey, hackathon.admin),
        ...projectPubkeys.map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        })),
      ])
      .transaction();

    await sendWalletTransactionWithConfirmation({
      connection,
      feePayer: publicKey,
      sendTransaction,
      transaction: tx,
    });
  }

  async function approveAllDeclared() {
    if (approvalEligible.length === 0) return;
    setBusy("bulk_approve");
    setBulkResult(null);
    try {
      await approveProjectPubkeys(approvalEligible.map((project) => project.pubkey));
      setBulkResult(`Released ${approvalEligible.length} deposit${approvalEligible.length === 1 ? "" : "s"} on-chain.`);
      setMessages((current) => {
        const next = { ...current };
        for (const project of approvalEligible) {
          next["approve_" + project.pubkey.toBase58()] = { ok: "Deposit released on-chain" };
        }
        return next;
      });
    } catch (e: any) {
      setBulkResult(e.message ?? "Bulk approval failed");
    } finally {
      setBusy(null);
    }
  }

  async function approveSingle(projectPubkey: string) {
    if (!publicKey || !anchorWallet) return;
    setBusy("approve_" + projectPubkey);
    setMessages((m) => ({ ...m, ["approve_" + projectPubkey]: {} }));
    try {
      await approveProjectPubkeys([new PublicKey(projectPubkey)]);
      setMessages((m) => ({ ...m, ["approve_" + projectPubkey]: { ok: "Deposit released on-chain" } }));
    } catch (e: any) {
      setMessages((m) => ({ ...m, ["approve_" + projectPubkey]: { err: e.message ?? "Failed" } }));
    } finally {
      setBusy(null);
    }
  }

  async function forfeitDeposit(projectPubkey: string) {
    if (!publicKey || !anchorWallet) return;
    setBusy(projectPubkey);
    setMessages((m) => ({ ...m, [projectPubkey]: {} }));
    try {
      const program = getProgram(anchorWallet);
      const feeRecipientAta = getAssociatedTokenAddressSync(hackathon.usdcMint, hackathon.feeRecipient);
      const escrow = escrowPda(hackathon.pubkey);
      await (program.methods as any)
        .forfeitDeposit()
        .accounts({
          admin: publicKey,
          hackathon: hackathon.pubkey,
          project: new PublicKey(projectPubkey),
          feeRecipientTokenAccount: feeRecipientAta,
          escrow,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
        .rpc();
      setMessages((m) => ({ ...m, [projectPubkey]: { ok: "Forfeited" } }));
    } catch (e: any) {
      setMessages((m) => ({ ...m, [projectPubkey]: { err: e.message ?? "Failed" } }));
    } finally { setBusy(null); }
  }

  async function enableRefund(projectPubkey: string) {
    if (!publicKey || !anchorWallet) return;
    setBusy("refund_" + projectPubkey);
    setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: {} }));
    try {
      const program = getProgram(anchorWallet);
      await (program.methods as any)
        .enableRefund()
        .accounts({
          admin: publicKey,
          hackathon: hackathon.pubkey,
          project: new PublicKey(projectPubkey),
        })
        .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
        .rpc();
      setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: { ok: "Exceptional refund enabled" } }));
    } catch (e: any) {
      setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: { err: e.message ?? "Failed" } }));
    } finally { setBusy(null); }
  }

  const visibleProjects = view === "resolutions"
    ? projects.filter(hasResolutionsAction)
    : projects.filter(hasAdvancedAction);

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>
        Deposit management
      </h3>
      <p style={{ margin: "0 0 12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
        Builders claim deposit refunds themselves. This panel controls the approval gate for refund-locked hackathons plus the emergency override and forfeit paths.
      </p>

      {view === "resolutions" && (
        <div style={{ marginBottom: "16px", borderRadius: "10px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 2px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-emerald-text)" }}>Release builder deposits</p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-3)" }}>
                Builder deposits unlock only after organizer approval. Eligible now: {approvalEligible.length}.
              </p>
            </div>
            <button
              onClick={approveAllDeclared}
              disabled={busy === "bulk_approve" || approvalEligible.length === 0}
              className="ui-btn ui-btn-emerald ui-btn-sm"
              style={{ flexShrink: 0 }}
            >
              {busy === "bulk_approve"
                ? "Releasing…"
                : approvalEligible.length === 0 ? "Nothing pending" : "Release all deposits"}
            </button>
          </div>
          {bulkResult && (
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", fontWeight: 500, color: bulkResult.toLowerCase().includes("failed") ? "var(--c-red-text)" : "var(--c-emerald-text)" }}>
              {bulkResult}
            </p>
          )}
        </div>
      )}

      {view === "advanced" && (
        <>
          <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.75rem", color: "var(--c-amber-text)" }}>
            <strong>Forfeit deposit</strong> is only valid at least 14 days after the hackathon&apos;s results date, and only if the builder never declared the project as submitted.
          </div>
          <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "10px 14px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>
            <strong>Enable refund override</strong> is the exceptional path. It enables stake refunds and also bypasses the normal builder deposit checks, so it should only be used for cancellations, judging mistakes, or explicit organizer exceptions.
          </div>
        </>
      )}

      {visibleProjects.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>
          {view === "resolutions" ? "No pending builder declarations awaiting approval." : "No projects with advanced deposit actions."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {visibleProjects.map((p) => {
            const repoShort = p.githubUrl.replace("https://github.com/", "");
            const pkStr = p.pubkey.toBase58();
            const msg = messages[pkStr] ?? {};
            const approveMsg = messages["approve_" + pkStr] ?? {};
            const refundMsg = messages["refund_" + pkStr] ?? {};
            return (
              <div key={pkStr} style={{ borderRadius: "10px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "240px" }}>{repoShort}</p>
                    <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                      {p.depositAmountPaid > 0n
                        ? p.depositForfeited ? "Deposit forfeited"
                        : p.depositRefunded ? "Deposit refunded"
                        : `Deposit paid: ${formatTokens(p.depositAmountPaid)} USDC`
                        : "No deposit paid"}
                      {" · "}{p.builderDeclared ? "Builder declared" : "No builder declaration"}
                      {" · "}
                      {p.submitted
                        ? "Organizer approved"
                        : p.builderDeclared
                          ? "Awaiting approval"
                          : "Waiting on builder declaration"}
                      {p.isRefundEnabled ? " · Exceptional refund ON" : ""}
                    </p>
                    <div style={{ display: "flex", gap: "4px", marginTop: "5px", flexWrap: "wrap" }}>
                      {!p.builderDeclared && (
                        <span title="Registered but not yet declared" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "var(--c-divider-2)", color: "var(--c-text-4)", border: "1px solid var(--c-divider)" }}>⚑ Registered</span>
                      )}
                      {p.builderDeclared && (
                        <span title="Builder declared submission" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "var(--c-amber-light)", color: "var(--c-amber-text)", border: "1px solid var(--c-amber-border)" }}>⚑ Declared</span>
                      )}
                      {p.submitted && (
                        <span title="Organizer approved submission" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>⚑ Approved</span>
                      )}
                      {p.depositRefunded && (
                        <span title="Deposit refunded to builder" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>✓ Refunded</span>
                      )}
                      {p.depositForfeited && (
                        <span title="Deposit forfeited to protocol" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "var(--c-red-light)", color: "var(--c-red-text)", border: "1px solid var(--c-red-border)" }}>✗ Forfeited</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {view === "resolutions" && p.builderDeclared && !p.submitted && !p.depositForfeited && !p.depositRefunded && (
                      <button
                        onClick={() => approveSingle(pkStr)}
                        disabled={busy === "approve_" + pkStr}
                        className="ui-btn ui-btn-emerald ui-btn-xs"
                      >
                        {busy === "approve_" + pkStr ? "…" : "Release deposit"}
                      </button>
                    )}
                    {view === "advanced" && canForfeit(p) && (
                      <button
                        onClick={() => forfeitDeposit(pkStr)}
                        disabled={busy === pkStr}
                        className="ui-btn ui-btn-red ui-btn-xs"
                        title="Only forfeit 14+ days after results, if the builder never declared the project submitted"
                      >
                        {busy === pkStr ? "…" : "Forfeit deposit"}
                      </button>
                    )}
                    {view === "advanced" && canEnableRefund(p) && (
                      <button
                        onClick={() => enableRefund(pkStr)}
                        disabled={busy === "refund_" + pkStr}
                        className="ui-btn ui-btn-amber ui-btn-xs"
                      >
                        {busy === "refund_" + pkStr ? "…" : "Enable refund override"}
                      </button>
                    )}
                    {view === "advanced" && p.isRefundEnabled && (
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--c-amber-text)" }}>Refund override active</span>
                    )}
                  </div>
                </div>
                {msg.err && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{msg.err}</p>}
                {msg.ok && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{msg.ok}</p>}
                {approveMsg.err && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{approveMsg.err}</p>}
                {approveMsg.ok && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{approveMsg.ok}</p>}
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

// ── Create Hackathon ──────────────────────────────────────────────────────────

function CreateHackathonPanel({
  onCreated,
  adminAuth,
}: {
  onCreated: () => void;
  adminAuth: AdminApiAuth;
}) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [step, setStep] = useState<1 | 2>(1);
  const [hackathonName, setHackathonName] = useState("");
  const [resultsDatePart, setResultsDatePart] = useState("");
  const [resultsTimePart, setResultsTimePart] = useState("12:00");
  const [numTiers, setNumTiers] = useState<number>(3);
  const [protocolFeeBps, setProtocolFeeBps] = useState("150");
  const [depositAmountUsdc, setDepositAmountUsdc] = useState("10");
  const [tierPcts, setTierPcts] = useState<string[]>(["55", "30", "15"]);
  const [tierCounts, setTierCounts] = useState<string[]>(["1", "1", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [openRegistration, setOpenRegistration] = useState(true);
  const [openStaking, setOpenStaking] = useState(true);
  const [earlyCutoff, setEarlyCutoff] = useState(false);
  const [cutoffHours, setCutoffHours] = useState(24);

  function parseResultsDateInput(value: string): ResultsDateParse {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { error: "Results date must be valid" as const };
    }
    if (date.getMinutes() % 30 !== 0 || date.getSeconds() !== 0 || date.getMilliseconds() !== 0) {
      return { error: "Results date must use 30-minute intervals" as const };
    }
    return { timestamp: Math.floor(date.getTime() / 1000) };
  }

  function handleNumTiersChange(n: number) {
    const clamped = Math.min(Math.max(1, n), 8);
    setNumTiers(clamped);
    setTierPcts((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push("");
      return next.slice(0, clamped);
    });
    setTierCounts((prev) => {
      const next = [...prev];
      while (next.length < clamped) next.push("");
      next[clamped - 1] = "";
      return next.slice(0, clamped);
    });
    setErr(null);
  }

  function handleStep1Next() {
    setErr(null);
    const trimmedName = hackathonName.trim();
    if (!trimmedName) { setErr("Hackathon name is required"); return; }
    if (new TextEncoder().encode(trimmedName).length > 32) { setErr("Name exceeds 32 bytes"); return; }
    if (!/^[\x20-\x7E]+$/.test(trimmedName)) { setErr("Name must contain only ASCII characters"); return; }
    if (!resultsDatePart) { setErr("Results date is required"); return; }
    const parsedResults = parseResultsDateInput(`${resultsDatePart}T${resultsTimePart}`);
    if (parsedResults.error !== undefined) { setErr(parsedResults.error); return; }
    const resultsTs = parsedResults.timestamp;
    if (resultsTs < Math.floor(Date.now() / 1000)) { setErr("Results date must be in the future"); return; }
    if (numTiers < 1 || numTiers > 8) { setErr("Tiers must be 1–8"); return; }
    const feeBps = parseInt(protocolFeeBps);
    if (isNaN(feeBps) || feeBps < 0 || feeBps > 10000) { setErr("Protocol fee must be 0–10000 bps"); return; }
    const depositLamports = Math.round(parseFloat(depositAmountUsdc) * 1_000_000);
    if (isNaN(depositLamports) || depositLamports < 0) { setErr("Deposit amount must be ≥ 0"); return; }
    setStep(2);
  }

  async function handleCreate() {
    if (!publicKey || !anchorWallet) return;
    setErr(null);
    const pcts = tierPcts.map((v) => parseInt(v));
    const counts = tierCounts.map((v) => parseInt(v));
    if (pcts.some(isNaN) || pcts.some((v) => v < 0)) { setErr("All tier % must be ≥ 0"); return; }
    if (pcts.reduce((a, b) => a + b, 0) !== 100) { setErr("Tier % must sum to 100"); return; }
    for (let i = 0; i < numTiers - 1; i++) {
      if (isNaN(counts[i]) || counts[i] < 1) { setErr(`Tier ${i + 1} count must be ≥ 1`); return; }
    }
    setBusy(true);
    try {
      const trimmedName = hackathonName.trim();
      const parsedResults = parseResultsDateInput(`${resultsDatePart}T${resultsTimePart}`);
      if (parsedResults.error !== undefined) {
        throw new Error(parsedResults.error);
      }
      const resultsTs = parsedResults.timestamp;
      const feeRecipient = new PublicKey(DEPLOYER);
      const feeBps = parseInt(protocolFeeBps);
      const depositLamports = new BN(Math.round(parseFloat(depositAmountUsdc) * 1_000_000));
      const program = getProgram(anchorWallet);
      const hackathon = hackathonPda(publicKey, trimmedName);
      const escrow = escrowPda(hackathon);
      await (program.methods as any)
        .initializeHackathon(trimmedName, new BN(resultsTs), Buffer.from(pcts), Buffer.from(counts), feeRecipient, feeBps, depositLamports, !openRegistration, openStaking, new BN(earlyCutoff ? cutoffHours * 3_600 : 0))
        .accounts({ admin: publicKey, hackathon, escrow, usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey))
        .rpc();
      try {
        if (adminAuth.ensureSession) {
          await adminAuth.ensureSession();
          await fetch("/api/admin/hackathon-created", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hackathon_pubkey: hackathon.toBase58(),
              name: trimmedName,
              admin_wallet: publicKey.toBase58(),
              results_timestamp: resultsTs,
              num_tiers: numTiers,
              tier_pcts: pcts,
              tier_counts: counts,
              fee_recipient: feeRecipient.toBase58(),
              protocol_fee_bps: feeBps,
              deposit_amount: Math.round(parseFloat(depositAmountUsdc) * 1_000_000),
              requires_approval: !openRegistration,
              open_staking: openStaking,
            }),
          });
        }
      } catch (logErr) {
        console.warn("Failed to log hackathon creation to Supabase:", logErr);
      }
      let inheritedCount = 0;
      try {
        const approvedWallets = await fetchApprovedWhitelistWallets(adminAuth);
        for (const walletAddress of approvedWallets) {
          await ensureWalletWhitelistedOnHackathon(
            program,
            publicKey,
            hackathon,
            publicKey,
            new PublicKey(walletAddress),
            openStaking,
          );
          inheritedCount += 1;
        }
      } catch (inheritErr: any) {
        setErr(`Hackathon created, but failed to inherit approved stakers: ${inheritErr.message ?? "Unknown error"}`);
      }
      setOk(
        inheritedCount > 0
          ? `Hackathon "${trimmedName}" created. Inherited ${inheritedCount} globally approved staker${inheritedCount === 1 ? "" : "s"}.`
          : `Hackathon "${trimmedName}" created.`,
      );
      onCreated();
    } catch (e: any) {
      const logs: string[] | undefined = typeof e.getLogs === "function" ? await e.getLogs() : e.logs;
      const alreadyInUse = (e.message ?? "").includes("already in use") || (logs ?? []).some((l: string) => l.includes("already in use"));
      const alreadyProcessed = (e.message ?? "").includes("already been processed");
      if (alreadyProcessed) return;
      setErr(alreadyInUse ? `A hackathon named "${hackathonName.trim()}" already exists.` : logs?.length ? logs.join("\n") : (e.message ?? "Failed"));
    } finally { setBusy(false); }
  }

  const inputStyle: React.CSSProperties = { width: "100%", borderRadius: "12px", border: "1px solid var(--c-input-border)", background: "var(--c-input-bg)", padding: "8px 12px", fontSize: "0.875rem", color: "var(--c-input-text)", outline: "none", fontFamily: "inherit" };
  const labelStyle: React.CSSProperties = { display: "block", marginBottom: "4px", fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)" };

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Create Hackathon</h2>
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input className="ui-input" placeholder="e.g. Frontier S1" maxLength={32} value={hackathonName} onChange={(e) => { if (/^[\x20-\x7E]*$/.test(e.target.value)) setHackathonName(e.target.value); }} />
          </div>
          <div>
            <label style={labelStyle}>Hackathon Deadline</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="date"
                className="ui-input"
                style={{ flex: 1 }}
                value={resultsDatePart}
                onChange={(e) => setResultsDatePart(e.target.value)}
              />
              <select
                className="ui-input"
                style={{ width: "120px" }}
                value={resultsTimePart}
                onChange={(e) => setResultsTimePart(e.target.value)}
              >
                {TIME_OPTIONS_30MIN.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>Time is in your local timezone.</p>
          </div>
          <div className="grid-auto-2" style={{ gap: "12px" }}>
            <div>
              <label style={labelStyle}>Number of tiers (1–8)</label>
              <input type="number" min={1} max={8} className="ui-input" value={numTiers} onChange={(e) => handleNumTiersChange(parseInt(e.target.value))} />
            </div>
            <div>
              <label style={labelStyle}>Builder deposit (USDC)</label>
              <input type="number" min={0} step="0.01" className="ui-input" value={depositAmountUsdc} onChange={(e) => setDepositAmountUsdc(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Protocol fee (bps)</label>
            <input type="number" min={0} max={10000} className="ui-input" value={protocolFeeBps} onChange={(e) => setProtocolFeeBps(e.target.value)} />
            <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>150 = 1.5%</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", borderRadius: "12px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "12px" }}>
            <input
              type="checkbox"
              id="openStakingToggle"
              checked={openStaking}
              onChange={(e) => setOpenStaking(e.target.checked)}
              style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0 }}
            />
            <div>
              <label htmlFor="openStakingToggle" style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--c-text)", cursor: "pointer" }}>Open staking</label>
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                Anyone can stake (no on-chain whitelist check). Uncheck to enforce per-wallet whitelist PDAs. When unchecked, whitelist is enforced on-chain so each new whitelisted wallet requires a separate on-chain transaction. Leave checked if you&apos;re unsure what this means.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", borderRadius: "12px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "12px" }}>
            <input
              type="checkbox"
              id="openRegistrationToggle"
              checked={openRegistration}
              onChange={(e) => setOpenRegistration(e.target.checked)}
              style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0 }}
            />
            <div>
              <label htmlFor="openRegistrationToggle" style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--c-text)", cursor: "pointer" }}>Open registration</label>
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                Builders register their project on-chain directly — no admin review step. When unchecked, builders submit for review and an admin must approve before the project appears on-chain. Leave checked if you&apos;re unsure what this means.
              </p>
            </div>
          </div>
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "12px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <input
                type="checkbox"
                id="earlyCutoffToggle"
                checked={earlyCutoff}
                onChange={(e) => setEarlyCutoff(e.target.checked)}
                style={{ width: "16px", height: "16px", cursor: "pointer", flexShrink: 0, marginTop: "2px" }}
              />
              <div style={{ flex: 1 }}>
                <label htmlFor="earlyCutoffToggle" style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--c-text)", cursor: "pointer" }}>Staking cutoff</label>
                <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                  Enable staking lock before the hackathon deadline.
                </p>
                {earlyCutoff && (
                  <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <label style={{ fontSize: "0.8125rem", color: "var(--c-text-2)", whiteSpace: "nowrap" }}>Staking cutoff</label>
                    <select
                      className="ui-input"
                      style={{ width: "100px" }}
                      value={cutoffHours}
                      onChange={(e) => setCutoffHours(parseInt(e.target.value))}
                    >
                      {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                        <option key={h} value={h}>{h}h before results</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "12px", fontSize: "0.875rem", color: "var(--c-indigo-text)" }}>
            Each tier gets a % of the total prize pool. The <strong>last tier</strong> automatically includes all remaining projects. Percentages must sum to 100.
          </div>
          {Array.from({ length: numTiers }).map((_, i) => {
            const isLast = i === numTiers - 1;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ width: "64px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Tier {i + 1}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input type="number" min={1} max={100} className="ui-input-sm" style={{ width: "80px" }} placeholder="%" value={tierPcts[i] ?? ""} onChange={(e) => { const n = [...tierPcts]; n[i] = e.target.value; setTierPcts(n); }} />
                  <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>%</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input type="number" min={0} className="ui-input-sm" style={{ width: "80px" }} placeholder="# projects" value={tierCounts[i] ?? ""} onChange={(e) => { const n = [...tierCounts]; n[i] = e.target.value; setTierCounts(n); }} />
                  <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>projects</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {err && <p style={{ marginTop: "12px", borderRadius: "8px", background: "var(--c-red-light)", padding: "12px", fontSize: "0.875rem", color: "var(--c-red-text)", whiteSpace: "pre-wrap" }}>{err}</p>}
      {ok && <p style={{ marginTop: "12px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
        {step === 2 && <button onClick={() => setStep(1)} className="ui-btn ui-btn-outline ui-btn-sm">← Back</button>}
        {step === 1 && <button onClick={handleStep1Next} disabled={!publicKey} className="ui-btn ui-btn-indigo">Next — configure tiers</button>}
        {step === 2 && <button onClick={handleCreate} disabled={busy || !publicKey} className="ui-btn ui-btn-indigo">{busy ? "Creating…" : "Create hackathon"}</button>}
      </div>
    </section>
  );
}

// ── Resolve + Finalize ────────────────────────────────────────────────────────

function UnresolvePanel({ hackathon, onUnresolved }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0]; onUnresolved: () => void }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleUnresolve() {
    if (!publicKey || !anchorWallet) return;
    setBusy(true); setErr(null);
    try {
      const program = getProgram(anchorWallet);
      await (program.methods as any)
        .adminUnresolve()
        .accounts({ admin: publicKey, hackathon: hackathon.pubkey })
        .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
        .rpc();
      setConfirm(false);
      onUnresolved();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <p style={{ margin: "0 0 10px", fontSize: "0.875rem", color: "var(--c-text-4)" }}>
        ✓ Hackathon resolved. Stakers can now claim.
      </p>
      {!confirm ? (
        <button onClick={() => setConfirm(true)} className="ui-btn ui-btn-outline ui-btn-sm" style={{ fontSize: "0.75rem" }}>
          Emergency: undo resolution
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "8px 12px" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--c-red-text)" }}>
            This resets ranks — re-resolve and finalize after. Confirm?
          </span>
          <button onClick={handleUnresolve} disabled={busy} className="ui-btn ui-btn-red ui-btn-xs">{busy ? "…" : "Yes, undo"}</button>
          <button onClick={() => setConfirm(false)} className="ui-btn ui-btn-outline ui-btn-xs">Cancel</button>
        </div>
      )}
      {err && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
    </div>
  );
}

function ResolvePanel({ hackathon }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0] }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { projects, reload: reloadProjects } = useProjects(hackathon.pubkey);
  const [ranks, setRanks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [finalizeConfirm, setFinalizeConfirm] = useState(false);
  const [finalized, setFinalized] = useState(false);

  // Seed rank inputs from on-chain state so returning admins see existing values.
  useEffect(() => {
    if (projects.length === 0) return;
    setRanks((current) => {
      const next = { ...current };
      for (const p of projects) {
        const key = p.pubkey.toBase58();
        if (p.rank > 0 && !next[key]) next[key] = String(p.rank);
      }
      return next;
    });
  }, [projects]);

  async function handleResolveAll() {
    if (!publicKey || !anchorWallet) return;
    const toSet = projects.filter((p) => parseInt(ranks[p.pubkey.toBase58()] ?? "0") > 0);
    if (toSet.length === 0) {
      setErr("Enter at least one rank before submitting.");
      return;
    }
    setErr(null); setOk(null); setBusy(true);
    try {
      const program = getProgram(anchorWallet);
      for (const p of toSet) {
        const rank = parseInt(ranks[p.pubkey.toBase58()]);
        await (program.methods as any)
          .resolve(rank)
          .accounts({ admin: publicKey, hackathon: hackathon.pubkey, project: p.pubkey })
          .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
          .rpc();
      }
      setOk(`${toSet.length} rank${toSet.length > 1 ? "s" : ""} set. Now run Finalize.`);
      reloadProjects();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  async function handleUnrankProject(project: (typeof projects)[number]) {
    if (!publicKey || !anchorWallet) return;
    setBusy(true); setErr(null);
    try {
      const program = getProgram(anchorWallet);
      await (program.methods as any)
        .adminUnrankProject()
        .accounts({ admin: publicKey, hackathon: hackathon.pubkey, project: project.pubkey })
        .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
        .rpc();
      setRanks((r) => { const next = { ...r }; delete next[project.pubkey.toBase58()]; return next; });
      reloadProjects();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  async function handleFinalize() {
    if (!publicKey || !anchorWallet) return;
    const hasRanked = projects.some((p) => p.rank > 0) ||
      projects.some((p) => parseInt(ranks[p.pubkey.toBase58()] ?? "0") > 0);
    if (!hasRanked) {
      setErr("No ranked projects found. Run 'Set ranks' first.");
      return;
    }
    setErr(null); setOk(null); setBusy(true);
    try {
      const program = getProgram(anchorWallet);
      await (program.methods as any)
        .finalizeResolve()
        .accounts({ admin: publicKey, hackathon: hackathon.pubkey })
        .remainingAccounts([
          ...getProtocolAdminRemainingAccounts(publicKey, hackathon.admin),
          ...projects.map((p) => ({ pubkey: p.pubkey, isWritable: false, isSigner: false })),
        ])
        .rpc();
      setFinalizeConfirm(false);
      setFinalized(true);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 12px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>Resolve projects</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {projects.map((p) => (
          <div key={p.pubkey.toBase58()} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", color: "var(--c-text-3)" }}>{p.githubUrl.replace("https://github.com/", "")}</span>
            <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
              {!p.builderDeclared && (
                <span title="Registered but not yet declared" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "var(--c-divider-2)", color: "var(--c-text-4)", border: "1px solid var(--c-divider)" }}>⚑ Registered</span>
              )}
              {p.builderDeclared && !p.submitted && (
                <span title="Builder declared submission" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "var(--c-amber-light)", color: "var(--c-amber-text)", border: "1px solid var(--c-amber-border)" }}>⚑ Declared</span>
              )}
              {p.submitted && (
                <span title="Organizer approved submission" style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>⚑ Approved</span>
              )}
            </div>
            <input type="number" min="0" placeholder="rank" className="ui-input-sm" style={{ width: "80px" }} value={ranks[p.pubkey.toBase58()] ?? ""} onChange={(e) => setRanks((r) => ({ ...r, [p.pubkey.toBase58()]: e.target.value }))} />
            {p.rank > 0 && (
              <button
                title="Remove rank (unplace project)"
                onClick={() => handleUnrankProject(p)}
                disabled={busy || !publicKey}
                style={{ flexShrink: 0, padding: "2px 6px", borderRadius: "4px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", color: "var(--c-red-text)", fontSize: "0.75rem", cursor: "pointer", lineHeight: 1 }}
              >×</button>
            )}
          </div>
        ))}
      </div>
      {finalized ? (
        <div style={{ marginTop: "12px", borderRadius: "10px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "10px 14px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-emerald-text)" }}>
          ✓ Ranks finalized and claims are now open.
        </div>
      ) : (
        <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button onClick={handleResolveAll} disabled={busy || !publicKey} className="ui-btn ui-btn-amber ui-btn-sm">{busy ? "…" : "Set ranks"}</button>
          {!finalizeConfirm ? (
            <button onClick={() => setFinalizeConfirm(true)} disabled={busy || !publicKey} className="ui-btn ui-btn-emerald ui-btn-sm">Finalize resolve</button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "8px 12px" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--c-red-text)" }}>This is irreversible on-chain. Confirm?</span>
              <button onClick={handleFinalize} disabled={busy} className="ui-btn ui-btn-red ui-btn-xs">{busy ? "…" : "Yes, finalize"}</button>
              <button onClick={() => setFinalizeConfirm(false)} className="ui-btn ui-btn-outline ui-btn-xs">Cancel</button>
            </div>
          )}
        </div>
      )}
      {err && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && !finalized && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
    </div>
  );
}

// ── Hackathon metadata editor ─────────────────────────────────────────────────

function MetadataPanel({ hackathon, adminAuth }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0]; adminAuth: AdminApiAuth }) {
  const [link, setLink] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("hackathon_metadata").select("official_link, icon_url").eq("hackathon_pubkey", hackathon.pubkey.toBase58()).maybeSingle().then(({ data }) => {
      if (data) { setLink(data.official_link ?? ""); setIconUrl(data.icon_url ?? ""); }
    });
  }, [hackathon.pubkey.toBase58()]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      await adminAuth.ensureSession?.();
      const response = await fetch("/api/admin/hackathon-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hackathon_pubkey: hackathon.pubkey.toBase58(),
          official_link: link.trim() || null,
          icon_url: iconUrl.trim() || null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "Failed to save");
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setErr(e.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  const subLabelStyle: React.CSSProperties = { display: "block", marginBottom: "4px", fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" };

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 12px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>Hackathon metadata</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div>
          <label style={subLabelStyle}>Official link</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="ui-input" />
        </div>
        <div>
          <label style={subLabelStyle}>Icon URL</label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://…/icon.png" className="ui-input" />
            {iconUrl && <div style={{ display: "flex", height: "36px", width: "36px", flexShrink: 0, overflow: "hidden", borderRadius: "8px", border: "1px solid var(--c-divider)" }}><img src={iconUrl} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} /></div>}
          </div>
        </div>
      </div>
      <button onClick={save} disabled={busy} className="ui-btn ui-btn-indigo ui-btn-sm" style={{ marginTop: "12px" }}>{busy ? "Saving…" : saved ? "Saved!" : "Save metadata"}</button>
      {err && <p style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{err}</p>}
    </div>
  );
}

// ── Whitelist panel ───────────────────────────────────────────────────────────

function GlobalWhitelistPanel({
  hackathons,
  adminAuth,
}: {
  hackathons: HackathonEntry[];
  adminAuth: AdminApiAuth;
}) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [walletInput, setWalletInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [requests, setRequests] = useState<WhitelistRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestErr, setRequestErr] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRequests() {
      if (!adminAuth.ensureSession || !adminAuth.ready) {
        if (!cancelled) setRequests([]);
        if (!cancelled) setLoadingRequests(false);
        return;
      }

      setLoadingRequests(true);
      setRequestErr(null);
      try {
        const response = await fetch("/api/admin/whitelist-requests", {
          cache: "no-store",
        });
        if (response.status === 401) {
          adminAuth.invalidateSession();
          throw new Error("Admin session expired. Sign in again.");
        }
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load whitelist requests");
        }
        if (!cancelled) setRequests((payload.data ?? []) as WhitelistRequest[]);
      } catch (e: any) {
        if (!cancelled) setRequestErr(e.message ?? "Failed to load whitelist requests");
      } finally {
        if (!cancelled) setLoadingRequests(false);
      }
    }

    void loadRequests();
    return () => { cancelled = true; };
  }, [publicKey?.toBase58(), adminAuth.ready, hackathons.length]);

  async function handleWhitelist() {
    if (!publicKey || !anchorWallet) return;
    let wallet: PublicKey;
    try { wallet = new PublicKey(walletInput.trim()); } catch { setErr("Invalid public key"); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      await ensureWalletWhitelistedAcrossHackathons(program, publicKey, hackathons, wallet);
      setOk(
        `Granted staking access across ${hackathons.length} hackathon${hackathons.length === 1 ? "" : "s"} for ${walletInput.trim().slice(0, 8)}…${walletInput.trim().slice(-4)}.`,
      );
      setWalletInput("");
      setRequests((current) =>
        current.map((request) =>
          request.wallet_address === wallet.toBase58() ? { ...request, status: "approved" } : request,
        ),
      );
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(request: WhitelistRequest, status: "approved" | "rejected") {
    if (!publicKey || !anchorWallet || !adminAuth.ensureSession) return;
    setRequestBusy(request.id);
    setRequestErr(null);
    try {
      if (status === "approved") {
        const wallet = new PublicKey(request.wallet_address);
        const program = getProgram(anchorWallet);
        await ensureWalletWhitelistedAcrossHackathons(program, publicKey, hackathons, wallet);
      }

      await adminAuth.ensureSession();
      const response = await fetch("/api/admin/whitelist-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: request.id,
          status,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update whitelist request");
      }

      setRequests((current) =>
        current.map((entry) =>
          entry.wallet_address === request.wallet_address ? { ...entry, status } : entry,
        ),
      );
    } catch (e: any) {
      setRequestErr(e.message ?? "Failed to update whitelist request");
    } finally {
      setRequestBusy(null);
    }
  }

  const pendingRequests = requests.filter((request) => request.status === "pending");
  const hackathonNameByPubkey = new Map(
    hackathons.map((hackathon) => [
      hackathon.pubkey.toBase58(),
      hackathon.name || `${hackathon.pubkey.toBase58().slice(0, 8)}…`,
    ]),
  );

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Global Staker Access</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Protocol admins can grant staking access across every current hackathon here. New hackathons inherit the same approved staker set when they are created.
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={walletInput}
          onChange={(e) => { setWalletInput(e.target.value); setErr(null); }}
          placeholder="Wallet address to whitelist globally…"
          className="ui-input"
          style={{ flex: 1, fontFamily: "monospace" }}
        />
        <button onClick={handleWhitelist} disabled={busy || !publicKey || !walletInput.trim()} className="ui-btn ui-btn-indigo ui-btn-sm">
          {busy ? "…" : "Grant access"}
        </button>
      </div>
      {err && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      <div style={{ marginTop: "16px" }}>
        <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
          Pending request queue
        </p>
        {loadingRequests ? (
          <div className="ui-skeleton" style={{ height: "56px", borderRadius: "10px" }} />
        ) : pendingRequests.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No pending staking access requests.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {pendingRequests.map((request) => (
              <div key={request.id} style={{ borderRadius: "10px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <code style={{ fontSize: "0.75rem", color: "var(--c-text-2)" }}>{request.wallet_address}</code>
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-3)" }}>{request.email}</p>
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                      Requested from {hackathonNameByPubkey.get(request.hackathon_pubkey) ?? `${request.hackathon_pubkey.slice(0, 8)}…`}
                    </p>
                    {request.notes && <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{request.notes}</p>}
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{new Date(request.created_at).toLocaleString()}</p>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button
                      onClick={() => reviewRequest(request, "approved")}
                      disabled={requestBusy === request.id}
                      className="ui-btn ui-btn-emerald ui-btn-xs"
                    >
                      {requestBusy === request.id ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => reviewRequest(request, "rejected")}
                      disabled={requestBusy === request.id}
                      className="ui-btn ui-btn-outline-red ui-btn-xs"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {requestErr && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{requestErr}</p>}
      </div>
    </section>
  );
}

// ── Hackathon card ─────────────────────────────────────────────────────────────

const PHASE_ORDER: HackathonPhase[] = ["active", "resolving", "resolved"];

function PhaseGroupedHackathons({
  hackathons,
  loading,
  version,
  emptyLabel,
  renderCard,
}: {
  hackathons: HackathonEntry[];
  loading: boolean;
  version: number;
  emptyLabel: string;
  renderCard: (h: HackathonEntry) => React.ReactNode;
}) {
  const [phaseTab, setPhaseTab] = useState<HackathonPhase>("active");

  const grouped = useMemo(() => groupByPhase(hackathons), [hackathons]);

  // Auto-switch away from an empty tab.
  useEffect(() => {
    if (grouped[phaseTab].length === 0) {
      const firstNonEmpty = PHASE_ORDER.find((p) => grouped[p].length > 0) ?? "active";
      if (phaseTab !== firstNonEmpty) setPhaseTab(firstNonEmpty);
    }
  }, [grouped, phaseTab]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {[...Array(2)].map((_, i) => <div key={i} className="ui-skeleton" style={{ height: "64px" }} />)}
      </div>
    );
  }

  if (hackathons.length === 0) {
    return (
      <div style={{ borderRadius: "16px", border: "1px dashed var(--c-divider)", padding: "32px", textAlign: "center", color: "var(--c-text-4)" }}>
        {emptyLabel}
      </div>
    );
  }

  const list = grouped[phaseTab];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Phase tab strip — select style */}
      <div style={{ display: "flex", borderRadius: "10px", border: "1px solid var(--card-border)", background: "var(--card-bg-alt)", overflow: "hidden" }}>
        {PHASE_ORDER.map((phase, i, arr) => {
          const count = grouped[phase].length;
          const active = phaseTab === phase;
          return (
            <button
              key={phase}
              onClick={() => count > 0 && setPhaseTab(phase)}
              disabled={count === 0}
              style={{
                flex: 1,
                padding: "10px 8px",
                border: "none",
                background: active ? "var(--card-bg)" : "transparent",
                color: active ? PHASE_COLOR[phase] : count === 0 ? "var(--c-text-4)" : PHASE_COLOR[phase],
                fontSize: "0.8125rem",
                fontWeight: active ? 700 : 500,
                cursor: count > 0 ? "pointer" : "default",
                borderRight: i < arr.length - 1 ? "1px solid var(--card-border)" : "none",
                transition: "background 0.15s, color 0.15s",
                position: "relative",
                opacity: count === 0 ? 0.4 : 1,
              }}
            >
              {active && (
                <span style={{
                  position: "absolute",
                  bottom: 0,
                  left: "20%",
                  right: "20%",
                  height: "2px",
                  borderRadius: "1px",
                  background: PHASE_COLOR[phase],
                }} />
              )}
              {PHASE_LABEL[phase]}
              <span style={{ marginLeft: "4px", fontSize: "0.6875rem", opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Card list for selected phase */}
      <div key={version} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {list.length === 0 ? (
          <div style={{ borderRadius: "12px", border: "1px dashed var(--c-divider)", padding: "24px", textAlign: "center", fontSize: "0.875rem", color: "var(--c-text-4)" }}>
            No hackathons in this phase.
          </div>
        ) : (
          list.map(renderCard)
        )}
      </div>
    </div>
  );
}

function HackathonAdminCard({
  hackathon,
  adminAuth,
  view,
  onReload,
}: {
  hackathon: HackathonEntry;
  adminAuth: AdminApiAuth;
  view: "manage" | "resolutions" | "advanced";
  onReload?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="ui-card">
      <button onClick={() => setExpanded((v) => !v)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: "var(--c-text)" }}>{hackathon.name || hackathon.pubkey.toBase58().slice(0, 16) + "…"}</p>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Deadline: {formatDate(hackathon.irlHackathonDeadlineTimestamp)} · {formatTokens(hackathon.totalPool)} USDC · <span style={{ color: PHASE_COLOR[hackathonPhase(hackathon)], fontWeight: 600 }}>{PHASE_LABEL[hackathonPhase(hackathon)]}</span></p>
        </div>
        <span style={{ color: "var(--c-text-4)" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--c-divider-2)", padding: "0 24px 24px" }}>
          {view === "manage" && (
            <MetadataPanel hackathon={hackathon} adminAuth={adminAuth} />
          )}
          {view === "resolutions" && (
            <>
              <DepositManagementPanel hackathon={hackathon} view="resolutions" />
              {!hackathon.isResolved && <ResolvePanel hackathon={hackathon} />}
              {hackathon.isResolved && <UnresolvePanel hackathon={hackathon} onUnresolved={() => onReload?.()} />}
            </>
          )}
          {view === "advanced" && (
            <>
              <SubmissionsSection
                hackathons={[hackathon]}
                adminAuth={adminAuth}
                hackathonFilter={hackathon.pubkey.toBase58()}
                compact
              />
              <HackathonWhitelistPanel hackathon={hackathon} />
              <DepositManagementPanel hackathon={hackathon} view="advanced" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Submissions ────────────────────────────────────────────────────────────────

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

type AdminPanelTab = "create" | "manage" | "resolve";

function SubmissionsSection({
  hackathons,
  adminAuth,
  hackathonFilter,
  compact,
}: {
  hackathons: ReturnType<typeof useHackathons>["hackathons"];
  adminAuth: AdminApiAuth;
  hackathonFilter?: string;
  compact?: boolean;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    if (!adminAuth.ensureSession || !adminAuth.ready) {
      setSubmissions([]);
      setLoading(false);
      return;
    }

    setErr(null);
    try {
      const response = await fetch("/api/admin/project-submissions", {
        cache: "no-store",
      });
      if (response.status === 401) {
        adminAuth.invalidateSession();
        throw new Error("Admin session expired. Sign in again.");
      }
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load submissions");
      }

      const hMap: Record<string, string> = {};
      for (const h of hackathons) hMap[h.pubkey.toBase58()] = h.name;
      setSubmissions((payload.data ?? []).map((r: any) => ({ ...r, hackathon_name: hMap[r.hackathon_pubkey] })));
    } catch (e: any) {
      setErr(e.message ?? "Failed to load submissions");
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [publicKey?.toBase58(), adminAuth.ready, hackathons.length]);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    if (!adminAuth.ensureSession) return;
    setBusy(id);
    setErr(null);
    setOk(null);
    try {
      const sub = submissions.find((s) => s.id === id);
      if (!sub) {
        throw new Error("Submission not found");
      }
      const hackathon = hackathons.find((entry) => entry.pubkey.toBase58() === sub?.hackathon_pubkey);
      if (!hackathon) {
        throw new Error("Hackathon not found");
      }

      if (status === "approved") {
        if (!publicKey || !anchorWallet) {
          throw new Error("Connect the organizer wallet to approve on-chain submissions");
        }
        if (!sub.project_pubkey) {
          throw new Error("This submission is missing a project_pubkey");
        }

        const builder = new PublicKey(sub.wallet_address);
        const project = new PublicKey(sub.project_pubkey);
        const normalized = normalizeGitHubUrl(sub.github_url);
        const urlHash = Array.from(await hashUrl(sub.github_url));

        const existingProject = await connection.getAccountInfo(project, "confirmed");
        if (!existingProject) {
          try {
            const program = getProgram(anchorWallet);
            const tx = await (program.methods as any)
              .registerProject(normalized, urlHash)
              .accounts({
                caller: publicKey,
                builder,
                hackathon: hackathon.pubkey,
                project,
                systemProgram: SystemProgram.programId,
              })
              .remainingAccounts(getProtocolAdminRemainingAccounts(publicKey, hackathon.admin))
              .transaction();

            await sendWalletTransactionWithConfirmation({
              connection,
              feePayer: publicKey,
              sendTransaction,
              transaction: tx,
              verifySuccess: async () => Boolean(await connection.getAccountInfo(project, "confirmed")),
            });
          } catch (e: any) {
            const text = e.message ?? "";
            const logs = (e.logs ?? []) as string[];
            const alreadyExists =
              text.includes("already in use") ||
              text.includes("already been processed") ||
              logs.some((line) => line.includes("already in use"));
            if (!alreadyExists) {
              throw e;
            }
          }
        }
      }

      await adminAuth.ensureSession();
      const response = await fetch("/api/admin/project-submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          submission_id: id,
          status,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update submission");
      }

      setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
      setOk(status === "approved" ? "Submission approved and project registered on-chain." : "Submission rejected.");
    } catch (e: any) {
      setErr(e.message ?? "Failed to update submission");
    } finally {
      setBusy(null);
    }
  }

  const filtered = hackathonFilter
    ? submissions.filter((s) => s.hackathon_pubkey === hackathonFilter)
    : submissions;
  const visible = compact
    ? filtered.filter((s) => s.status === "pending")
    : filter === "all" ? filtered : filtered.filter((s) => s.status === filter);
  if (loading && !compact) return <div className="ui-skeleton" style={{ height: "64px", borderRadius: "16px" }} />;
  if (compact && !loading && visible.length === 0) return null;

  function subBorderBg(status: string) {
    if (status === "pending") return { border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)" };
    if (status === "approved") return { border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)" };
    return { border: "1px solid var(--card-border)", background: "var(--card-bg-alt)" };
  }

  function statusBadgeStyle(status: string) {
    if (status === "pending") return { background: "var(--c-amber-light)", color: "var(--c-amber-text)" };
    if (status === "approved") return { background: "var(--c-emerald-light)", color: "var(--c-emerald-text)" };
    return { background: "var(--c-divider)", color: "var(--c-text-3)" };
  }

  const submissionsList = (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {visible.map((s) => (
        <div key={s.id} style={{ borderRadius: "12px", padding: "16px", ...subBorderBg(s.status) }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>{s.project_name?.trim() || s.github_url.replace("https://github.com/", "")}</p>
              <a href={s.github_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", color: "var(--c-indigo-text)", textDecoration: "none" }}>{s.github_url.replace("https://github.com/", "")}</a>
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-3)" }}>{s.hackathon_name || s.hackathon_pubkey.slice(0, 12) + "…"} · {s.wallet_address.slice(0, 8)}…{s.wallet_address.slice(-4)}{s.auth_email && ` · ${s.auth_email}`}</p>
              <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{s.twitter_handle && <span>𝕏 @{s.twitter_handle}</span>}{s.telegram && <span>✈ {s.telegram}</span>}{s.discord && <span>💬 {s.discord}</span>}</div>
              {s.status === "pending" && (
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                  Approving this submission will register the project on-chain and make it eligible to go live once the builder finishes the deposit flow.
                </p>
              )}
              {(hackathons.find((entry) => entry.pubkey.toBase58() === s.hackathon_pubkey)?.depositAmount ?? 0n) > 0n && (
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-amber-text)" }}>
                  Deposit-backed projects still need organizer approval after the builder declaration before the builder can reclaim the deposit.
                </p>
              )}
              <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{new Date(s.created_at).toLocaleString()}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ borderRadius: "9999px", padding: "2px 10px", fontSize: "0.75rem", fontWeight: 500, textTransform: "capitalize", ...statusBadgeStyle(s.status) }}>{s.status}</span>
              {s.status === "pending" && (
                <>
                  <button onClick={() => updateStatus(s.id, "approved")} disabled={busy === s.id} className="ui-btn ui-btn-emerald ui-btn-xs">{busy === s.id ? "…" : "Approve"}</button>
                  <button onClick={() => updateStatus(s.id, "rejected")} disabled={busy === s.id} className="ui-btn ui-btn-outline-red ui-btn-xs">Reject</button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>Pending Submissions</h3>
        {err && <p style={{ marginBottom: "12px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
        {ok && <p style={{ marginBottom: "12px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
        {submissionsList}
      </div>
    );
  }

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Project Submissions</h2>
        <div style={{ display: "flex", gap: "4px", borderRadius: "12px", border: "1px solid var(--c-divider)", padding: "4px" }}>
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`ui-sort-tab ${filter === f ? "ui-sort-tab-active" : "ui-sort-tab-inactive"}`} style={{ textTransform: "capitalize" }}>{f}</button>
          ))}
        </div>
      </div>
      {err && <p style={{ marginBottom: "12px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginBottom: "12px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      {visible.length === 0 && <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No {filter === "all" ? "" : filter} submissions.</p>}
      {submissionsList}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { publicKey, signMessage } = useWallet();
  const { hackathons, loading, reload: reloadHackathons } = useHackathons();
  const [version, setVersion] = useState(0);
  const [adminPanelTab, setAdminPanelTab] = useState<AdminPanelTab>("manage");
  const [adminSessionReady, setAdminSessionReady] = useState(false);
  const [adminSessionBusy, setAdminSessionBusy] = useState(false);
  const [adminSessionErr, setAdminSessionErr] = useState<string | null>(null);
  const { isProtocolAdmin, isSuperAdmin } = useIsProtocolAdmin(publicKey ?? null);
  const managesHackathons = publicKey ? hackathons.some((hackathon) => hackathon.admin.equals(publicKey)) : false;
  const isAdmin = isProtocolAdmin || managesHackathons;

  useEffect(() => {
    let cancelled = false;
    clearAdminSessionCache();
    setAdminSessionReady(false);
    setAdminSessionErr(null);

    async function loadExistingSession() {
      if (!publicKey || !signMessage || !isAdmin) return;

      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return;

        const payload = await response.json() as { wallet_address?: string };
        if (payload.wallet_address !== publicKey.toBase58()) {
          await fetch("/api/admin/session", {
            method: "DELETE",
            credentials: "same-origin",
          }).catch(() => {});
          return;
        }

        if (!cancelled) {
          setAdminSessionReady(true);
        }
      } catch {
        if (!cancelled) {
          setAdminSessionReady(false);
        }
      }
    }

    void loadExistingSession();
    return () => { cancelled = true; };
  }, [publicKey?.toBase58(), Boolean(signMessage), isAdmin]);

  async function startAdminSession() {
    if (!signMessage || !publicKey) {
      throw new Error("Your wallet must support message signing to review requests");
    }
    await ensureAdminSession(signMessage, publicKey);
  }

  function invalidateAdminSession(message = "Admin session expired. Sign in again.") {
    clearAdminSessionCache();
    setAdminSessionReady(false);
    setAdminSessionBusy(false);
    setAdminSessionErr(message);
    void fetch("/api/admin/session", {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => {});
  }

  async function handleAdminSignIn() {
    setAdminSessionBusy(true);
    setAdminSessionErr(null);
    try {
      await startAdminSession();
      setAdminSessionReady(true);
    } catch (e: any) {
      setAdminSessionReady(false);
      setAdminSessionErr(e?.message ?? "Failed to sign in as admin");
    } finally {
      setAdminSessionBusy(false);
    }
  }

  const adminAuth: AdminApiAuth = {
    ensureSession: publicKey && signMessage ? startAdminSession : null,
    invalidateSession: invalidateAdminSession,
    ready: adminSessionReady,
  };

  const visibleHackathons = isSuperAdmin || !publicKey
    ? hackathons
    : hackathons.filter((hackathon) => hackathon.admin.equals(publicKey));

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ margin: "0 auto", maxWidth: "768px", padding: "40px 16px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ margin: 0, fontSize: "1.875rem", fontWeight: 800, color: "var(--c-text)" }}>Admin Panel</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Create hackathons, approve submissions, set results.</p>
          {!isAdmin && (
            <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
              Access restricted. Connect a protocol admin or assigned hackathon admin wallet to use this panel.
            </div>
          )}
          {isAdmin && !adminSessionReady && (
            <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "16px" }}>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-amber-text)" }}>
                Click here to sign in as admin. This signature does not cost gas.
              </p>
              <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <button
                  onClick={() => void handleAdminSignIn()}
                  disabled={adminSessionBusy || !signMessage}
                  className="ui-btn ui-btn-indigo ui-btn-sm"
                >
                  {adminSessionBusy ? "Waiting for signature..." : "Sign In As Admin"}
                </button>
                {!signMessage && (
                  <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                    This wallet must support message signing.
                  </span>
                )}
              </div>
              {adminSessionErr && (
                <p style={{ margin: "10px 0 0", fontSize: "0.8125rem", color: "var(--c-red-text)" }}>
                  {adminSessionErr}
                </p>
              )}
            </div>
          )}
        </div>
        {isAdmin && adminSessionReady && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Tab strip — select style */}
            <div style={{ display: "flex", borderRadius: "10px", border: "1px solid var(--card-border)", background: "var(--card-bg-alt)", overflow: "hidden" }}>
              {([
                ...(isProtocolAdmin ? [{ id: "create" as const, label: "Create" }] : []),
                { id: "manage" as const, label: "Manage" },
                { id: "resolve" as const, label: "Resolve" },
              ] as Array<{ id: AdminPanelTab; label: string }>).map((tab, i, arr) => (
                <button
                  key={tab.id}
                  onClick={() => setAdminPanelTab(tab.id)}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    border: "none",
                    background: adminPanelTab === tab.id ? "var(--card-bg)" : "transparent",
                    color: adminPanelTab === tab.id ? "var(--c-text)" : "var(--c-text-3)",
                    fontSize: "0.8125rem",
                    fontWeight: adminPanelTab === tab.id ? 700 : 500,
                    cursor: "pointer",
                    borderRight: i < arr.length - 1 ? "1px solid var(--card-border)" : "none",
                    transition: "background 0.15s, color 0.15s",
                    position: "relative",
                  }}
                >
                  {adminPanelTab === tab.id && (
                    <span style={{
                      position: "absolute",
                      bottom: 0,
                      left: "20%",
                      right: "20%",
                      height: "2px",
                      borderRadius: "1px",
                      background: "var(--c-indigo)",
                    }} />
                  )}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Create tab */}
            {adminPanelTab === "create" && isProtocolAdmin && (
              <CreateHackathonPanel adminAuth={adminAuth} onCreated={() => { setVersion((v) => v + 1); reloadHackathons(); }} />
            )}

            {/* Manage tab */}
            {adminPanelTab === "manage" && (
              <PhaseGroupedHackathons
                hackathons={visibleHackathons}
                loading={loading}
                version={version}
                emptyLabel={isProtocolAdmin ? "No hackathons yet." : "No hackathons assigned to this wallet."}
                renderCard={(h) => <HackathonAdminCard key={h.pubkey.toBase58()} hackathon={h} adminAuth={adminAuth} view="manage" />}
              />
            )}

            {/* Resolve tab */}
            {adminPanelTab === "resolve" && (
              <PhaseGroupedHackathons
                hackathons={visibleHackathons}
                loading={loading}
                version={version}
                emptyLabel={isProtocolAdmin ? "No hackathons yet." : "No hackathons assigned to this wallet."}
                renderCard={(h) => <HackathonAdminCard key={h.pubkey.toBase58()} hackathon={h} adminAuth={adminAuth} view="resolutions" onReload={reloadHackathons} />}
              />
            )}

          </div>
        )}
      </main>
    </div>
  );
}
