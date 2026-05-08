"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { AnchorWallet } from "@solana/wallet-adapter-react";

import Navbar from "@/components/Navbar";
import ParlayModal from "@/components/ParlayModal";
import ClaimButton from "@/components/ClaimButton";
import ClaimSlipButton from "@/components/ClaimSlipButton";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import ProjectRow from "@/components/ProjectRow";

import { useHackathons } from "@/hooks/useHackathons";
import type { HackathonInfo } from "@/hooks/useHackathons";
import { useProjects } from "@/hooks/useProjects";
import type { ProjectInfo } from "@/hooks/useProjects";
import { useHackathonMeta } from "@/hooks/useHackathonMeta";
import { useUserStakesForProjects } from "@/hooks/useUserStakesForProjects";
import type { UserStakeInfo } from "@/hooks/useUserStake";
import { useWhitelistStatus } from "@/hooks/useWhitelistStatus";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";
import { useTokenBalance } from "@/hooks/useTokenBalance";

import { getProgram, getReadonlyProgram } from "@/lib/program";
import {
  hackathonPda, escrowPda, stakePda, projectPdaFromUrl,
  whitelistPda, protocolAdminPda, hashUrl, normalizeGitHubUrl,
} from "@/lib/pda";
import { buildStakeAccounts } from "@/lib/transactions";
import {
  hackathonStatus, formatTokens, parseTokens, formatDate,
  timeUntil, repoName, ordinal,
} from "@/lib/format";
import { computeShares, estimatePayout, formatRoi } from "@/lib/payout";
import { USDC_MINT, MAX_STAKE_PER_WALLET, PROTOCOL_ADMIN } from "@/lib/constants";
import { getSupabase } from "@/lib/supabase";
import { signatureToBase64 } from "@/lib/signature";
import { buildProjectRegistrationMessage } from "@/lib/project-signing";

/* ──────────────────────────────────────────────────────────────────────────────
   Types & constants
   ────────────────────────────────────────────────────────────────────────────── */

type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

interface StepDef {
  id: StepId;
  title: string;
  subtitle: string;
  description: string;
}

const STEPS: StepDef[] = [
  { id: 1, title: "Browse Hackathons", subtitle: "Overview of all markets",
    description: "See all active, cutoff, and resolved hackathons. Each shows its total pool USDC, project count, and time remaining." },
  { id: 2, title: "Pick a Hackathon", subtitle: "View projects & stake",
    description: "Click into a hackathon to see project cards — each with stake totals and pool share %. Click any project to open the stake modal." },
  { id: 3, title: "Parlay Bet", subtitle: "Multi-pick conviction",
    description: "Select up to 3 projects in one transaction. Weight your allocation and estimate your payout based on tier allocations." },
  { id: 4, title: "Another Hackathon", subtitle: "Switch markets",
    description: "Browse a different hackathon to see its projects. The demo flows through multiple markets for the builder portion." },
  { id: 5, title: "Submit a Project", subtitle: "Builder registration",
    description: "Register your project with a GitHub URL. Fill in social links and upload an icon." },
  { id: 6, title: "Builder Deposit", subtitle: "Pay refundable deposit",
    description: "Pay the builder deposit (USDC) to activate your project for staking and enable the self-stake feature." },
  { id: 7, title: "Self-Stake", subtitle: "Back your own work",
    description: "Stake USDC on your own project to signal conviction. Self-stake is capped at 250 USDC and requires the deposit to be paid first." },
  { id: 8, title: "Admin Panel", subtitle: "Organizer dashboard",
    description: "Protocol admins can manage whitelists, approve submissions, and administer all hackathons." },
  { id: 9, title: "Create Hackathon", subtitle: "Launch a new market",
    description: "Protocol admins create a new hackathon: name, deadline, prize tiers, deposit amount, and fee configuration." },
  { id: 10, title: "Resolve Hackathon", subtitle: "Set ranks & finalize",
    description: "Admin sets project ranks then finalizes. This snapshots tier counts and opens claims — it is irreversible." },
  { id: 11, title: "Claim Rewards", subtitle: "Collect your payout",
    description: "If you staked on winning projects, claim your share of the prize pool minus the protocol fee." },
  { id: 12, title: "Builder Deposit Refund", subtitle: "Reclaim your deposit",
    description: "Builders who completed the submission + approval flow can reclaim their refundable deposit." },
];

/* ──────────────────────────────────────────────────────────────────────────────
   Shared helpers
   ────────────────────────────────────────────────────────────────────────────── */

const TX_TIMEOUT = 30_000;

async function sendTxWithConfirm({
  connection, feePayer, sendTransaction, transaction,
  verifySuccess,
}: {
  connection: any; feePayer: PublicKey;
  sendTransaction: any; transaction: any;
  verifySuccess?: () => Promise<boolean>;
}) {
  const bh = await connection.getLatestBlockhash("confirmed");
  if ("feePayer" in transaction && !transaction.feePayer) transaction.feePayer = feePayer;
  if ("recentBlockhash" in transaction) transaction.recentBlockhash = bh.blockhash;

  let sig: string;
  try {
    sig = await sendTransaction(transaction, connection, { preflightCommitment: "confirmed" });
    if (!sig || typeof sig !== "string") throw new Error("Wallet rejected transaction");
  } catch (e: any) {
    const m = e?.message ?? String(e);
    if (/simulation|rejected/i.test(m)) throw e;
    throw new Error(`Send failed: ${m}`);
  }

  try {
    const conf = await Promise.race([
      connection.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed"),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Confirmation timed out")), TX_TIMEOUT)),
    ]);
    if (conf?.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
  } catch (e: any) {
    if (verifySuccess && (await verifySuccess())) return sig;
    try {
      const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
      if (st?.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(st.value.err)}`);
      if (st?.value?.confirmationStatus === "confirmed" || st?.value?.confirmationStatus === "finalized") return sig;
    } catch { /* fall through */ }
    throw e;
  }
  return sig;
}

function hackathonPhase(h: HackathonInfo): "active" | "resolving" | "resolved" {
  if (h.isResolved) return "resolved";
  const now = Math.floor(Date.now() / 1000);
  if (now >= h.cutoffTimestamp) return "resolving";
  return "active";
}

/* ──────────────────────────────────────────────────────────────────────────────
   Demo Page
   ────────────────────────────────────────────────────────────────────────────── */

export default function DemoPage() {
  const { publicKey, signMessage, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();

  const [activeStep, setActiveStep] = useState<StepId>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secondId, setSecondId] = useState<string | null>(null);
  const [parlayOpen, setParlayOpen] = useState(false);
  const [version, setVersion] = useState(0);

  const { hackathons, projectCounts, loading: hLoading, error: hError, reload: reloadH } = useHackathons();
  const hackathonMeta = useHackathonMeta(hackathons.map(h => h.pubkey.toBase58()));

  const selected = hackathons.find(h => h.pubkey.toBase58() === selectedId) ?? null;
  const second = hackathons.find(h => h.pubkey.toBase58() === secondId) ?? null;

  const { projects, loading: pLoading, error: pError, reload: reloadP } = useProjects(selected?.pubkey ?? null);
  const { projects: projects2, reload: reloadP2 } = useProjects(second?.pubkey ?? null);

  const { stakesByProject } = useUserStakesForProjects(publicKey, projects, version);
  const { stakesByProject: stakesByProject2 } = useUserStakesForProjects(publicKey, projects2, version);

  const { isProtocolAdmin, isSuperAdmin, loading: adminLoading } = useIsProtocolAdmin(publicKey);
  const isAdmin = isProtocolAdmin || isSuperAdmin;

  const projectNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projects) m[p.pubkey.toBase58()] = repoName(p.githubUrl);
    return m;
  }, [projects]);

  function refresh() { setVersion(v => v + 1); reloadP(); reloadP2(); reloadH(); }

  /* Scroll to step when activeStep changes */
  useEffect(() => {
    document.getElementById(`demo-step-${activeStep}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeStep]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <div className="demo-layout">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="demo-sidebar">
          <div className="demo-sidebar-header">
            <h2 className="demo-sidebar-title">Demo Walkthrough</h2>
            <p className="demo-sidebar-subtitle">12 steps</p>
          </div>
          <nav className="demo-sidebar-nav">
            {STEPS.map(s => (
              <button key={s.id} onClick={() => setActiveStep(s.id)}
                className={`demo-step-nav-item${activeStep === s.id ? " demo-step-nav-active" : ""}`}>
                <span className="demo-step-num">{s.id}</span>
                <div className="demo-step-nav-text">
                  <span className="demo-step-nav-title">{s.title}</span>
                  <span className="demo-step-nav-subtitle">{s.subtitle}</span>
                </div>
              </button>
            ))}
          </nav>
          <div className="demo-sidebar-footer">
            {!publicKey ? <ConnectWalletButton fullWidth /> : (
              <div className="demo-wallet-badge">
                <span className="demo-wallet-dot" />
                {publicKey.toBase58().slice(0,4)}...{publicKey.toBase58().slice(-4)}
              </div>
            )}
          </div>
        </aside>

        {/* ── Content ─────────────────────────────────────────────── */}
        <main className="demo-content">
          {STEPS.map(s => {
            const isActive = activeStep === s.id;
            return (
              <section key={s.id} id={`demo-step-${s.id}`}
                className={`demo-step${isActive ? " demo-step-active" : " demo-step-collapsed"}`}>
                <button className="demo-step-header"
                  onClick={() => setActiveStep(isActive ? s.id : s.id)}>
                  <div className="demo-step-header-left">
                    <span className={`demo-step-badge${isActive ? " demo-step-badge-active" : ""}`}>{s.id}</span>
                    <div>
                      <h3 className="demo-step-title">{s.title}</h3>
                      <p className="demo-step-subtitle">{s.subtitle}</p>
                    </div>
                  </div>
                  <span className="demo-step-arrow">{isActive ? "▲" : "▼"}</span>
                </button>
                {isActive && (
                  <div className="demo-step-body">
                    <p className="demo-step-description">{s.description}</p>

                    {/* ── Step 1: Browse ────────────────────────── */}
                    {s.id === 1 && <StepBrowse hackathons={hackathons} projectCounts={projectCounts}
                      meta={hackathonMeta} loading={hLoading} error={hError}
                      onPick={id => { setSelectedId(id); setActiveStep(2); }} />}

                    {/* ── Step 2: Pick ──────────────────────────── */}
                    {s.id === 2 && <StepPick hackathon={selected} projects={projects}
                      loading={pLoading} error={pError} stakesByProject={stakesByProject}
                      hackathons={hackathons} meta={hackathonMeta}
                      selectedId={selectedId} onSelect={id => { setSelectedId(id); refresh(); }}
                      onOpenParlay={() => setParlayOpen(true)} refresh={refresh} publicKey={publicKey} />}

                    {/* ── Step 3: Parlay ────────────────────────── */}
                    {s.id === 3 && <StepParlay hackathon={selected} projects={projects}
                      projectNames={projectNames} stakesByProject={stakesByProject}
                      parlayOpen={parlayOpen} onOpen={() => setParlayOpen(true)}
                      onClose={() => setParlayOpen(false)}
                      onSuccess={() => { refresh(); setActiveStep(4); }} publicKey={publicKey} />}

                    {/* ── Step 4: Another ───────────────────────── */}
                    {s.id === 4 && <StepBrowse hackathons={hackathons} projectCounts={projectCounts}
                      meta={hackathonMeta} loading={hLoading} error={hError} exclude={selectedId ?? undefined}
                      onPick={id => { setSecondId(id); setActiveStep(5); }} compact />}

                    {/* ── Step 5: Submit ────────────────────────── */}
                    {s.id === 5 && <StepSubmit hackathon={second} publicKey={publicKey}
                      anchorWallet={anchorWallet} signMessage={signMessage}
                      sendTransaction={sendTransaction} connection={connection}
                      onDone={() => { refresh(); setActiveStep(6); }} />}

                    {/* ── Step 6: Deposit ───────────────────────── */}
                    {s.id === 6 && <StepDeposit hackathon={second} publicKey={publicKey}
                      anchorWallet={anchorWallet} sendTransaction={sendTransaction}
                      connection={connection} onDone={() => { refresh(); setActiveStep(7); }} />}

                    {/* ── Step 7: Self-Stake ────────────────────── */}
                    {s.id === 7 && <StepSelfStake hackathon={second} publicKey={publicKey}
                      anchorWallet={anchorWallet} sendTransaction={sendTransaction}
                      connection={connection} projects={projects2}
                      onDone={() => { refresh(); setActiveStep(8); }} />}

                    {/* ── Step 8: Admin ─────────────────────────── */}
                    {s.id === 8 && <StepAdmin isAdmin={isAdmin} adminLoading={adminLoading}
                      hackathons={hackathons} publicKey={publicKey} />}

                    {/* ── Step 9: Create ────────────────────────── */}
                    {s.id === 9 && <StepCreate isAdmin={isAdmin} publicKey={publicKey}
                      anchorWallet={anchorWallet} sendTransaction={sendTransaction}
                      connection={connection} onCreated={() => { reloadH(); setActiveStep(10); }} />}

                    {/* ── Step 10: Resolve ──────────────────────── */}
                    {s.id === 10 && <StepResolve isAdmin={isAdmin} hackathons={hackathons}
                      publicKey={publicKey} anchorWallet={anchorWallet}
                      sendTransaction={sendTransaction} connection={connection}
                      onResolved={() => { refresh(); setActiveStep(11); }} />}

                    {/* ── Step 11: Claim ────────────────────────── */}
                    {s.id === 11 && <StepClaim hackathon={selected} projects={projects}
                      stakesByProject={stakesByProject} publicKey={publicKey}
                      onSuccess={refresh} />}

                    {/* ── Step 12: Refund ───────────────────────── */}
                    {s.id === 12 && <StepRefund hackathon={selected} publicKey={publicKey}
                      anchorWallet={anchorWallet} sendTransaction={sendTransaction}
                      connection={connection} projects={projects} onSuccess={refresh} />}

                    {/* ── Nav ────────────────────────────────────── */}
                    <div className="demo-step-nav-buttons">
                      {s.id > 1 && <button onClick={() => setActiveStep((s.id - 1) as StepId)}
                        className="ui-btn ui-btn-outline ui-btn-sm">← Previous</button>}
                      {s.id < 12 && <button onClick={() => setActiveStep((s.id + 1) as StepId)}
                        className="ui-btn ui-btn-indigo ui-btn-sm">Next Step →</button>}
                      {s.id === 12 && <button onClick={() => { setActiveStep(1); }}
                        className="ui-btn ui-btn-emerald ui-btn-sm">↻ Restart Demo</button>}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </main>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 1 / Step 4 — Browse Hackathons
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepBrowse({ hackathons, projectCounts, meta, loading, error, onPick, exclude, compact }: {
  hackathons: HackathonInfo[]; projectCounts: Record<string, number>;
  meta: Record<string, any>; loading: boolean; error: string | null;
  onPick: (id: string) => void; exclude?: string; compact?: boolean;
}) {
  const [tab, setTab] = useState<"ongoing" | "cutoff" | "resolved">("ongoing");

  const phases = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const m: Record<string, HackathonInfo[]> = { ongoing: [], cutoff: [], resolved: [] };
    for (const h of hackathons) {
      if (exclude && h.pubkey.toBase58() === exclude) continue;
      if (h.isResolved) m.resolved.push(h);
      else if (now >= h.cutoffTimestamp) m.cutoff.push(h);
      else m.ongoing.push(h);
    }
    return m;
  }, [hackathons, exclude]);

  const list = phases[tab];

  if (loading) return <div className="ui-skeleton" style={{ height: 120 }} />;
  if (error) return <div className="demo-error">{error}</div>;

  return (
    <div>
      <div className="demo-tab-row" style={{ marginBottom: 12 }}>
        {(["ongoing","cutoff","resolved"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`demo-tab${tab === t ? " demo-tab-active" : ""}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className="demo-tab-count">{phases[t].length}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="demo-empty">No hackathons in this tab.</div>
      ) : (
        <div className="demo-hackathon-list">
          {list.map(h => {
            const id = h.pubkey.toBase58();
            const m = meta[id];
            const count = projectCounts[id] ?? 0;
            const status = hackathonStatus(h);
            return (
              <button key={id} onClick={() => onPick(id)}
                className="demo-hackathon-card"
                style={compact ? { padding: "12px 16px" } : undefined}>
                <div className="demo-hc-left">
                  <span className="demo-hc-name">{m?.name ?? h.name}</span>
                  <span className="demo-hc-meta">{count} projects · {status === "ongoing" ? timeUntil(h.cutoffTimestamp) : status === "cutoff" ? "Cutoff" : "Resolved"}</span>
                </div>
                <div className="demo-hc-right">
                  <span className="demo-hc-pool">{formatTokens(h.totalPool)} USDC</span>
                  <span className="demo-hc-label">Total pool</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 2 — Pick a Hackathon (Project list)
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepPick({ hackathon, projects, loading, error, stakesByProject, hackathons, meta, selectedId, onSelect, onOpenParlay, refresh, publicKey }: {
  hackathon: HackathonInfo | null; projects: ProjectInfo[]; loading: boolean; error: string | null;
  stakesByProject: Record<string, UserStakeInfo | null>; hackathons: HackathonInfo[];
  meta: Record<string, any>; selectedId: string | null; onSelect: (id: string) => void;
  onOpenParlay: () => void; refresh: () => void; publicKey: PublicKey | null;
}) {
  if (!hackathon) {
    return (
      <div className="demo-prompt">
        <p>Select a hackathon from Step 1 first, or pick one here:</p>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {hackathons.filter(h => hackathonPhase(h) === "active").slice(0, 5).map(h => {
            const id = h.pubkey.toBase58();
            return <button key={id} onClick={() => onSelect(id)}
              className="ui-btn ui-btn-outline ui-btn-sm">{meta[id]?.name ?? h.name}</button>;
          })}
        </div>
      </div>
    );
  }

  if (loading) return <div className="ui-skeleton" style={{ height: 200 }} />;
  if (error) return <div className="demo-error">{error}</div>;

  const m = meta[hackathon.pubkey.toBase58()];
  const status = hackathonStatus(hackathon);
  const claimable = projects.filter(p => p.rank > 0 && stakesByProject[p.pubkey.toBase58()] && !stakesByProject[p.pubkey.toBase58()]!.isClaimed);

  return (
    <div>
      <div className="demo-section-header">
        <div>
          <h4 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800 }}>{m?.name ?? hackathon.name}</h4>
          <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--c-text-3)" }}>
            {formatTokens(hackathon.totalPool)} USDC · {projects.length} projects · {status === "ongoing" ? timeUntil(hackathon.cutoffTimestamp) : status}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {status === "ongoing" && <button onClick={onOpenParlay} className="ui-btn ui-btn-indigo ui-btn-sm">Parlay Bet</button>}
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="demo-empty">No projects registered yet.</div>
      ) : (
        <div className="demo-project-list">
          {projects.sort((a, b) => Number(b.totalStaked - a.totalStaked)).map(p => (
            <ProjectRow key={p.pubkey.toBase58()} hackathon={hackathon} project={p}
              stake={stakesByProject[p.pubkey.toBase58()] ?? null}
              onSuccess={refresh} />
          ))}
        </div>
      )}

      {claimable.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <ClaimSlipButton hackathon={hackathon} claimableProjects={claimable}
            stakesByProject={stakesByProject} onSuccess={refresh} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 3 — Parlay Bet
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepParlay({ hackathon, projects, projectNames, stakesByProject, parlayOpen, onOpen, onClose, onSuccess, publicKey }: {
  hackathon: HackathonInfo | null; projects: ProjectInfo[]; projectNames: Record<string, string>;
  stakesByProject: Record<string, UserStakeInfo | null>; parlayOpen: boolean;
  onOpen: () => void; onClose: () => void; onSuccess: () => void; publicKey: PublicKey | null;
}) {
  const { isWhitelisted } = useWhitelistStatus(hackathon?.pubkey ?? null, publicKey);

  if (!hackathon) return <div className="demo-prompt">Pick a hackathon in Step 2 first.</div>;
  if (hackathonPhase(hackathon) !== "active") return <div className="demo-prompt">Staking is closed for this hackathon (cutoff passed or resolved).</div>;
  if (projects.length === 0) return <div className="demo-prompt">No projects in this hackathon yet. Submit one in Step 5.</div>;

  return (
    <div>
      {!publicKey ? (
        <div className="demo-prompt"><ConnectWalletButton /> Connect your wallet to place a parlay.</div>
      ) : (
        <>
          <button onClick={onOpen} className="ui-btn ui-btn-indigo">Open Parlay</button>
          {parlayOpen && (
            <ParlayModal hackathon={hackathon} projects={projects}
              projectNames={projectNames} stakesByProject={stakesByProject}
              isWhitelisted={isWhitelisted} onClose={onClose} onSuccess={onSuccess} />
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 5 — Submit Project
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepSubmit({ hackathon, publicKey, anchorWallet, signMessage, sendTransaction, connection, onDone }: {
  hackathon: HackathonInfo | null; publicKey: PublicKey | null; anchorWallet: AnchorWallet | undefined;
  signMessage: ((msg: Uint8Array) => Promise<Uint8Array>) | undefined;
  sendTransaction: any; connection: any; onDone: () => void;
}) {
  const [name, setName] = useState("My Demo Project");
  const [url, setUrl] = useState("https://github.com/myorg/my-demo-project");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [twitter, setTwitter] = useState("@demo_builder");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  if (!hackathon) return <div className="demo-prompt">Pick a hackathon in Step 4 first.</div>;
  if (!publicKey || !signMessage) return <div className="demo-prompt"><ConnectWalletButton /> Connect a wallet that supports message signing.</div>;

  async function handleSubmit() {
    if (!name.trim()) { setErr("Project name required"); return; }
    if (name.trim().length > 120) { setErr("Name too long (max 120 chars)"); return; }
    if (!url.startsWith("https://github.com/")) { setErr("URL must start with https://github.com/"); return; }
    if (url.length > 200) { setErr("URL too long (max 200 chars)"); return; }

    setErr(null); setBusy(true);
    try {
      const projectPk = await projectPdaFromUrl(hackathon.pubkey, url);
      if (!hackathon.requiresApproval && anchorWallet) {
        const existing = await (getReadonlyProgram().account as any).projectAccount.fetchNullable(projectPk).catch(() => null);
        if (existing) {
          const eb = (existing.builderWallet as PublicKey).toBase58();
          if (eb !== publicKey.toBase58()) throw new Error("Already registered by a different wallet");
        } else {
          const normalized = normalizeGitHubUrl(url);
          const urlHash = Array.from(await hashUrl(url));
          const program = getProgram(anchorWallet);
          await (program.methods as any).registerProject(normalized, urlHash).accounts({
            caller: publicKey, builder: publicKey, hackathon: hackathon.pubkey,
            project: projectPk, systemProgram: SystemProgram.programId,
          }).rpc();
        }
      }
      const sig = signatureToBase64(await signMessage(new TextEncoder().encode(buildProjectRegistrationMessage(projectPk.toBase58()))));
      let iconB64: string | null = null;
      if (iconFile) {
        try {
          const bmp = await createImageBitmap(iconFile, { resizeWidth: 256, resizeHeight: 256 });
          const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
          const ctx = canvas.getContext("2d"); if (ctx) { ctx.drawImage(bmp, 0, 0); iconB64 = canvas.toDataURL("image/png", 0.7); }
          bmp.close();
        } catch { /* ignore icon errors */ }
      }
      await fetch("/api/project-submission", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authEmail: null, discord: discord.trim() || undefined,
          githubUrl: url, hackathonPubkey: hackathon.pubkey.toBase58(),
          iconBase64: iconB64, projectName: name.trim(),
          projectPubkey: projectPk.toBase58(), signature: sig,
          telegram: telegram.trim() || undefined,
          twitterHandle: twitter.replace(/^@/, "").trim() || undefined,
          walletAddress: publicKey.toBase58(),
        }),
      });
      setOk(true);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  const lbl: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" };

  if (ok) return (
    <div className="demo-success">
      <p><strong>Submitted!</strong> {hackathon.requiresApproval ? "Pending organizer review." : hackathon.depositAmount > 0n ? "Now pay the deposit in Step 6." : "Your project is eligible for staking."}</p>
      <button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm" style={{ marginTop: 8 }}>Continue</button>
    </div>
  );

  return (
    <div className="demo-form-card">
      <p style={{ margin: "0 0 12px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-indigo-text)" }}>Submit to: {hackathon.name}</p>
      <div style={{ marginBottom: 10 }}><label style={lbl}>Project icon</label>
        {iconFile ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, overflow: "hidden", border: "1px solid var(--c-divider)" }}>
              <img src={URL.createObjectURL(iconFile)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <button onClick={() => setIconFile(null)} className="ui-btn ui-btn-outline-red ui-btn-xs">Remove</button>
          </div>
        ) : (
          <label style={{ display: "flex", width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px dashed var(--c-divider)", cursor: "pointer", color: "var(--c-text-4)", fontSize: "1.25rem" }}>
            +<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => setIconFile(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
          </label>
        )}
      </div>
      <div style={{ marginBottom: 10 }}><label style={lbl}>Project name *</label><input className="ui-input" value={name} onChange={e => setName(e.target.value)} /></div>
      <div style={{ marginBottom: 10 }}><label style={lbl}>GitHub URL *</label><input className="ui-input" value={url} onChange={e => setUrl(e.target.value)} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <div><label style={lbl}>Twitter / X</label><input className="ui-input" value={twitter} onChange={e => setTwitter(e.target.value)} /></div>
        <div><label style={lbl}>Telegram</label><input className="ui-input" value={telegram} onChange={e => setTelegram(e.target.value)} /></div>
        <div><label style={lbl}>Discord</label><input className="ui-input" value={discord} onChange={e => setDiscord(e.target.value)} /></div>
      </div>
      {err && <p style={{ fontSize: "0.875rem", color: "var(--c-red-text)", margin: "0 0 8px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSubmit} disabled={busy} className="ui-btn ui-btn-indigo ui-btn-sm">{busy ? "Submitting…" : "Submit Project"}</button>
        <button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm">Skip</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 6 — Builder Deposit
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepDeposit({ hackathon, publicKey, anchorWallet, sendTransaction, connection, onDone }: {
  hackathon: HackathonInfo | null; publicKey: PublicKey | null; anchorWallet: AnchorWallet | undefined;
  sendTransaction: any; connection: any; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [projectId, setProjectId] = useState("");

  if (!hackathon) return <div className="demo-prompt">Pick a hackathon in Step 4 first.</div>;
  if (!publicKey || !anchorWallet) return <div className="demo-prompt"><ConnectWalletButton /> Connect your wallet.</div>;

  const deposit = hackathon.depositAmount;
  if (deposit <= 0n) return <div className="demo-success">This hackathon has no deposit requirement. Continue to Step 7.</div>;

  async function pay() {
    if (!projectId) { setErr("Enter your project's public key from Step 5"); return; }
    setBusy(true); setErr(null);
    try {
      const projectPk = new PublicKey(projectId);
      const builderAta = getAssociatedTokenAddressSync(hackathon!.usdcMint, publicKey!);
      const escrow = escrowPda(hackathon!.pubkey);
      const program = getProgram(anchorWallet!);
      const tx = await (program.methods as any).payDeposit().accounts({
        builder: publicKey!, hackathon: hackathon!.pubkey, project: projectPk,
        builderTokenAccount: builderAta, escrow, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction();
      await sendTxWithConfirm({ connection, feePayer: publicKey!, sendTransaction, transaction: tx,
        verifySuccess: async () => {
          const r = await (getReadonlyProgram().account as any).projectAccount.fetchNullable(projectPk).catch(() => null);
          return BigInt((r?.depositAmountPaid ?? 0).toString()) > 0n;
        },
      });
      setOk(true);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  if (ok) return <div className="demo-success"><p><strong>Deposit paid!</strong> Continue to Step 7.</p><button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm" style={{ marginTop: 8 }}>Continue</button></div>;

  return (
    <div className="demo-form-card">
      <p style={{ margin: "0 0 12px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-indigo-text)" }}>Deposit: {formatTokens(deposit)} USDC</p>
      <div style={{ marginBottom: 10 }}><label style={{ display: "block", marginBottom: 4, fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" }}>Project public key (from Step 5)</label>
        <input className="ui-input" value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="Paste project pubkey…" /></div>
      {err && <p style={{ fontSize: "0.875rem", color: "var(--c-red-text)", margin: "0 0 8px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={pay} disabled={busy} className="ui-btn ui-btn-indigo ui-btn-sm">{busy ? "Paying…" : `Pay ${formatTokens(deposit)} USDC`}</button>
        <button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm">Skip</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 7 — Self-Stake
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepSelfStake({ hackathon, publicKey, anchorWallet, sendTransaction, connection, projects, onDone }: {
  hackathon: HackathonInfo | null; publicKey: PublicKey | null; anchorWallet: AnchorWallet | undefined;
  sendTransaction: any; connection: any; projects: ProjectInfo[]; onDone: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const balance = useTokenBalance(publicKey, hackathon?.usdcMint ?? USDC_MINT);

  if (!hackathon) return <div className="demo-prompt">Pick a hackathon in Step 4 first.</div>;
  if (!publicKey || !anchorWallet) return <div className="demo-prompt"><ConnectWalletButton /> Connect your wallet.</div>;

  async function stake() {
    const raw = parseTokens(amt || "0");
    if (raw <= 0n) { setErr("Enter an amount"); return; }
    if (raw + (balance ?? 0n) > balance) { setErr("Insufficient balance"); return; }
    if (!projectId) { setErr("Enter your project public key"); return; }
    setBusy(true); setErr(null);
    try {
      const projectPk = new PublicKey(projectId);
      const userStakePk = stakePda(publicKey!, projectPk);
      const builderAta = getAssociatedTokenAddressSync(hackathon!.usdcMint, publicKey!);
      const escrow = escrowPda(hackathon!.pubkey);
      const program = getProgram(anchorWallet!);
      const tx = await (program.methods as any).selfStake(new BN(raw.toString())).accounts({
        builder: publicKey!, hackathon: hackathon!.pubkey, project: projectPk,
        userStake: userStakePk, builderTokenAccount: builderAta, escrow,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).transaction();
      await sendTxWithConfirm({ connection, feePayer: publicKey!, sendTransaction, transaction: tx });
      setOk(true);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  if (ok) return <div className="demo-success"><p><strong>Self-staked!</strong></p><button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm" style={{ marginTop: 8 }}>Continue</button></div>;

  return (
    <div className="demo-form-card">
      <p style={{ margin: "0 0 8px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-indigo-text)" }}>Self-Stake on your project</p>
      <p style={{ fontSize: "0.75rem", color: "var(--c-text-4)", margin: "0 0 12px" }}>Max 250 USDC. Deposit must be paid first. Wallet balance: {formatTokens(balance ?? 0n)} USDC</p>
      <div style={{ marginBottom: 10 }}><label style={{ display: "block", marginBottom: 4, fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" }}>Project public key</label>
        <input className="ui-input" value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="Paste project pubkey…" /></div>
      <div style={{ marginBottom: 10 }}><label style={{ display: "block", marginBottom: 4, fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" }}>Amount (USDC)</label>
        <input className="ui-input" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00" /></div>
      {err && <p style={{ fontSize: "0.875rem", color: "var(--c-red-text)", margin: "0 0 8px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={stake} disabled={busy} className="ui-btn ui-btn-indigo ui-btn-sm">{busy ? "Staking…" : "Self-Stake"}</button>
        <button onClick={onDone} className="ui-btn ui-btn-outline ui-btn-sm">Skip</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 8 — Admin Panel
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepAdmin({ isAdmin, adminLoading, hackathons, publicKey }: {
  isAdmin: boolean; adminLoading: boolean; hackathons: HackathonInfo[];
  publicKey: PublicKey | null;
}) {
  if (!publicKey) return <div className="demo-prompt"><ConnectWalletButton /> Connect your admin wallet.</div>;
  if (adminLoading) return <div className="ui-skeleton" style={{ height: 80 }} />;
  if (!isAdmin) return (
    <div className="demo-info">
      <p><strong>Your wallet is not an admin.</strong></p>
      <p style={{ fontSize: "0.875rem", color: "var(--c-text-3)" }}>The admin panel is for protocol admins and hackathon organizers. You can skip to Step 9 to see the create form (it will be disabled for non-admins), or continue to Step 11.</p>
    </div>
  );

  const phases = useMemo(() => {
    const m: Record<string, HackathonInfo[]> = { active: [], resolving: [], resolved: [] };
    for (const h of hackathons) m[hackathonPhase(h)].push(h);
    return m;
  }, [hackathons]);

  return (
    <div>
      <div className="demo-success" style={{ marginBottom: 12 }}>
        <p><strong>Admin access confirmed.</strong> You can manage hackathons, whitelist stakers, and resolve markets.</p>
      </div>
      {(["active","resolving","resolved"] as const).map(phase => (
        <div key={phase} style={{ marginBottom: 12 }}>
          <h5 style={{ margin: "0 0 6px", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>{phase} ({phases[phase].length})</h5>
          {phases[phase].slice(0, 5).map(h => (
            <div key={h.pubkey.toBase58()} className="demo-hc-row">
              <span style={{ fontWeight: 600 }}>{h.name}</span>
              <span style={{ fontSize: "0.8rem", color: "var(--c-text-4)" }}>{formatTokens(h.totalPool)} USDC</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 9 — Create Hackathon
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepCreate({ isAdmin, publicKey, anchorWallet, sendTransaction, connection, onCreated }: {
  isAdmin: boolean; publicKey: PublicKey | null; anchorWallet: AnchorWallet | undefined;
  sendTransaction: any; connection: any; onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("Demo Hackathon");
  const [date, setDate] = useState(() => {
    const d = new Date(Date.now() + 7 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("12:00");
  const [numTiers, setNumTiers] = useState(3);
  const [tierPcts, setTierPcts] = useState<number[]>([50, 30, 20]);
  const [tierCounts, setTierCounts] = useState<number[]>([3, 5, 0]);
  const [feeBps, setFeeBps] = useState(150);
  const [depositAmt, setDepositAmt] = useState(10);
  const [openStaking, setOpenStaking] = useState(true);
  const [openReg, setOpenReg] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (numTiers > tierPcts.length) {
      const p = [...tierPcts];
      while (p.length < numTiers) p.push(0);
      setTierPcts(p);
    } else if (numTiers < tierPcts.length) {
      setTierPcts(tierPcts.slice(0, numTiers));
    }
    if (numTiers > tierCounts.length) {
      const c = [...tierCounts];
      while (c.length < numTiers) c.push(0);
      setTierCounts(c);
    } else if (numTiers < tierCounts.length) {
      setTierCounts(tierCounts.slice(0, numTiers));
    }
  }, [numTiers]);

  if (!publicKey || !anchorWallet) return <div className="demo-prompt"><ConnectWalletButton /> Connect your wallet.</div>;
  if (!isAdmin) return <div className="demo-info"><p><strong>Only protocol admins can create hackathons.</strong> This form shows what the admin sees. It is non-functional without admin rights.</p></div>;

  async function create() {
    const pctSum = tierPcts.slice(0, numTiers).reduce((a, b) => a + b, 0);
    if (pctSum !== 100) { setErr(`Tier percentages must sum to 100 (currently ${pctSum})`); return; }
    for (let i = 0; i < numTiers - 1; i++) { if (tierCounts[i] < 1) { setErr(`Tier ${i + 1} count must be >= 1`); return; } }
    if (name.length > 32) { setErr("Name max 32 bytes"); return; }
    if (!/^[\x20-\x7E]+$/.test(name)) { setErr("ASCII only"); return; }

    const [h, m] = time.split(":").map(Number);
    const deadline = new Date(date + "T00:00:00Z");
    deadline.setUTCHours(h, m, 0, 0);
    const ts = Math.floor(deadline.getTime() / 1000);

    setBusy(true); setErr(null);
    try {
      const program = getProgram(anchorWallet!);
      const hackathonPk = hackathonPda(publicKey!, name.trim());
      const escrow = escrowPda(hackathonPk);
      const paddedPcts = Array(8).fill(0) as number[];
      for (let i = 0; i < numTiers; i++) paddedPcts[i] = tierPcts[i];
      const paddedCounts = Array(8).fill(0) as number[];
      for (let i = 0; i < numTiers; i++) paddedCounts[i] = tierCounts[i];

      const tx = await (program.methods as any).initializeHackathon(
        name.trim(), new BN(ts), numTiers, paddedPcts, paddedCounts,
        new BN(feeBps), new BN(depositAmt * 1_000_000), !openReg, openStaking,
      ).accounts({
        admin: publicKey!, hackathon: hackathonPk, escrow,
        usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction();
      await sendTxWithConfirm({ connection, feePayer: publicKey!, sendTransaction, transaction: tx });
      setOk(true); onCreated();
    } catch (e: any) {
      const m = (e?.message ?? String(e)).toLowerCase();
      if (m.includes("already in use")) setErr("Hackathon name already taken");
      else setErr(e.message ?? "Failed");
    }
    finally { setBusy(false); }
  }

  const lbl: React.CSSProperties = { display: "block", marginBottom: 4, fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" };

  if (ok) return <div className="demo-success"><p><strong>Hackathon created!</strong> Continue to Step 10.</p></div>;

  return (
    <div className="demo-form-card">
      {step === 1 ? (
        <>
          <div style={{ marginBottom: 10 }}><label style={lbl}>Name (max 32 bytes)</label><input className="ui-input" value={name} onChange={e => setName(e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div><label style={lbl}>Results date</label><input className="ui-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><label style={lbl}>Results time (UTC)</label><select className="ui-input" value={time} onChange={e => setTime(e.target.value)}>
              {Array.from({ length: 48 }, (_, i) => {
                const hh = String(Math.floor(i / 2)).padStart(2, "0");
                const mm = i % 2 === 0 ? "00" : "30";
                return <option key={`${hh}:${mm}`} value={`${hh}:${mm}`}>{`${hh}:${mm}`}</option>;
              })}
            </select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div><label style={lbl}>Tiers (1-8)</label><input className="ui-input" type="number" min={1} max={8} value={numTiers} onChange={e => setNumTiers(Number(e.target.value))} /></div>
            <div><label style={lbl}>Fee (bps)</label><input className="ui-input" type="number" min={0} max={3000} value={feeBps} onChange={e => setFeeBps(Number(e.target.value))} /></div>
            <div><label style={lbl}>Deposit (USDC)</label><input className="ui-input" type="number" min={0} value={depositAmt} onChange={e => setDepositAmt(Number(e.target.value))} /></div>
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", cursor: "pointer" }}><input type="checkbox" checked={openStaking} onChange={e => setOpenStaking(e.target.checked)} /> Open staking</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", cursor: "pointer" }}><input type="checkbox" checked={openReg} onChange={e => setOpenReg(e.target.checked)} /> Open registration</label>
          </div>
          <button onClick={() => setStep(2)} className="ui-btn ui-btn-indigo ui-btn-sm">Next: Configure Tiers</button>
        </>
      ) : (
        <>
          <p style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 10px", color: "var(--c-indigo-text)" }}>Tier configuration</p>
          {Array.from({ length: numTiers }, (_, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Tier {i + 1}</span>
              <div><label style={{ fontSize: "0.65rem", color: "var(--c-text-4)" }}>% of pool</label>
                <input className="ui-input" type="number" min={0} max={100} value={tierPcts[i] ?? 0}
                  onChange={e => { const p = [...tierPcts]; p[i] = Number(e.target.value); setTierPcts(p); }} /></div>
              <div><label style={{ fontSize: "0.65rem", color: "var(--c-text-4)" }}>{i < numTiers - 1 ? "Expected winners" : "Rest (auto)"}</label>
                {i < numTiers - 1 ? (
                  <input className="ui-input" type="number" min={1} value={tierCounts[i] ?? 0}
                    onChange={e => { const c = [...tierCounts]; c[i] = Number(e.target.value); setTierCounts(c); }} />
                ) : <span style={{ fontSize: "0.8rem", color: "var(--c-text-4)" }}>Remaining</span>}
              </div>
            </div>
          ))}
          <p style={{ fontSize: "0.7rem", color: "var(--c-text-4)" }}>Sum: {tierPcts.slice(0, numTiers).reduce((a, b) => a + b, 0)}% (must be 100%)</p>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setStep(1)} className="ui-btn ui-btn-outline ui-btn-sm">Back</button>
            {err && <p style={{ fontSize: "0.875rem", color: "var(--c-red-text)", margin: 0, flex: 1 }}>{err}</p>}
            <button onClick={create} disabled={busy} className="ui-btn ui-btn-indigo ui-btn-sm">{busy ? "Creating…" : "Create Hackathon"}</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 10 — Resolve Hackathon
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepResolve({ isAdmin, hackathons, publicKey, anchorWallet, sendTransaction, connection, onResolved }: {
  isAdmin: boolean; hackathons: HackathonInfo[]; publicKey: PublicKey | null;
  anchorWallet: AnchorWallet | undefined; sendTransaction: any; connection: any;
  onResolved: () => void;
}) {
  const [hId, setHId] = useState<string | null>(null);
  const [ranks, setRanks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [ok, setOk] = useState(false);

  const resolving = useMemo(() => hackathons.filter(h => hackathonPhase(h) === "resolving" && !h.isResolved), [hackathons]);
  const hackathon = resolving.find(h => h.pubkey.toBase58() === hId) ?? null;
  const { projects, loading: pLoad } = useProjects(hackathon?.pubkey ?? null);

  if (!publicKey || !anchorWallet) return <div className="demo-prompt"><ConnectWalletButton /> Connect your admin wallet.</div>;
  if (!isAdmin) return <div className="demo-info"><p><strong>Only admins can resolve.</strong> This shows the resolve interface but is read-only without admin rights.</p></div>;

  async function resolveAll() {
    if (!hackathon || projects.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const program = getProgram(anchorWallet!);
      const entries = Object.entries(ranks).filter(([, r]) => Number(r) > 0);
      for (const [pk, rank] of entries) {
        const tx = await (program.methods as any).resolve(Number(rank)).accounts({
          admin: publicKey!, hackathon: hackathon.pubkey,
          project: new PublicKey(pk),
        }).remainingAccounts(
          publicKey.toBase58() !== PROTOCOL_ADMIN ? [{ pubkey: protocolAdminPda(publicKey!), isWritable: false, isSigner: false }] : []
        ).transaction();
        await sendTxWithConfirm({ connection, feePayer: publicKey!, sendTransaction, transaction: tx });
      }
      setOk(true);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  async function finalize() {
    if (!hackathon || projects.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const program = getProgram(anchorWallet!);
      const ranked = projects.filter(p => (ranks[p.pubkey.toBase58()] && Number(ranks[p.pubkey.toBase58()]) > 0));
      const remaining = publicKey!.toBase58() !== PROTOCOL_ADMIN ? [{ pubkey: protocolAdminPda(publicKey!), isWritable: false, isSigner: false }] : [];
      remaining.push(...ranked.map(p => ({ pubkey: p.pubkey, isWritable: false, isSigner: false })));
      const tx = await (program.methods as any).finalizeResolve().accounts({
        admin: publicKey!, hackathon: hackathon.pubkey,
      }).remainingAccounts(remaining).transaction();
      await sendTxWithConfirm({ connection, feePayer: publicKey!, sendTransaction, transaction: tx });
      setFinalized(true); onResolved();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {resolving.length === 0 ? (
        <div className="demo-empty">No hackathons in resolving phase. Create one and wait for cutoff, or skip.</div>
      ) : (
        <>
          <div className="demo-tab-row" style={{ marginBottom: 12 }}>
            {resolving.map(h => (
              <button key={h.pubkey.toBase58()} onClick={() => setHId(h.pubkey.toBase58())}
                className={`demo-tab${hId === h.pubkey.toBase58() ? " demo-tab-active" : ""}`}>{h.name}</button>
            ))}
          </div>

          {hackathon && (
            <>
              {pLoad ? <div className="ui-skeleton" style={{ height: 100 }} /> : projects.length === 0 ? <div className="demo-empty">No projects.</div> : (
                <div className="demo-project-list">
                  {projects.map(p => {
                    const pk = p.pubkey.toBase58();
                    return (
                      <div key={pk} className="demo-hc-row">
                        <span style={{ fontWeight: 600 }}>{repoName(p.githubUrl)}</span>
                        <span style={{ fontSize: "0.8rem", color: "var(--c-text-4)" }}>{formatTokens(p.totalStaked)} USDC</span>
                        <input className="ui-input" style={{ width: 60, textAlign: "center" }}
                          value={ranks[pk] ?? (p.rank > 0 ? String(p.rank) : "")}
                          onChange={e => setRanks(prev => ({ ...prev, [pk]: e.target.value }))}
                          placeholder="Rank" disabled={finalized} />
                      </div>
                    );
                  })}
                </div>
              )}

              {finalized ? (
                <div className="demo-success" style={{ marginTop: 12 }}>Ranks finalized. Claims are now open.</div>
              ) : ok ? (
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="demo-success" style={{ flex: 1 }}>Ranks set. Now finalize.</div>
                  <button onClick={finalize} disabled={busy} className="ui-btn ui-btn-red ui-btn-sm">{busy ? "Finalizing…" : "Finalize"}</button>
                </div>
              ) : (
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button onClick={resolveAll} disabled={busy} className="ui-btn ui-btn-indigo ui-btn-sm">{busy ? "Setting ranks…" : "Set Ranks"}</button>
                </div>
              )}
              {err && <p style={{ fontSize: "0.875rem", color: "var(--c-red-text)", marginTop: 8 }}>{err}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 11 — Claim Rewards
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepClaim({ hackathon, projects, stakesByProject, publicKey, onSuccess }: {
  hackathon: HackathonInfo | null; projects: ProjectInfo[];
  stakesByProject: Record<string, UserStakeInfo | null>;
  publicKey: PublicKey | null; onSuccess: () => void;
}) {
  if (!hackathon) return <div className="demo-prompt">Pick a hackathon in Step 2 first.</div>;
  if (!publicKey) return <div className="demo-prompt"><ConnectWalletButton /> Connect your wallet.</div>;
  if (!hackathon.isResolved) return <div className="demo-prompt">This hackathon is not yet resolved. Resolve it in Step 10 first.</div>;

  const claimable = projects.filter(p => {
    const stake = stakesByProject[p.pubkey.toBase58()];
    return p.rank > 0 && stake && !stake.isClaimed && stake.amount > 0n;
  });

  if (claimable.length === 0) return (
    <div className="demo-info">
      <p>No claimable rewards found. You need:</p>
      <ul style={{ fontSize: "0.875rem", color: "var(--c-text-3)", paddingLeft: 20 }}>
        <li>A resolved hackathon with ranked projects</li>
        <li>An active (unclaimed) stake on at least one winning project</li>
      </ul>
    </div>
  );

  return (
    <div>
      <ClaimSlipButton hackathon={hackathon} claimableProjects={claimable}
        stakesByProject={stakesByProject} onSuccess={onSuccess} />
      <div className="demo-project-list" style={{ marginTop: 12 }}>
        {claimable.map(p => (
          <div key={p.pubkey.toBase58()} className="demo-hc-row">
            <span style={{ fontWeight: 600 }}>{repoName(p.githubUrl)}</span>
            <span style={{ fontSize: "0.8rem", color: "var(--c-text-4)" }}>Rank #{p.rank}</span>
            <ClaimButton hackathon={hackathon} project={p} onSuccess={onSuccess} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Step 12 — Builder Deposit Refund
   ═══════════════════════════════════════════════════════════════════════════════ */

function StepRefund({ hackathon, publicKey, anchorWallet, sendTransaction, connection, projects, onSuccess }: {
  hackathon: HackathonInfo | null; publicKey: PublicKey | null; anchorWallet: AnchorWallet | undefined;
  sendTransaction: any; connection: any; projects: ProjectInfo[]; onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  if (!hackathon) return <div className="demo-prompt">Pick a hackathon in Step 2 first.</div>;
  if (!publicKey || !anchorWallet) return <div className="demo-prompt"><ConnectWalletButton /> Connect your wallet.</div>;

  const myProjects = projects.filter(p => {
    try { return p.builderWallet.equals(publicKey!); } catch { return false; }
  });

  const refundable = myProjects.filter(p => p.depositAmountPaid > 0n && !p.depositForfeited && !p.depositRefunded && (p.isRefundEnabled || p.submitted));

  if (refundable.length === 0) return (
    <div className="demo-info">
      <p>No refundable deposits found. You need:</p>
      <ul style={{ fontSize: "0.875rem", color: "var(--c-text-3)", paddingLeft: 20 }}>
        <li>A project where you paid the deposit</li>
        <li>The deposit must not already be refunded or forfeited</li>
        <li>Organizer must have approved your submission (or refund override must be enabled)</li>
      </ul>
    </div>
  );

  async function refund(pk: PublicKey) {
    setBusy(true); setErr(null);
    try {
      const builderAta = getAssociatedTokenAddressSync(hackathon!.usdcMint, publicKey!);
      const escrow = escrowPda(hackathon!.pubkey);
      const program = getProgram(anchorWallet!);
      const tx = await (program.methods as any).claimDepositRefund().accounts({
        builder: publicKey!, hackathon: hackathon!.pubkey, project: pk,
        builderTokenAccount: builderAta, escrow, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).transaction();
      await sendTxWithConfirm({ connection, feePayer: publicKey!, sendTransaction, transaction: tx });
      setOk(true); onSuccess();
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  if (ok) return <div className="demo-success"><p><strong>Deposit refunded!</strong></p></div>;

  return (
    <div>
      {refundable.map(p => (
        <div key={p.pubkey.toBase58()} className="demo-hc-row">
          <span style={{ fontWeight: 600 }}>{repoName(p.githubUrl)}</span>
          <span style={{ fontSize: "0.8rem", color: "var(--c-text-4)" }}>{formatTokens(p.depositAmountPaid)} USDC deposit</span>
          <button onClick={() => refund(p.pubkey)} disabled={busy} className="ui-btn ui-btn-emerald ui-btn-sm">{busy ? "Claiming…" : "Claim Refund"}</button>
        </div>
      ))}
      {err && <p style={{ fontSize: "0.875rem", color: "var(--c-red-text)", marginTop: 8 }}>{err}</p>}
    </div>
  );
}
