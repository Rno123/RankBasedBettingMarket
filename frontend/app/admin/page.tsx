"use client";

import { useState, useEffect } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { getProgram } from "@/lib/program";
import { hackathonPda, escrowPda, whitelistPda, protocolAdminPda } from "@/lib/pda";
import { useHackathons } from "@/hooks/useHackathons";
import { useProjects } from "@/hooks/useProjects";
import { formatTokens, formatDate } from "@/lib/format";
import { USDC_MINT, DEPLOYER, PROTOCOL_ADMIN } from "@/lib/constants";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

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

function DepositManagementPanel({ hackathon }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0] }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { projects } = useProjects(hackathon.pubkey);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok?: string; err?: string }>>({});
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; errors: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  if (hackathon.depositAmount === 0n) return null;

  // Projects eligible for bulk deposit release (paid, not yet refunded/forfeited, not already enabled)
  const releaseEligible = projects.filter(
    (p) => p.depositAmountPaid > 0n && !p.depositForfeited && !p.depositRefunded && !p.isRefundEnabled,
  );

  async function releaseAllDeposits() {
    if (!publicKey || !anchorWallet || releaseEligible.length === 0) return;
    setBusy("bulk"); setBulkResult(null);
    setBulkProgress({ done: 0, total: releaseEligible.length, errors: 0 });
    const program = getProgram(anchorWallet);
    let errors = 0;
    for (let i = 0; i < releaseEligible.length; i++) {
      const p = releaseEligible[i];
      const pkStr = p.pubkey.toBase58();
      try {
        await (program.methods as any).enableRefund().accounts({
          admin: publicKey,
          hackathon: hackathon.pubkey,
          project: p.pubkey,
        }).rpc();
        setMessages((m) => ({ ...m, ["refund_" + pkStr]: { ok: "Refund enabled" } }));
      } catch (e: any) {
        errors++;
        setMessages((m) => ({ ...m, ["refund_" + pkStr]: { err: e.message ?? "Failed" } }));
      }
      setBulkProgress({ done: i + 1, total: releaseEligible.length, errors });
    }
    const released = releaseEligible.length - errors;
    setBulkResult(errors === 0
      ? `All ${released} deposit${released !== 1 ? "s" : ""} unlocked.`
      : `${released} unlocked, ${errors} failed — check individual rows.`);
    setBusy(null);
  }

  async function forfeitDeposit(projectPubkey: string) {
    if (!publicKey || !anchorWallet) return;
    setBusy(projectPubkey);
    setMessages((m) => ({ ...m, [projectPubkey]: {} }));
    try {
      const program = getProgram(anchorWallet);
      const feeRecipientAta = getAssociatedTokenAddressSync(hackathon.usdcMint, hackathon.feeRecipient);
      const escrow = escrowPda(hackathon.pubkey);
      await (program.methods as any).forfeitDeposit().accounts({
        admin: publicKey,
        hackathon: hackathon.pubkey,
        project: new PublicKey(projectPubkey),
        feeRecipientTokenAccount: feeRecipientAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
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
      await (program.methods as any).enableRefund().accounts({
        admin: publicKey,
        hackathon: hackathon.pubkey,
        project: new PublicKey(projectPubkey),
      }).rpc();
      setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: { ok: "Refund enabled" } }));
    } catch (e: any) {
      setMessages((m) => ({ ...m, ["refund_" + projectPubkey]: { err: e.message ?? "Failed" } }));
    } finally { setBusy(null); }
  }

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>
        Deposit management ({formatTokens(hackathon.depositAmount)} USDC per builder)
      </h3>
      <p style={{ margin: "0 0 12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
        Release all deposits once judging is complete. Forfeit deposits from builders who didn&apos;t submit.
      </p>

      {/* Bulk release action */}
      <div style={{ marginBottom: "16px", borderRadius: "10px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-emerald-text)" }}>Release all deposits</p>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-3)" }}>
              Unlocks deposit refunds for all builders with a paid deposit ({releaseEligible.length} eligible).
              {" "}Builders can then claim their {formatTokens(hackathon.depositAmount)} USDC back from escrow.
            </p>
          </div>
          <button
            onClick={releaseAllDeposits}
            disabled={busy === "bulk" || releaseEligible.length === 0}
            className="ui-btn ui-btn-emerald ui-btn-sm"
            style={{ flexShrink: 0 }}
          >
            {busy === "bulk"
              ? bulkProgress ? `Releasing… (${bulkProgress.done}/${bulkProgress.total})` : "Releasing…"
              : releaseEligible.length === 0 ? "All released" : "Release all deposits"}
          </button>
        </div>
        {bulkResult && (
          <p style={{ margin: "8px 0 0", fontSize: "0.75rem", fontWeight: 500, color: "var(--c-emerald-text)" }}>{bulkResult}</p>
        )}
        {/* Future: Merkle root approach */}
        <p style={{ margin: "8px 0 0", fontSize: "0.6875rem", color: "var(--c-text-4)", fontStyle: "italic" }}>
          Roadmap: this will be replaced by a Merkle root commit — admin submits a root of eligible builder wallets; builders prove inclusion and self-serve their claim without admin iterating each project.
        </p>
      </div>

      {/* Forfeit note */}
      <div style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.75rem", color: "var(--c-amber-text)" }}>
        <strong>Forfeit deposit</strong> should only be called at least 14 days after the hackathon&apos;s results date, once it&apos;s clear a builder did not submit. Calling it early may be unfair to builders still working.
      </div>

      {projects.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No projects registered.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {projects.map((p) => {
            const repoShort = p.githubUrl.replace("https://github.com/", "");
            const pkStr = p.pubkey.toBase58();
            const msg = messages[pkStr] ?? {};
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
                      {" · "}{p.submitted ? "Submitted" : "Not submitted"}
                      {p.isRefundEnabled ? " · Refund ON" : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {p.depositAmountPaid > 0n && !p.depositForfeited && !p.depositRefunded && !p.submitted && (
                      <button
                        onClick={() => forfeitDeposit(pkStr)}
                        disabled={busy === pkStr}
                        className="ui-btn ui-btn-red ui-btn-xs"
                        title="Only forfeit 14+ days after hackathon results date"
                      >
                        {busy === pkStr ? "…" : "Forfeit deposit"}
                      </button>
                    )}
                    {!p.isRefundEnabled && (
                      <button
                        onClick={() => enableRefund(pkStr)}
                        disabled={busy === "refund_" + pkStr}
                        className="ui-btn ui-btn-amber ui-btn-xs"
                      >
                        {busy === "refund_" + pkStr ? "…" : "Enable refund"}
                      </button>
                    )}
                    {p.isRefundEnabled && (
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--c-amber-text)" }}>Refund active</span>
                    )}
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

// ── Create Hackathon ──────────────────────────────────────────────────────────

function CreateHackathonPanel({ onCreated }: { onCreated: () => void }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [step, setStep] = useState<1 | 2>(1);
  const [hackathonName, setHackathonName] = useState("");
  const [resultsDate, setResultsDate] = useState("");
  const [numTiers, setNumTiers] = useState<number>(3);
  const [feeRecipientInput, setFeeRecipientInput] = useState("");
  const [protocolFeeBps, setProtocolFeeBps] = useState("150");
  const [depositAmountUsdc, setDepositAmountUsdc] = useState("10");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [tierPcts, setTierPcts] = useState<string[]>(["55", "30", "15"]);
  const [tierCounts, setTierCounts] = useState<string[]>(["1", "1", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

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
    if (new TextEncoder().encode(trimmedName).length > 50) { setErr("Name exceeds 50 bytes"); return; }
    const resultsTs = Math.floor(new Date(resultsDate).getTime() / 1000);
    if (isNaN(resultsTs) || resultsTs < Math.floor(Date.now() / 1000)) { setErr("Results date must be in the future"); return; }
    if (numTiers < 1 || numTiers > 8) { setErr("Tiers must be 1–8"); return; }
    const feeBps = parseInt(protocolFeeBps);
    if (isNaN(feeBps) || feeBps < 0 || feeBps > 10000) { setErr("Protocol fee must be 0–10000 bps"); return; }
    const depositLamports = Math.round(parseFloat(depositAmountUsdc) * 1_000_000);
    if (isNaN(depositLamports) || depositLamports < 0) { setErr("Deposit amount must be ≥ 0"); return; }
    const feeInput = feeRecipientInput.trim();
    if (feeInput) { try { new PublicKey(feeInput); } catch { setErr("Invalid fee recipient address"); return; } }
    setStep(2);
  }

  async function handleCreate() {
    if (!publicKey || !anchorWallet) return;
    setErr(null);
    const pcts = tierPcts.map((v) => parseInt(v));
    const counts = tierCounts.map((v, i) => i === numTiers - 1 ? 0 : parseInt(v));
    if (pcts.some(isNaN) || pcts.some((v) => v < 0)) { setErr("All tier % must be ≥ 0"); return; }
    if (pcts.reduce((a, b) => a + b, 0) !== 100) { setErr("Tier % must sum to 100"); return; }
    for (let i = 0; i < numTiers - 1; i++) {
      if (isNaN(counts[i]) || counts[i] < 1) { setErr(`Tier ${i + 1} count must be ≥ 1`); return; }
    }
    setBusy(true);
    try {
      const trimmedName = hackathonName.trim();
      const resultsTs = Math.floor(new Date(resultsDate).getTime() / 1000);
      const feeRecipient = feeRecipientInput.trim() ? new PublicKey(feeRecipientInput.trim()) : publicKey;
      const feeBps = parseInt(protocolFeeBps);
      const depositLamports = new BN(Math.round(parseFloat(depositAmountUsdc) * 1_000_000));
      const program = getProgram(anchorWallet);
      const hackathon = hackathonPda(publicKey, trimmedName);
      const escrow = escrowPda(hackathon);
      await (program.methods as any)
        .initializeHackathon(trimmedName, new BN(resultsTs), Buffer.from(pcts), Buffer.from(counts), feeRecipient, feeBps, depositLamports, requiresApproval)
        .accounts({ admin: publicKey, hackathon, escrow, usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .rpc();
      setOk(`Hackathon "${trimmedName}" created`);
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
            <input className="ui-input" placeholder="e.g. Frontier S1" value={hackathonName} onChange={(e) => setHackathonName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Results date &amp; time</label>
            <input type="datetime-local" className="ui-input" value={resultsDate} onChange={(e) => setResultsDate(e.target.value)} />
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
          <div className="grid-auto-2" style={{ gap: "12px" }}>
            <div>
              <label style={labelStyle}>Protocol fee (bps)</label>
              <input type="number" min={0} max={10000} className="ui-input" value={protocolFeeBps} onChange={(e) => setProtocolFeeBps(e.target.value)} />
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>150 = 1.5%</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <label style={{ ...labelStyle, marginBottom: "8px" }}>Require submission approval</label>
              <button
                type="button"
                onClick={() => setRequiresApproval((v) => !v)}
                className={`ui-toggle ${requiresApproval ? "ui-toggle-on" : "ui-toggle-off"}`}
              >
                <span className="ui-toggle-knob" />
              </button>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Fee recipient <span style={{ fontWeight: 400, color: "var(--c-text-4)" }}>(leave blank to use your wallet)</span></label>
            <input className="ui-input" style={{ fontFamily: "monospace" }} placeholder="Solana wallet address…" value={feeRecipientInput} onChange={(e) => setFeeRecipientInput(e.target.value)} />
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
                  <input type="number" min={0} className="ui-input-sm" style={{ width: "80px" }} placeholder={isLast ? "0 = rest" : "# projects"} value={tierCounts[i] ?? ""} onChange={(e) => { const n = [...tierCounts]; n[i] = e.target.value; setTierCounts(n); }} />
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

function ResolvePanel({ hackathon }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0] }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { projects } = useProjects(hackathon.pubkey);
  const [ranks, setRanks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [finalizeConfirm, setFinalizeConfirm] = useState(false);

  async function handleResolveAll() {
    if (!publicKey || !anchorWallet) return;
    setErr(null); setOk(null); setBusy(true);
    try {
      const program = getProgram(anchorWallet);
      for (const p of projects) {
        const rank = parseInt(ranks[p.pubkey.toBase58()] ?? "0");
        if (rank > 0) {
          await (program.methods as any).resolve(rank).accounts({ admin: publicKey, hackathon: hackathon.pubkey, project: p.pubkey }).rpc();
        }
      }
      setOk("All ranks set. Now run Finalize.");
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  async function handleFinalize() {
    if (!publicKey || !anchorWallet) return;
    setErr(null); setOk(null); setBusy(true);
    try {
      const program = getProgram(anchorWallet);
      await (program.methods as any).finalizeResolve().accounts({ admin: publicKey, hackathon: hackathon.pubkey }).remainingAccounts(projects.map((p) => ({ pubkey: p.pubkey, isWritable: false, isSigner: false }))).rpc();
      setOk("Finalized! is_resolved = true");
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
            <input type="number" min="0" placeholder="rank" className="ui-input-sm" style={{ width: "80px" }} value={ranks[p.pubkey.toBase58()] ?? ""} onChange={(e) => setRanks((r) => ({ ...r, [p.pubkey.toBase58()]: e.target.value }))} />
          </div>
        ))}
      </div>
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
      {err && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
    </div>
  );
}

// ── Hackathon metadata editor ─────────────────────────────────────────────────

function MetadataPanel({ hackathon }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0] }) {
  const [link, setLink] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.from("hackathon_metadata").select("official_link, icon_url").eq("hackathon_pubkey", hackathon.pubkey.toBase58()).single().then(({ data }) => {
      if (data) { setLink(data.official_link ?? ""); setIconUrl(data.icon_url ?? ""); }
    });
  }, [hackathon.pubkey.toBase58()]);

  async function save() {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    await sb.from("hackathon_metadata").upsert({ hackathon_pubkey: hackathon.pubkey.toBase58(), official_link: link.trim() || null, icon_url: iconUrl.trim() || null }, { onConflict: "hackathon_pubkey" });
    setBusy(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
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
    </div>
  );
}

// ── Whitelist panel ───────────────────────────────────────────────────────────

function WhitelistPanel({ hackathon }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0] }) {
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
      const whitelistEntry = whitelistPda(hackathon.pubkey, wallet);
      await (program.methods as any)
        .whitelistWallet()
        .accounts({ admin: publicKey, hackathon: hackathon.pubkey, wallet, whitelistEntry, systemProgram: SystemProgram.programId })
        .rpc();
      setOk(`Whitelisted: ${walletInput.trim().slice(0, 8)}…${walletInput.trim().slice(-4)}`);
      setWalletInput("");
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "16px" }}>
      <h3 style={{ margin: "0 0 12px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>Whitelist stakers</h3>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={walletInput}
          onChange={(e) => { setWalletInput(e.target.value); setErr(null); }}
          placeholder="Wallet address to whitelist…"
          className="ui-input"
          style={{ flex: 1, fontFamily: "monospace" }}
        />
        <button onClick={handleWhitelist} disabled={busy || !publicKey || !walletInput.trim()} className="ui-btn ui-btn-indigo ui-btn-sm">
          {busy ? "…" : "Whitelist"}
        </button>
      </div>
      {err && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
    </div>
  );
}

// ── Hackathon card ─────────────────────────────────────────────────────────────

function HackathonAdminCard({ hackathon }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="ui-card">
      <button onClick={() => setExpanded((v) => !v)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: "var(--c-text)" }}>{hackathon.name || hackathon.pubkey.toBase58().slice(0, 16) + "…"}</p>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Results: {formatDate(hackathon.resultsTimestamp)} · {formatTokens(hackathon.totalPool)} USDC · {hackathon.isResolved ? <span style={{ color: "var(--c-emerald-text)" }}>Resolved</span> : <span style={{ color: "var(--c-indigo-text)" }}>Active</span>}</p>
        </div>
        <span style={{ color: "var(--c-text-4)" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--c-divider-2)", padding: "0 24px 24px" }}>
          <MetadataPanel hackathon={hackathon} />
          <WhitelistPanel hackathon={hackathon} />
          <DepositManagementPanel hackathon={hackathon} />
          {!hackathon.isResolved && <ResolvePanel hackathon={hackathon} />}
          {hackathon.isResolved && <p style={{ marginTop: "16px", fontSize: "0.875rem", color: "var(--c-text-4)" }}>Hackathon resolved. Stakers can now claim.</p>}
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
  project_pubkey?: string;
  github_url: string;
  wallet_address: string;
  twitter_handle?: string;
  telegram?: string;
  discord?: string;
  auth_email?: string;
  status: string;
  created_at: string;
}

function SubmissionsSection({ hackathons }: { hackathons: ReturnType<typeof useHackathons>["hackathons"] }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const sb = getSupabaseAdmin() ?? getSupabase();
    if (!sb) { setLoading(false); return; }
    const { data } = await sb.from("project_submissions").select("*").order("created_at", { ascending: false });
    if (data) {
      const hMap: Record<string, string> = {};
      for (const h of hackathons) hMap[h.pubkey.toBase58()] = h.name;
      setSubmissions(data.map((r: any) => ({ ...r, hackathon_name: hMap[r.hackathon_pubkey] })));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [hackathons.length]);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    setBusy(id);
    const sb = getSupabaseAdmin() ?? getSupabase();
    if (!sb) { setBusy(null); return; }
    await sb.from("project_submissions").update({ status, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (status === "approved") {
      const sub = submissions.find((s) => s.id === id);
      if (sub?.project_pubkey) {
        await sb.from("project_metadata").upsert({ project_pubkey: sub.project_pubkey, hackathon_pubkey: sub.hackathon_pubkey, github_url: sub.github_url, wallet_address: sub.wallet_address, twitter_handle: sub.twitter_handle ?? null, telegram: sub.telegram ?? null, discord: sub.discord ?? null }, { onConflict: "project_pubkey" });
      }
    }
    setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
    setBusy(null);
  }

  const visible = filter === "all" ? submissions : submissions.filter((s) => s.status === filter);
  if (loading) return <div className="ui-skeleton" style={{ height: "64px", borderRadius: "16px" }} />;

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
      {!getSupabase() && <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>Supabase not configured.</p>}
      {getSupabase() && visible.length === 0 && <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No {filter === "all" ? "" : filter} submissions.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {visible.map((s) => (
          <div key={s.id} style={{ borderRadius: "12px", padding: "16px", ...subBorderBg(s.status) }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
              <div>
                <a href={s.github_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500, color: "var(--c-indigo-text)", textDecoration: "none" }}>{s.github_url.replace("https://github.com/", "")}</a>
                <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-3)" }}>{s.hackathon_name || s.hackathon_pubkey.slice(0, 12) + "…"} · {s.wallet_address.slice(0, 8)}…{s.wallet_address.slice(-4)}{s.auth_email && ` · ${s.auth_email}`}</p>
                <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{s.twitter_handle && <span>𝕏 @{s.twitter_handle}</span>}{s.telegram && <span>✈ {s.telegram}</span>}{s.discord && <span>💬 {s.discord}</span>}</div>
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
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { publicKey } = useWallet();
  const { hackathons, loading, reload: reloadHackathons } = useHackathons();
  const [version, setVersion] = useState(0);
  const { isProtocolAdmin } = useIsProtocolAdmin(publicKey ?? null);
  const isAdmin = isProtocolAdmin || publicKey?.toBase58() === DEPLOYER;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ margin: "0 auto", maxWidth: "768px", padding: "40px 16px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ margin: 0, fontSize: "1.875rem", fontWeight: 800, color: "var(--c-text)" }}>Admin Panel</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Create hackathons, approve submissions, set results.</p>
          {!isAdmin && (
            <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
              Access restricted. Connect the admin wallet to use this panel.
            </div>
          )}
        </div>
        {isAdmin && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <CreateHackathonPanel onCreated={() => { setVersion((v) => v + 1); reloadHackathons(); }} />
            <AdminDelegationPanel />
            <SubmissionsSection hackathons={hackathons} />
            <div>
              <h2 style={{ margin: "0 0 12px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Hackathons</h2>
              {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>{[...Array(2)].map((_, i) => <div key={i} className="ui-skeleton" style={{ height: "64px" }} />)}</div>
              ) : hackathons.length === 0 ? (
                <div style={{ borderRadius: "16px", border: "1px dashed var(--c-divider)", padding: "32px", textAlign: "center", color: "var(--c-text-4)" }}>No hackathons yet.</div>
              ) : (
                <div key={version} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>{hackathons.map((h) => <HackathonAdminCard key={h.pubkey.toBase58()} hackathon={h} />)}</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
