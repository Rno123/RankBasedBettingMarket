"use client";

import { useState, useEffect } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { getProgram } from "@/lib/program";
import { hackathonPda, escrowPda } from "@/lib/pda";
import { useHackathons } from "@/hooks/useHackathons";
import { useProjects } from "@/hooks/useProjects";
import { formatTokens, formatDate } from "@/lib/format";
import { USDC_MINT, PROTOCOL_ADMIN } from "@/lib/constants";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

// ── Create Hackathon ──────────────────────────────────────────────────────────

function CreateHackathonPanel({ onCreated }: { onCreated: () => void }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [step, setStep] = useState<1 | 2>(1);
  const [hackathonName, setHackathonName] = useState("");
  const [resultsDate, setResultsDate] = useState("");
  const [numTiers, setNumTiers] = useState<number>(3);
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
    setStep(2);
  }

  async function handleCreate() {
    if (!publicKey || !anchorWallet) return;
    setErr(null);
    const pcts = tierPcts.map((v) => parseInt(v));
    const counts = tierCounts.map((v, i) => i === numTiers - 1 ? 0 : parseInt(v));
    if (pcts.some(isNaN) || pcts.some((v) => v < 1)) { setErr("All tier % must be ≥ 1"); return; }
    if (pcts.reduce((a, b) => a + b, 0) !== 100) { setErr("Tier % must sum to 100"); return; }
    for (let i = 0; i < numTiers - 1; i++) {
      if (isNaN(counts[i]) || counts[i] < 1) { setErr(`Tier ${i + 1} count must be ≥ 1`); return; }
    }
    setBusy(true);
    try {
      const trimmedName = hackathonName.trim();
      const resultsTs = Math.floor(new Date(resultsDate).getTime() / 1000);
      const program = getProgram(anchorWallet);
      const hackathon = hackathonPda(publicKey, trimmedName);
      const escrow = escrowPda(hackathon);
      await (program.methods as any)
        .initializeHackathon(trimmedName, new BN(resultsTs), Buffer.from(pcts), Buffer.from(counts))
        .accounts({ admin: publicKey, hackathon, escrow, usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .rpc();
      setOk(`Hackathon "${trimmedName}" created`);
      onCreated();
    } catch (e: any) {
      const logs: string[] | undefined = typeof e.getLogs === "function" ? await e.getLogs() : e.logs;
      const alreadyInUse = (e.message ?? "").includes("already in use") || (logs ?? []).some((l: string) => l.includes("already in use"));
      setErr(alreadyInUse ? `A hackathon named "${hackathonName.trim()}" already exists.` : logs?.length ? logs.join("\n") : (e.message ?? "Failed"));
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-bold text-slate-900">Create Hackathon</h2>
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
            <input className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" placeholder="e.g. Solana Breakpoint 2025" value={hackathonName} onChange={(e) => setHackathonName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Results date &amp; time</label>
            <input type="datetime-local" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" value={resultsDate} onChange={(e) => setResultsDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Number of tiers (1–8)</label>
            <input type="number" min={1} max={8} className="w-24 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" value={numTiers} onChange={(e) => handleNumTiersChange(parseInt(e.target.value))} />
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Set the prize pool % for each tier (must sum to 100).</p>
          {Array.from({ length: numTiers }).map((_, i) => {
            const isLast = i === numTiers - 1;
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="w-16 text-sm text-slate-600">Tier {i + 1}</span>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={100} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-center" placeholder="%" value={tierPcts[i] ?? ""} onChange={(e) => { const n = [...tierPcts]; n[i] = e.target.value; setTierPcts(n); }} />
                  <span className="text-xs text-slate-400">%</span>
                </div>
                <div className="flex items-center gap-1">
                  <input type="number" min={1} className={`w-20 rounded-lg border px-2 py-1.5 text-sm text-center ${isLast ? "border-slate-200 bg-slate-50 text-slate-300" : "border-slate-300"}`} placeholder={isLast ? "rest" : "# projects"} disabled={isLast} value={isLast ? "" : (tierCounts[i] ?? "")} onChange={(e) => { const n = [...tierCounts]; n[i] = e.target.value; setTierCounts(n); }} />
                  <span className="text-xs text-slate-400">projects</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600 whitespace-pre-wrap">{err}</p>}
      {ok && <p className="mt-3 text-sm text-emerald-600">{ok}</p>}
      <div className="mt-4 flex gap-3">
        {step === 2 && <button onClick={() => setStep(1)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">← Back</button>}
        {step === 1 && <button onClick={handleStep1Next} disabled={!publicKey} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Next — configure tiers</button>}
        {step === 2 && <button onClick={handleCreate} disabled={busy || !publicKey} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? "Creating…" : "Create hackathon"}</button>}
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
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Resolve projects</h3>
      <div className="space-y-2">
        {projects.map((p) => (
          <div key={p.pubkey.toBase58()} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-slate-600">{p.githubUrl.replace("https://github.com/", "")}</span>
            <input type="number" min="0" placeholder="rank" className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm text-center" value={ranks[p.pubkey.toBase58()] ?? ""} onChange={(e) => setRanks((r) => ({ ...r, [p.pubkey.toBase58()]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={handleResolveAll} disabled={busy || !publicKey} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">{busy ? "…" : "Set ranks"}</button>
        <button onClick={handleFinalize} disabled={busy || !publicKey} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Finalize resolve</button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-sm text-emerald-600">{ok}</p>}
    </div>
  );
}

// ── Hackathon card ─────────────────────────────────────────────────────────────

function HackathonMasterCard({ hackathon }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between px-6 py-4 text-left">
        <div>
          <p className="font-semibold text-slate-900">{hackathon.name || hackathon.pubkey.toBase58().slice(0, 16) + "…"}</p>
          <p className="text-xs text-slate-400">Results: {formatDate(hackathon.resultsTimestamp)} · {formatTokens(hackathon.totalPool)} USDC · {hackathon.isResolved ? <span className="text-emerald-600">Resolved</span> : <span className="text-indigo-500">Active</span>}</p>
        </div>
        <span className="text-slate-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-6 pb-6">
          {!hackathon.isResolved && <ResolvePanel hackathon={hackathon} />}
          {hackathon.isResolved && <p className="mt-4 text-sm text-slate-400">Hackathon resolved. Stakers can now claim.</p>}
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

    // Update submission status
    await sb.from("project_submissions").update({ status, reviewed_at: new Date().toISOString() }).eq("id", id);

    // On approval: copy social links → project_metadata so they appear on the hackathon page
    if (status === "approved") {
      const sub = submissions.find((s) => s.id === id);
      if (sub?.project_pubkey) {
        await sb.from("project_metadata").upsert({
          project_pubkey: sub.project_pubkey,
          hackathon_pubkey: sub.hackathon_pubkey,
          github_url: sub.github_url,
          wallet_address: sub.wallet_address,
          twitter_handle: sub.twitter_handle ?? null,
          telegram: sub.telegram ?? null,
          discord: sub.discord ?? null,
        }, { onConflict: "project_pubkey" });
      }
    }

    setSubmissions((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
    setBusy(null);
  }

  const visible = filter === "all" ? submissions : submissions.filter((s) => s.status === filter);

  if (loading) return <div className="h-16 animate-pulse rounded-2xl bg-slate-200" />;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Project Submissions</h2>
        <div className="flex gap-1 rounded-xl border border-slate-200 p-1">
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition ${filter === f ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}>{f}</button>
          ))}
        </div>
      </div>

      {!getSupabase() && (
        <p className="text-sm text-slate-400">Supabase not configured — add env vars to see submissions.</p>
      )}

      {getSupabase() && visible.length === 0 && (
        <p className="text-sm text-slate-400">No {filter === "all" ? "" : filter} submissions.</p>
      )}

      <div className="space-y-3">
        {visible.map((s) => (
          <div key={s.id} className={`rounded-xl border p-4 ${s.status === "pending" ? "border-amber-200 bg-amber-50" : s.status === "approved" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <a href={s.github_url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:underline">
                  {s.github_url.replace("https://github.com/", "")}
                </a>
                <p className="mt-0.5 text-xs text-slate-500">
                  {s.hackathon_name || s.hackathon_pubkey.slice(0, 12) + "…"} ·{" "}
                  {s.wallet_address.slice(0, 8)}…{s.wallet_address.slice(-4)}
                  {s.auth_email && ` · ${s.auth_email}`}
                </p>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                  {s.twitter_handle && <span>𝕏 @{s.twitter_handle}</span>}
                  {s.telegram && <span>✈ {s.telegram}</span>}
                  {s.discord && <span>💬 {s.discord}</span>}
                </div>
                <p className="mt-1 text-xs text-slate-400">{new Date(s.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${s.status === "pending" ? "bg-amber-100 text-amber-700" : s.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                  {s.status}
                </span>
                {s.status === "pending" && (
                  <>
                    <button onClick={() => updateStatus(s.id, "approved")} disabled={busy === s.id} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {busy === s.id ? "…" : "Approve"}
                    </button>
                    <button onClick={() => updateStatus(s.id, "rejected")} disabled={busy === s.id} className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      Reject
                    </button>
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

export default function MasterPage() {
  const { publicKey } = useWallet();
  const { hackathons, loading, reload: reloadHackathons } = useHackathons();
  const [version, setVersion] = useState(0);
  const isAdmin = publicKey?.toBase58() === PROTOCOL_ADMIN;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-indigo-50">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900">Master Panel</h1>
          <p className="mt-1 text-sm text-slate-500">Create hackathons, approve submissions, set results.</p>
          {!isAdmin && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Access restricted. Connect the admin wallet to use this panel.
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="space-y-6">
            <CreateHackathonPanel onCreated={() => { setVersion((v) => v + 1); reloadHackathons(); }} />

            <SubmissionsSection hackathons={hackathons} />

            <div>
              <h2 className="mb-3 text-lg font-bold text-slate-900">Hackathons</h2>
              {loading ? (
                <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-200" />)}</div>
              ) : hackathons.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">No hackathons yet.</div>
              ) : (
                <div key={version} className="space-y-3">
                  {hackathons.map((h) => <HackathonMasterCard key={h.pubkey.toBase58()} hackathon={h} />)}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
