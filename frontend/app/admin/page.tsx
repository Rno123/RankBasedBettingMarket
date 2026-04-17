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
import { USDC_MINT } from "@/lib/constants";
import type { ProjectMetadata } from "@/lib/types";

// ── Create Hackathon (multi-step) ────────────────────────────────────────────

function CreateHackathonPanel({ onCreated }: { onCreated: () => void }) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();

  // Step 1 fields
  const [step, setStep] = useState<1 | 2>(1);
  const [hackathonName, setHackathonName] = useState("");
  const [resultsDate, setResultsDate] = useState("");
  const [numTiers, setNumTiers] = useState<number>(3);

  // Step 2 fields — one entry per tier
  const [tierPcts, setTierPcts] = useState<string[]>(["55", "30", "15"]);
  const [tierCounts, setTierCounts] = useState<string[]>(["1", "1", ""]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // When numTiers changes, resize the arrays and prefill sensible defaults
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
      // Last tier is always blank (open-ended)
      next[clamped - 1] = "";
      return next.slice(0, clamped);
    });
    setErr(null);
  }

  function handleStep1Next() {
    setErr(null);
    const trimmedName = hackathonName.trim();
    if (!trimmedName) { setErr("Hackathon name is required"); return; }
    if (new TextEncoder().encode(trimmedName).length > 50) {
      setErr("Hackathon name exceeds 50 bytes"); return;
    }
    const resultsTs = Math.floor(new Date(resultsDate).getTime() / 1000);
    if (isNaN(resultsTs) || resultsTs < Math.floor(Date.now() / 1000)) {
      setErr("Results date must be in the future"); return;
    }
    if (numTiers < 1 || numTiers > 8) { setErr("Number of tiers must be 1–8"); return; }
    setStep(2);
  }

  async function handleCreate() {
    if (!publicKey || !anchorWallet) return;
    setErr(null);

    const pcts = tierPcts.map((v) => parseInt(v));
    const counts = tierCounts.map((v, i) => {
      if (i === numTiers - 1) return 0; // blank or any value → 0 = all remaining
      return parseInt(v);
    });

    if (pcts.some(isNaN) || pcts.some((v) => v < 1)) {
      setErr("All tier percentages must be a number ≥ 1"); return;
    }
    if (pcts.reduce((a, b) => a + b, 0) !== 100) {
      setErr("Tier percentages must sum to exactly 100"); return;
    }
    for (let i = 0; i < numTiers - 1; i++) {
      if (isNaN(counts[i]) || counts[i] < 1) {
        setErr(`Tier ${i + 1} project count must be ≥ 1`); return;
      }
    }

    setBusy(true);
    try {
      const trimmedName = hackathonName.trim();
      const resultsTs = Math.floor(new Date(resultsDate).getTime() / 1000);
      const program = getProgram(anchorWallet);
      const hackathon = hackathonPda(publicKey, trimmedName);
      const escrow = escrowPda(hackathon);

      await (program.methods as any)
        .initializeHackathon(
          trimmedName,
          new BN(resultsTs),
          Buffer.from(pcts),
          Buffer.from(counts),
        )
        .accounts({
          admin: publicKey,
          hackathon,
          escrow,
          usdcMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setOk(`Hackathon "${trimmedName}" created: ${hackathon.toBase58()}`);
      onCreated();
    } catch (e: any) {
      const logs: string[] | undefined =
        typeof e.getLogs === "function" ? await e.getLogs() : e.logs;
      const alreadyInUse =
        (e.message ?? "").includes("already in use") ||
        (logs ?? []).some((l: string) => l.includes("already in use"));
      const detail = alreadyInUse
        ? `A hackathon named "${hackathonName.trim()}" already exists. Choose a different name.`
        : logs?.length ? logs.join("\n") : (e.message ?? "Failed");
      setErr(detail);
      console.error("createHackathon error", e, logs);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900">Create Hackathon</h2>
        <span className="ml-auto text-xs text-slate-400">Step {step} of 2</span>
      </div>

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Hackathon name (max 50 chars)
            </label>
            <input
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              placeholder="e.g. Solana Speedrun 2026"
              maxLength={50}
              value={hackathonName}
              onChange={(e) => setHackathonName(e.target.value)}
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
              Number of tiers (1–8)
            </label>
            <input
              type="number"
              min={1}
              max={8}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              value={numTiers}
              onChange={(e) => handleNumTiersChange(parseInt(e.target.value) || 1)}
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Percentages must sum to 100. Project counts must be ≥ 1 for all
            tiers except the last.
          </p>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
            <span>Tier</span>
            <span>Pool % </span>
            <span>Projects eligible</span>
          </div>
          {Array.from({ length: numTiers }).map((_, i) => {
            const isLast = i === numTiers - 1;
            return (
              <div key={i} className="grid grid-cols-3 items-start gap-x-3">
                <span className="py-2 text-sm font-medium text-slate-700">
                  Tier {i + 1}
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  placeholder="%"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                  value={tierPcts[i] ?? ""}
                  onChange={(e) => {
                    const next = [...tierPcts];
                    next[i] = e.target.value;
                    setTierPcts(next);
                  }}
                />
                <div>
                  <input
                    type="number"
                    min={0}
                    placeholder="count"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                    value={tierCounts[i] ?? ""}
                    onChange={(e) => {
                      const next = [...tierCounts];
                      next[i] = e.target.value;
                      setTierCounts(next);
                    }}
                  />
                  {isLast && (
                    <p className="mt-1 text-xs text-slate-400">
                      Leave blank if final tier&apos;s pool is split across all remaining entrants
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {err && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600 whitespace-pre-wrap">
          {err}
        </p>
      )}
      {ok && (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 font-mono break-all">
          {ok}
        </p>
      )}

      <div className="mt-5 flex gap-3">
        {step === 2 && (
          <button
            onClick={() => { setErr(null); setStep(1); }}
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back
          </button>
        )}
        {step === 1 && (
          <button
            onClick={handleStep1Next}
            disabled={!publicKey}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            Next — configure tiers
          </button>
        )}
        {step === 2 && (
          <button
            onClick={handleCreate}
            disabled={busy || !publicKey}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create hackathon"}
          </button>
        )}
      </div>
    </section>
  );
}

// ── Register Project ──────────────────────────────────────────────────────────

function RegisterProjectPanel({
  hackathonPubkey,
}: {
  hackathonPubkey: PublicKey;
}) {
  const { publicKey, signMessage } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [url, setUrl] = useState("");
  // Social link fields (optional)
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "onchain" | "metadata" | "done">("idle");

  async function handleRegister() {
    if (!publicKey || !anchorWallet) return;
    if (!url.startsWith("https://github.com/")) {
      setErr("URL must start with https://github.com/"); return;
    }
    if (url.length > 200) { setErr("URL too long (max 200 chars)"); return; }

    setErr(null); setOk(null); setBusy(true);
    setStep("onchain");
    let projectPk: PublicKey;
    try {
      const program = getProgram(anchorWallet);
      const urlHashBytes = await hashUrl(url);
      const urlHash = Array.from(urlHashBytes);
      projectPk = await projectPdaFromUrl(hackathonPubkey, url);

      await (program.methods as any)
        .registerProject(url, urlHash)
        .accounts({
          payer: publicKey,
          hackathon: hackathonPubkey,
          project: projectPk,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e: any) {
      const msg: string = e.message ?? "";
      const logs: string[] = e.logs ?? [];
      const alreadyInUse =
        msg.includes("already in use") ||
        logs.some((l: string) => l.includes("already in use"));
      setErr(
        alreadyInUse
          ? "This project is already registered for this hackathon."
          : msg || "On-chain registration failed",
      );
      setBusy(false);
      setStep("idle");
      return;
    }

    // Step 2: submit social metadata (optional, skip if signMessage not available)
    if (signMessage) {
      setStep("metadata");
      try {
        const message = `hackbet:register:${projectPk.toBase58()}`;
        const messageBytes = new TextEncoder().encode(message);
        const sigBytes = await signMessage(messageBytes);
        const signature = Buffer.from(sigBytes).toString("base64");

        const res = await fetch("/api/project-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectPubkey: projectPk.toBase58(),
            hackathonPubkey: hackathonPubkey.toBase58(),
            githubUrl: url,
            twitterHandle: twitter.replace(/^@/, "") || undefined,
            telegram: telegram || undefined,
            discord: discord || undefined,
            walletAddress: publicKey.toBase58(),
            signature,
          } satisfies {
            projectPubkey: string;
            hackathonPubkey: string;
            githubUrl: string;
            twitterHandle?: string;
            telegram?: string;
            discord?: string;
            walletAddress: string;
            signature: string;
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.warn("Metadata submission failed:", body);
          // Non-fatal — on-chain registration succeeded
          setOk(`Registered: ${projectPk.toBase58()} (metadata skipped: ${(body as { error?: string }).error ?? res.status})`);
        } else {
          setOk(`Registered: ${projectPk.toBase58()} + social links saved`);
        }
      } catch (e: any) {
        console.warn("Metadata step failed:", e);
        setOk(`Registered: ${projectPk.toBase58()} (social links not saved)`);
      }
    } else {
      setOk(`Registered: ${projectPk.toBase58()}`);
    }

    setUrl("");
    setTwitter("");
    setTelegram("");
    setDiscord("");
    setStep("done");
    setBusy(false);
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        Register project
      </h3>
      <div className="space-y-2">
        {/* GitHub URL — required */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            GitHub URL <span className="text-red-400">*</span>
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="https://github.com/org/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        {/* Social links — optional */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Twitter handle <span className="text-slate-400">(optional)</span>
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="@handle or leave blank"
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Telegram <span className="text-slate-400">(optional)</span>
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="t.me/... or leave blank"
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Discord <span className="text-slate-400">(optional)</span>
          </label>
          <input
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="discord.gg/... or leave blank"
            value={discord}
            onChange={(e) => setDiscord(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={handleRegister}
          disabled={busy || !publicKey}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
        >
          {busy
            ? step === "onchain"
              ? "Registering on-chain…"
              : step === "metadata"
              ? "Saving social links…"
              : "…"
            : "Register project"}
        </button>
        {busy && step === "metadata" && (
          <span className="text-xs text-slate-400">
            Please sign the message in your wallet
          </span>
        )}
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
  const { hackathons, loading, reload: reloadHackathons } = useHackathons();
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
          <CreateHackathonPanel onCreated={() => { setVersion((v) => v + 1); reloadHackathons(); }} />

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
