"use client";

import { use, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import StakeModal from "@/components/StakeModal";
import ClaimButton from "@/components/ClaimButton";
import { useProjects } from "@/hooks/useProjects";
import { useHackathons } from "@/hooks/useHackathons";
import { useUserStake } from "@/hooks/useUserStake";
import {
  formatTokens,
  formatDate,
  hackathonStatus,
  timeUntil,
  repoName,
} from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { ProjectMetadata, GithubStats } from "@/lib/types";

// ── GitHub stats helper ──────────────────────────────────────────────────────

function daysAgo(isoDate: string | null): string {
  if (!isoDate) return "unknown";
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ── Per-project row ──────────────────────────────────────────────────────────

function ProjectRow({
  project,
  hackathon,
  allProjects,
  status,
  onStakeUpdated,
  metadata,
  githubStats,
}: {
  project: ProjectInfo;
  hackathon: HackathonInfo;
  allProjects: ProjectInfo[];
  status: ReturnType<typeof hackathonStatus>;
  onStakeUpdated: () => void;
  metadata?: ProjectMetadata;
  githubStats?: GithubStats | null;
}) {
  const { publicKey } = useWallet();
  const { stake } = useUserStake(publicKey, project.pubkey);
  const [modalOpen, setModalOpen] = useState(false);

  const totalPool = hackathon.totalPool;
  const share =
    totalPool > 0n
      ? Number((project.totalStaked * 10000n) / totalPool) / 100
      : 0;

  const rankLabel =
    project.rank === 0
      ? "Unranked"
      : `#${project.rank}`;

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
        {/* Top row: rank + name + action */}
        <div className="flex items-start justify-between gap-3 sm:items-center">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                project.rank === 1
                  ? "bg-amber-100 text-amber-700"
                  : project.rank === 2
                  ? "bg-slate-200 text-slate-600"
                  : project.rank === 3
                  ? "bg-orange-100 text-orange-700"
                  : project.rank > 0
                  ? "bg-indigo-50 text-indigo-500"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              {project.rank > 0 ? project.rank : "–"}
            </div>
            <div>
              <a
                href={project.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-900 hover:text-indigo-600"
              >
                {repoName(project.githubUrl)}
              </a>
              <p className="text-xs text-slate-400">{rankLabel}</p>
            </div>
          </div>

          {/* Action button */}
          <div className="shrink-0">
            {status === "resolved" && stake && !stake.isClaimed && stake.amount > 0n ? (
              <ClaimButton
                hackathon={hackathon}
                project={project}
                allProjects={allProjects}
                onSuccess={onStakeUpdated}
              />
            ) : status === "resolved" && stake?.isClaimed ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                Claimed
              </span>
            ) : status === "open" ? (
              <button
                onClick={() => setModalOpen(true)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
              >
                {stake && stake.amount > 0n ? "Manage stake" : "Stake"}
              </button>
            ) : status === "cutoff" ? (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
                Cutoff
              </span>
            ) : null}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-5">
          <div>
            <p className="text-xs text-slate-400">Staked</p>
            <p className="font-semibold text-slate-900">
              {formatTokens(project.totalStaked)} USDC
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Pool share</p>
            <p className="font-semibold text-slate-900">{share.toFixed(1)}%</p>
          </div>
          {stake && stake.amount > 0n && (
            <div>
              <p className="text-xs text-slate-400">Your stake</p>
              <p className="font-semibold text-indigo-600">
                {formatTokens(stake.amount)} USDC
              </p>
            </div>
          )}
        </div>

        {/* GitHub stats row */}
        {githubStats !== undefined && (
          <div className="text-xs text-slate-500">
            {githubStats === null ? (
              <span className="italic">GitHub stats unavailable</span>
            ) : (
              <>
                Last commit: <span className="font-medium text-slate-700">{daysAgo(githubStats.last_commit_at)}</span>
                {" · "}
                <span className="font-medium text-slate-700">
                  {githubStats.commits_7d ?? "?"} commit{githubStats.commits_7d !== 1 ? "s" : ""} this week
                </span>
              </>
            )}
          </div>
        )}

        {/* Social links row */}
        {metadata && (metadata.twitter_handle || metadata.telegram || metadata.discord) && (
          <div className="flex items-center gap-3 text-sm">
            {metadata.twitter_handle && (
              <a
                href={`https://twitter.com/${metadata.twitter_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sky-500 hover:text-sky-600"
                title="Twitter"
              >
                <span>🐦</span>
                <span className="text-xs">Twitter</span>
              </a>
            )}
            {metadata.telegram && (
              <a
                href={metadata.telegram.startsWith("http") ? metadata.telegram : `https://t.me/${metadata.telegram}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-500 hover:text-blue-600"
                title="Telegram"
              >
                <span>✈️</span>
                <span className="text-xs">Telegram</span>
              </a>
            )}
            {metadata.discord && (
              <a
                href={metadata.discord.startsWith("http") ? metadata.discord : `https://discord.gg/${metadata.discord}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-indigo-500 hover:text-indigo-600"
                title="Discord"
              >
                <span>💬</span>
                <span className="text-xs">Discord</span>
              </a>
            )}
          </div>
        )}
      </div>

      {modalOpen && (
        <StakeModal
          hackathon={hackathon}
          project={project}
          onClose={() => setModalOpen(false)}
          onSuccess={onStakeUpdated}
        />
      )}
    </>
  );
}

// ── Sort type ────────────────────────────────────────────────────────────────

type SortMode = "stake" | "last_commit" | "commits_week";

// ── Main page ────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  open: "bg-emerald-100 text-emerald-700",
  cutoff: "bg-amber-100 text-amber-700",
  pending: "bg-sky-100 text-sky-700",
  resolved: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS = {
  open: "Open for staking",
  cutoff: "Cutoff passed",
  pending: "Awaiting resolution",
  resolved: "Resolved",
};

export default function HackathonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { hackathons, loading: hLoading } = useHackathons();
  const [hackathon, setHackathon] = useState<HackathonInfo | null>(null);

  const hackathonPk = hackathon?.pubkey ?? null;
  const { projects, loading: pLoading, error: pError } = useProjects(hackathonPk);
  const [version, setVersion] = useState(0);

  // Off-chain metadata maps
  const [metadataMap, setMetadataMap] = useState<Record<string, ProjectMetadata>>({});
  const [githubStatsMap, setGithubStatsMap] = useState<Record<string, GithubStats | null>>({});
  const [sortMode, setSortMode] = useState<SortMode>("stake");

  useEffect(() => {
    const found = hackathons.find((h) => h.pubkey.toBase58() === id);
    if (found) setHackathon(found);
  }, [hackathons, id]);

  // Fetch project metadata from Supabase when projects load
  useEffect(() => {
    if (!hackathonPk || projects.length === 0) return;

    const supabase = getSupabase();
    if (!supabase) return;

    supabase
      .from("project_metadata")
      .select("*")
      .eq("hackathon_pubkey", hackathonPk.toBase58())
      .then(({ data, error }) => {
        if (error || !data) return;
        const map: Record<string, ProjectMetadata> = {};
        for (const row of data) {
          map[row.project_pubkey] = row as ProjectMetadata;
        }
        setMetadataMap(map);
      });
  }, [hackathonPk?.toBase58(), projects.length]);

  // Fetch GitHub stats for each project in parallel
  useEffect(() => {
    if (projects.length === 0) return;

    Promise.all(
      projects.map(async (p) => {
        try {
          const res = await fetch(
            `/api/github-stats?url=${encodeURIComponent(p.githubUrl)}`,
          );
          if (!res.ok) return { key: p.githubUrl, stats: null };
          const json = await res.json();
          return { key: p.githubUrl, stats: (json.data ?? null) as GithubStats | null };
        } catch {
          return { key: p.githubUrl, stats: null };
        }
      }),
    ).then((results) => {
      const map: Record<string, GithubStats | null> = {};
      for (const r of results) {
        map[r.key] = r.stats;
      }
      setGithubStatsMap(map);
    });
  }, [projects.map((p) => p.githubUrl).join(",")]);

  const loading = hLoading || pLoading;

  if (hLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50">
        <Navbar />
        <main className="mx-auto max-w-4xl px-4 py-12">
          <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-200" />
          <div className="mt-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!hackathon) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50">
        <Navbar />
        <main className="mx-auto max-w-4xl px-4 py-12 text-center text-slate-400">
          Hackathon not found.{" "}
          <Link href="/" className="text-indigo-500 underline">
            Go back
          </Link>
        </main>
      </div>
    );
  }

  const status = hackathonStatus(
    hackathon.resultsTimestamp,
    hackathon.cutoffTimestamp,
    hackathon.isResolved,
  );

  // Sort projects based on sortMode
  const sortedProjects = [...projects].sort((a, b) => {
    if (sortMode === "stake") {
      // Ranked projects first (ascending rank), then unranked sorted by stake desc
      if (a.rank === 0 && b.rank === 0) {
        return Number(b.totalStaked - a.totalStaked);
      }
      if (a.rank === 0) return 1;
      if (b.rank === 0) return -1;
      return a.rank - b.rank;
    }
    if (sortMode === "last_commit") {
      const aStats = githubStatsMap[a.githubUrl];
      const bStats = githubStatsMap[b.githubUrl];
      const aDate = aStats?.last_commit_at ? new Date(aStats.last_commit_at).getTime() : 0;
      const bDate = bStats?.last_commit_at ? new Date(bStats.last_commit_at).getTime() : 0;
      return bDate - aDate; // most recent first
    }
    if (sortMode === "commits_week") {
      const aStats = githubStatsMap[a.githubUrl];
      const bStats = githubStatsMap[b.githubUrl];
      const aC = aStats?.commits_7d ?? -1;
      const bC = bStats?.commits_7d ?? -1;
      return bC - aC; // most active first
    }
    return 0;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50">
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {/* Back */}
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600"
        >
          ← All hackathons
        </Link>

        {/* Header card */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900">
                  Hackathon
                </h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
                >
                  {STATUS_LABELS[status]}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-400">
                {id.slice(0, 16)}…
              </p>
            </div>
            {/* Pool */}
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-slate-400">
                Total pool
              </p>
              <p className="text-2xl font-bold text-indigo-600">
                {formatTokens(hackathon.totalPool)} USDC
              </p>
            </div>
          </div>

          {/* Meta row */}
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-400">Results</p>
              <p className="text-sm font-medium text-slate-700">
                {formatDate(hackathon.resultsTimestamp)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Cutoff</p>
              <p className="text-sm font-medium text-slate-700">
                {formatDate(hackathon.cutoffTimestamp)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Tiers</p>
              <p className="text-sm font-medium text-slate-700">
                {hackathon.tierPcts.join(" / ")}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Projects</p>
              <p className="text-sm font-medium text-slate-700">
                {pLoading ? "…" : projects.length}
              </p>
            </div>
          </div>

          {/* Effective tier pcts if resolved */}
          {hackathon.isResolved && (
            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">
                Effective tier allocations (after cascade)
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {hackathon.effectiveTierPcts.map((bps, i) => (
                  <span
                    key={i}
                    className="rounded-lg bg-indigo-50 px-2.5 py-1 text-sm font-medium text-indigo-700"
                  >
                    Tier {i + 1}: {(bps / 100).toFixed(2)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Time indicator */}
          {!hackathon.isResolved && status !== "pending" && (
            <div className="mt-4 text-sm text-slate-500">
              {status === "open" && (
                <>
                  Staking closes in{" "}
                  <span className="font-semibold text-amber-600">
                    {timeUntil(hackathon.cutoffTimestamp)}
                  </span>
                </>
              )}
              {status === "cutoff" && (
                <>
                  Results in{" "}
                  <span className="font-semibold text-sky-600">
                    {timeUntil(hackathon.resultsTimestamp)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Projects header + sort controls */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">Projects</h2>
          {projects.length > 0 && (
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {(
                [
                  { mode: "stake", label: "By stake" },
                  { mode: "last_commit", label: "By last commit" },
                  { mode: "commits_week", label: "By commits/week" },
                ] as const
              ).map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    sortMode === mode
                      ? "bg-indigo-600 text-white"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {pLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
            ))}
          </div>
        ) : pError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {pError}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-400">
            No projects registered yet.
          </div>
        ) : (
          <div key={version} className="space-y-3">
            {sortedProjects.map((p) => (
              <ProjectRow
                key={p.pubkey.toBase58()}
                project={p}
                hackathon={hackathon}
                allProjects={projects}
                status={status}
                onStakeUpdated={() => setVersion((v) => v + 1)}
                metadata={metadataMap[p.pubkey.toBase58()]}
                githubStats={
                  p.githubUrl in githubStatsMap
                    ? githubStatsMap[p.githubUrl]
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
