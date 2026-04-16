"use client";

import { useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import Navbar from "@/components/Navbar";
import { getProgram } from "@/lib/program";
import { hackathonPda, escrowPda, projectPdaFromUrl, hashUrl } from "@/lib/pda";
import { useHackathons } from "@/hooks/useHackathons";
import { useProjects } from "@/hooks/useProjects";
import { formatTokens, formatDate } from "@/lib/format";

// ── Create Hackathon ─────────────────────────────────────────────────────────

function CreateHackathonPanel({ onCreated }: { onCreated: () => void }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  const [resultsDate, setResultsDate] = useState("");
  const [tierPcts, setTierPcts] = useState("55,30,15");
  const [tierCounts, setTierCounts] = useState("1,1,0");
  const [usdcMint, setUsdcMint] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function handleCreate() {
    if (!publicKey || !anchorWallet) return;
    setErr(null); setOk(null);
    try {
      const pcts = tierPcts.split(",").map((x) => parseInt(x.trim()));
      const counts = tierCounts.split(",").map((x) => parseInt(x.trim()));
      if (pcts.reduce((a, b) => a + b, 0) !== 100) {
        setErr("Tier percentages must sum to 100"); return;
      }
      const resultsTs = Math.floor(new Date(resultsDate).getTime() / 1000);
      if (isNaN(resultsTs) || resultsTs < Math.floor(Date.now() / 1000)) {
        setErr("Results date must be in the future"); return;
      }

      let mintPk: PublicKey;
      try { mintPk = new PublicKey(usdcMint); }
      catch { setErr("Invalid USDC mint address"); return; }

      setBusy(true);
      const program = getProgram(anchorWallet);
      const hackathon = hackathonPda(publicKey);
      const escrow = escrowPda(hackathon);

      await (program.methods as any)
        .initializeHackathon(
          new BN(resultsTs),
          Buffer.from(pcts),
          Buffer.from(counts),
        )
        .accounts({
          admin: publicKey,
          hackathon,
          escrow,
          usdcMint: mintPk,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setOk(`Hackathon created: ${hackathon.toBase58()}`);
      onCreated();
    } catch (e: any) {
      // Surface on-chain logs when available (SendTransactionError)
      const logs: string[] | undefined =
        typeof e.getLogs === "function" ? await e.getLogs() : e.logs;
      const detail = logs?.length
        ? logs.join("\n")
        : (e.message ?? "Failed");
      setErr(detail);
      console.error("createHackathon error", e, logs);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-bold text-slate-900">
        Create Hackathon
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            USDC Mint address
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono focus:border-indigo-400 focus:outline-none"
            placeholder="EPjFWdd5..."
            value={usdcMint}
            onChange={(e) => setUsdcMint(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Results date/time
          </label>
          <input
            type="datetime-local"
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            value={resultsDate}
            onChange={(e) => setResultsDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Tier percentages (comma-separated, must sum to 100)
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="55,30,15"
            value={tierPcts}
            onChange={(e) => setTierPcts(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Expected project counts per tier (comma-separated)
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="1,1,0"
            value={tierCounts}
            onChange={(e) => setTierCounts(e.target.value)}
          />
        </div>
      </div>

      {err && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {err}
        </p>
      )}
      {ok && (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 font-mono break-all">
          {ok}
        </p>
      )}

      <button
        onClick={handleCreate}
        disabled={busy || !publicKey}
        className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create hackathon"}
      </button>
    </section>
  );
}

// ── Register Project ──────────────────────────────────────────────────────────

function RegisterProjectPanel({
  hackathonPubkey,
}: {
  hackathonPubkey: PublicKey;
}) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function handleRegister() {
    if (!publicKey || !anchorWallet) return;
    if (!url.startsWith("https://github.com/")) {
      setErr("URL must start with https://github.com/"); return;
    }
    if (url.length > 200) { setErr("URL too long (max 200 chars)"); return; }

    setErr(null); setOk(null); setBusy(true);
    try {
      const program = getProgram(anchorWallet);
      const urlHashBytes = await hashUrl(url);
      const urlHash = Array.from(urlHashBytes);
      const projectPk = await projectPdaFromUrl(hackathonPubkey, url);

      await (program.methods as any)
        .registerProject(url, urlHash)
        .accounts({
          payer: publicKey,
          hackathon: hackathonPubkey,
          project: projectPk,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setOk(`Registered: ${projectPk.toBase58()}`);
      setUrl("");
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        Register project
      </h3>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          placeholder="https://github.com/org/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          onClick={handleRegister}
          disabled={busy || !publicKey}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
        >
          {busy ? "…" : "Add"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {ok && <p className="mt-2 break-all font-mono text-xs text-emerald-600">{ok}</p>}
    </div>
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
          await (program.methods as any)
            .resolve(rank)
            .accounts({
              admin: publicKey,
              hackathon: hackathon.pubkey,
              project: p.pubkey,
            })
            .rpc();
        }
      }
      setOk("All ranks set. Now run Finalize.");
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize() {
    if (!publicKey || !anchorWallet) return;
    setErr(null); setOk(null); setBusy(true);
    try {
      const program = getProgram(anchorWallet);
      await (program.methods as any)
        .finalizeResolve()
        .accounts({ admin: publicKey, hackathon: hackathon.pubkey })
        .remainingAccounts(
          projects.map((p) => ({
            pubkey: p.pubkey,
            isWritable: false,
            isSigner: false,
          })),
        )
        .rpc();
      setOk("Finalized! is_resolved = true");
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        Resolve projects
      </h3>
      <div className="space-y-2">
        {projects.map((p) => (
          <div key={p.pubkey.toBase58()} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-slate-600">
              {p.githubUrl.replace("https://github.com/", "")}
            </span>
            <input
              type="number"
              min="0"
              placeholder="rank"
              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm text-center focus:border-indigo-400 focus:outline-none"
              value={ranks[p.pubkey.toBase58()] ?? ""}
              onChange={(e) =>
                setRanks((r) => ({
                  ...r,
                  [p.pubkey.toBase58()]: e.target.value,
                }))
              }
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleResolveAll}
          disabled={busy || !publicKey}
          className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? "…" : "Set ranks"}
        </button>
        <button
          onClick={handleFinalize}
          disabled={busy || !publicKey}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          Finalize resolve
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {ok && <p className="mt-2 text-sm text-emerald-600">{ok}</p>}
    </div>
  );
}

// ── Admin panel for a single hackathon ────────────────────────────────────────

function HackathonAdminCard({
  hackathon,
}: {
  hackathon: ReturnType<typeof useHackathons>["hackathons"][0];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <p className="font-semibold text-slate-900">
            {hackathon.pubkey.toBase58().slice(0, 16)}…
          </p>
          <p className="text-xs text-slate-400">
            Results: {formatDate(hackathon.resultsTimestamp)} ·{" "}
            {formatTokens(hackathon.totalPool)} USDC ·{" "}
            {hackathon.isResolved ? (
              <span className="text-emerald-600">Resolved</span>
            ) : (
              <span className="text-indigo-500">Active</span>
            )}
          </p>
        </div>
        <span className="text-slate-400">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-6 pb-6">
          <RegisterProjectPanel hackathonPubkey={hackathon.pubkey} />
          {!hackathon.isResolved && (
            <ResolvePanel hackathon={hackathon} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { publicKey } = useWallet();
  const { hackathons, loading } = useHackathons();
  const [version, setVersion] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-indigo-50">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900">Admin Panel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage hackathons, register projects, set ranks, finalize results.
          </p>
          {!publicKey && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
              Connect your admin wallet to use this panel.
            </div>
          )}
        </div>

        <div className="space-y-6">
          <CreateHackathonPanel onCreated={() => setVersion((v) => v + 1)} />

          <div>
            <h2 className="mb-3 text-lg font-bold text-slate-900">
              Existing Hackathons
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(2)].map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-2xl bg-slate-200"
                  />
                ))}
              </div>
            ) : hackathons.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                No hackathons yet.
              </div>
            ) : (
              <div key={version} className="space-y-3">
                {hackathons.map((h) => (
                  <HackathonAdminCard key={h.pubkey.toBase58()} hackathon={h} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
