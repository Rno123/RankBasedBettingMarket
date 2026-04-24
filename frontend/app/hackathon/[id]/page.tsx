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
  stakeRefreshKey,
}: {
  project: ProjectInfo;
  hackathon: HackathonInfo;
  allProjects: ProjectInfo[];
  status: ReturnType<typeof hackathonStatus>;
  onStakeUpdated: () => void;
  metadata?: ProjectMetadata;
  githubStats?: GithubStats | null;
  stakeRefreshKey?: number;
}) {
  const { publicKey } = useWallet();
  const { stake } = useUserStake(publicKey, project.pubkey, stakeRefreshKey);
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
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none dark:hover:border-indigo-500/20 dark:hover:bg-white/[0.05]">
        {/* Top row: rank + name + action */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black ${
                project.rank === 1
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-1 dark:ring-amber-500/20"
                  : project.rank === 2
                  ? "bg-slate-200 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-1 dark:ring-slate-500/20"
                  : project.rank === 3
                  ? "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-1 dark:ring-orange-500/20"
                  : project.rank > 0
                  ? "bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-1 dark:ring-indigo-500/20"
                  : "bg-slate-100 text-slate-400 dark:bg-white/[0.05] dark:text-slate-600"
              }`}
            >
              {project.rank > 0 ? project.rank : "–"}
            </div>
            <div className="min-w-0">
              <a
                href={project.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-semibold text-slate-900 transition-colors hover:text-indigo-600 dark:text-white dark:hover:text-indigo-300"
              >
                {repoName(project.githubUrl)}
              </a>
              <p className="text-xs text-slate-400 dark:text-slate-600">{rankLabel}</p>
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
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-1 dark:ring-emerald-500/20">
                Claimed
              </span>
            ) : status === "open" ? (
              <button
                onClick={() => setModalOpen(true)}
                className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-indigo-700 dark:hover:bg-indigo-500"
              >
                Back
              </button>
            ) : status === "cutoff" ? (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-1 dark:ring-amber-500/20">
                Cutoff
              </span>
            ) : null}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-5">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Staked</p>
            <p className="font-bold text-slate-900 dark:text-white">
              {formatTokens(project.totalStaked)} <span className="text-xs text-slate-500">USDC</span>
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600" title="% of total staked USDC backing this project">Pool share</p>
            <p className="font-bold text-slate-900 dark:text-white">{share.toFixed(1)}%</p>
          </div>
          {stake && stake.amount > 0n && (
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Your stake</p>
              <p className="font-bold text-indigo-600 dark:text-indigo-400">
                {formatTokens(stake.amount)} <span className="text-xs text-slate-500">USDC</span>
              </p>
            </div>
          )}
        </div>

        {/* GitHub stats row */}
        {githubStats !== undefined && (
          <div className="text-xs text-slate-400 dark:text-slate-600">
            {githubStats === null ? (
              <span className="italic">GitHub stats unavailable</span>
            ) : (
              <>
                Last commit: <span className="font-medium text-slate-600 dark:text-slate-400">{daysAgo(githubStats.last_commit_at)}</span>
                {" · "}
                <span className="font-medium text-slate-600 dark:text-slate-400">
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
              <a href={`https://twitter.com/${metadata.twitter_handle}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-sky-500 transition-colors hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300" title="Twitter">
                <span>🐦</span><span className="text-xs">Twitter</span>
              </a>
            )}
            {metadata.telegram && (
              <a href={metadata.telegram.startsWith("http") ? metadata.telegram : `https://t.me/${metadata.telegram}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-500 transition-colors hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300" title="Telegram">
                <span>✈️</span><span className="text-xs">Telegram</span>
              </a>
            )}
            {metadata.discord && (
              <a href={metadata.discord.startsWith("http") ? metadata.discord : `https://discord.gg/${metadata.discord}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-indigo-500 transition-colors hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300" title="Discord">
                <span>💬</span><span className="text-xs">Discord</span>
              </a>
            )}
          </div>
        )}
      </div>

      {modalOpen && (
        <StakeModal
          hackathon={hackathon}
          project={project}
          stake={stake}
          onClose={() => setModalOpen(false)}
          onSuccess={onStakeUpdated}
        />
      )}
    </>
  );
}

// ── Crowd vs. Judges ─────────────────────────────────────────────────────────

function CrowdVsJudges({ projects }: { projects: ProjectInfo[] }) {
  // Only ranked projects participate in the comparison
  const ranked = projects.filter((p) => p.rank > 0);
  if (ranked.length === 0) return null;

  // Crowd ranking: sort by totalStaked descending, assign crowd rank 1..N
  const byStake = [...ranked].sort((a, b) => Number(b.totalStaked - a.totalStaked));
  const crowdRankMap = new Map<string, number>();
  byStake.forEach((p, i) => crowdRankMap.set(p.pubkey.toBase58(), i + 1));

  // Display order: judge rank ascending
  const rows = [...ranked].sort((a, b) => a.rank - b.rank);

  const rankBadgeClass = (r: number) => {
    if (r === 1) return "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-1 dark:ring-amber-500/20";
    if (r === 2) return "bg-slate-200 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-1 dark:ring-slate-500/20";
    if (r === 3) return "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-1 dark:ring-orange-500/20";
    return "bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-1 dark:ring-indigo-500/20";
  };

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">Crowd vs. Judges</h2>
      <p className="mb-4 text-sm text-slate-500">
        Did the crowd call it? Judge ranking (official results) vs. crowd ranking (by backing).
      </p>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none dark:backdrop-blur-sm">
        {/* Header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-slate-100 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-400 dark:border-white/[0.05] dark:text-slate-600">
          <span>Project</span>
          <span className="w-20 text-center">Judge rank</span>
          <span className="w-20 text-center">Crowd rank</span>
          <span className="w-12 text-center">Match</span>
        </div>
        {rows.map((p) => {
          const judgeRank = p.rank;
          const crowdRank = crowdRankMap.get(p.pubkey.toBase58()) ?? 0;
          const delta = crowdRank - judgeRank;
          const exact = delta === 0;
          const close = Math.abs(delta) <= 1;

          return (
            <div
              key={p.pubkey.toBase58()}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-b border-slate-50 px-4 py-3 last:border-0 hover:bg-slate-50 transition dark:border-white/[0.04] dark:hover:bg-white/[0.03]"
            >
              {/* Project name */}
              <a
                href={p.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-sm font-medium text-slate-800 transition-colors hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-300"
              >
                {repoName(p.githubUrl)}
              </a>

              {/* Judge rank badge */}
              <div className="w-20 flex justify-center">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black ${rankBadgeClass(judgeRank)}`}
                >
                  #{judgeRank}
                </span>
              </div>

              {/* Crowd rank badge + delta arrow */}
              <div className="w-20 flex items-center justify-center gap-1">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black ${rankBadgeClass(crowdRank)}`}
                >
                  #{crowdRank}
                </span>
                {!exact && (
                  <span
                    className={`text-xs font-bold ${delta < 0 ? "text-emerald-400" : "text-rose-400"}`}
                    title={delta < 0 ? "Crowd ranked higher than judges" : "Crowd ranked lower than judges"}
                  >
                    {delta < 0 ? `▲${Math.abs(delta)}` : `▼${delta}`}
                  </span>
                )}
              </div>

              {/* Match indicator */}
              <div className="w-12 flex justify-center">
                {exact ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-1 dark:ring-emerald-500/20">
                    ✓ Exact
                  </span>
                ) : close ? (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-500 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-1 dark:ring-sky-500/20">
                    ≈ Close
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-400 dark:bg-white/[0.05] dark:text-slate-500">
                    Miss
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary line */}
      {(() => {
        const exactCount = rows.filter(
          (p) => (crowdRankMap.get(p.pubkey.toBase58()) ?? 0) === p.rank,
        ).length;
        return (
          <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-600">
            Crowd got{" "}
            <span className="font-bold text-slate-600 dark:text-slate-300">{exactCount}</span>{" "}
            of{" "}
            <span className="font-bold text-slate-600 dark:text-slate-300">{rows.length}</span>{" "}
            placements exactly right
          </p>
        );
      })()}
    </div>
  );
}

// ── Sort type ────────────────────────────────────────────────────────────────

type SortMode = "stake" | "last_commit" | "commits_week";

// ── Main page ────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  open: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-1 dark:ring-emerald-500/20",
  cutoff: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-1 dark:ring-amber-500/20",
  pending: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-1 dark:ring-sky-500/20",
  resolved: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-1 dark:ring-slate-500/20",
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

  const { hackathons, loading: hLoading, reload: reloadHackathons } = useHackathons();
  const hackathon = hackathons.find((h) => h.pubkey.toBase58() === id) ?? null;
  const hackathonPk = hackathon?.pubkey ?? null;
  const { projects, loading: pLoading, error: pError, reload: reloadProjects } = useProjects(hackathonPk);
  const [version, setVersion] = useState(0);

  // Hackathon-level off-chain metadata
  const [hackathonMeta, setHackathonMeta] = useState<{ official_link?: string | null; icon_url?: string | null } | null>(null);

  // Off-chain metadata maps
  const [metadataMap, setMetadataMap] = useState<Record<string, ProjectMetadata>>({});
  const [githubStatsMap, setGithubStatsMap] = useState<Record<string, GithubStats | null>>({});
  const [sortMode, setSortMode] = useState<SortMode>("stake");
  // project pubkeys that are in project_submissions but NOT yet approved — hidden from public view
  const [blockedPubkeys, setBlockedPubkeys] = useState<Set<string>>(new Set());

  // Fetch hackathon-level metadata (icon, link)
  useEffect(() => {
    if (!hackathonPk) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase
      .from("hackathon_metadata")
      .select("official_link, icon_url")
      .eq("hackathon_pubkey", hackathonPk.toBase58())
      .single()
      .then(({ data }) => { if (data) setHackathonMeta(data); });
  }, [hackathonPk?.toBase58()]);

  // Fetch project metadata + submission statuses from Supabase when projects load
  useEffect(() => {
    if (!hackathonPk || projects.length === 0) return;

    const supabase = getSupabase();
    if (!supabase) return;

    const hpk = hackathonPk.toBase58();

    Promise.all([
      supabase.from("project_metadata").select("*").eq("hackathon_pubkey", hpk),
      supabase.from("project_submissions").select("project_pubkey, status").eq("hackathon_pubkey", hpk),
    ]).then(([{ data: metaData }, { data: subData }]) => {
      if (metaData) {
        const map: Record<string, ProjectMetadata> = {};
        for (const row of metaData) map[row.project_pubkey] = row as ProjectMetadata;
        setMetadataMap(map);
      }
      if (subData) {
        const blocked = new Set(
          subData
            .filter((r: any) => r.status !== "approved" && r.project_pubkey)
            .map((r: any) => r.project_pubkey as string),
        );
        setBlockedPubkeys(blocked);
      }
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

  if (hLoading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="mx-auto max-w-4xl px-4 py-12">
          <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-200 dark:bg-white/[0.06]" />
          <div className="mt-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200 dark:bg-white/[0.04]" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!hackathon) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="mx-auto max-w-4xl px-4 py-12 text-center text-slate-500">
          Hackathon not found.{" "}
          <Link href="/" className="text-indigo-600 underline dark:text-indigo-400">
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

  // Sort projects based on sortMode — exclude unapproved dev-portal submissions
  const visibleProjects = projects.filter((p) => !blockedPubkeys.has(p.pubkey.toBase58()));
  const sortedProjects = [...visibleProjects].sort((a, b) => {
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
    <div className="min-h-screen">
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {/* Back */}
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-slate-400 transition hover:text-slate-900 dark:text-slate-500 dark:hover:text-white"
        >
          ← All hackathons
        </Link>

        {/* Header card */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.04] dark:shadow-none dark:backdrop-blur-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                {hackathonMeta?.icon_url && (
                  <div className="flex h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.04]">
                    <img src={hackathonMeta.icon_url} alt="" className="h-full w-full object-cover" />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                    {hackathon.name || "Hackathon"}
                  </h1>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <p className="font-mono text-xs text-slate-400 dark:text-slate-600">
                  {id.slice(0, 16)}…
                </p>
                {hackathonMeta?.official_link && (
                  <a
                    href={hackathonMeta.official_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-indigo-500/40 dark:hover:text-indigo-400"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Official site
                  </a>
                )}
              </div>
            </div>
            {/* Pool */}
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Total pool
              </p>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {formatTokens(hackathon.totalPool)}{" "}
                <span className="text-sm font-semibold text-slate-500">USDC</span>
              </p>
            </div>
          </div>

          {/* Meta row: Cutoff | Results | Projects (right) */}
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="flex gap-16">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Cutoff</p>
                <p className="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                  {formatDate(hackathon.cutoffTimestamp)}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-600">Staking closes</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Results</p>
                <p className="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                  {formatDate(hackathon.resultsTimestamp)}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-600">Judge announcement</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Projects</p>
              <p className="mt-0.5 text-sm font-bold text-slate-700 dark:text-slate-300">
                {pLoading ? "…" : projects.length}
              </p>
            </div>
          </div>

          {/* Prize tiers row */}
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/[0.05]">
            <p className="mb-1.5 text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Prize tiers</p>
            <div className="inline-flex overflow-hidden rounded-md border border-indigo-200 bg-indigo-50 dark:border-indigo-500/20 dark:bg-indigo-500/10">
              {hackathon.tierPcts.map((pct, i) => (
                <span
                  key={i}
                  className={`px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400${i > 0 ? " border-l border-indigo-200 dark:border-indigo-500/20" : ""}`}
                >
                  #{i + 1}: {pct}%
                </span>
              ))}
            </div>
          </div>

          {/* Effective tier pcts if resolved */}
          {hackathon.isResolved && (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:border dark:border-white/[0.05] dark:bg-white/[0.03]">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Effective tier allocations (after cascade)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {hackathon.effectiveTierPcts.map((bps, i) => (
                  <span
                    key={i}
                    className="rounded-lg bg-indigo-50 px-2.5 py-1 text-sm font-semibold text-indigo-700 dark:border dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400"
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
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {timeUntil(hackathon.cutoffTimestamp)}
                  </span>
                </>
              )}
              {status === "cutoff" && (
                <>
                  Results in{" "}
                  <span className="font-semibold text-sky-600 dark:text-sky-400">
                    {timeUntil(hackathon.resultsTimestamp)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Projects header + sort controls */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">Projects</h2>
          {projects.length > 0 && (
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm self-start sm:self-auto dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none">
              {(
                [
                  { mode: "stake", label: "Stake", labelFull: "By stake" },
                  { mode: "last_commit", label: "Commit", labelFull: "By last commit" },
                  { mode: "commits_week", label: "Activity", labelFull: "By commits/week" },
                ] as const
              ).map(({ mode, label, labelFull }) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  aria-label={labelFull}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    sortMode === mode
                      ? "bg-indigo-600 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-transparent dark:hover:text-white"
                  }`}
                >
                  <span className="sm:hidden">{label}</span>
                  <span className="hidden sm:inline">{labelFull}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {pLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200 dark:bg-white/[0.04]" />
            ))}
          </div>
        ) : pError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            {pError}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-white/[0.08] dark:bg-transparent">
            <p className="text-slate-400 dark:text-slate-500">No projects registered yet.</p>
            {status === "open" && (
              <p className="mt-2 text-sm text-slate-500">
                Building something?{" "}
                <Link href="/dev" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  Submit your project →
                </Link>
              </p>
            )}
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
                onStakeUpdated={() => {
                    setVersion((v) => v + 1);
                    reloadProjects();
                    reloadHackathons();
                  }}
                metadata={metadataMap[p.pubkey.toBase58()]}
                githubStats={
                  p.githubUrl in githubStatsMap
                    ? githubStatsMap[p.githubUrl]
                    : undefined
                }
                stakeRefreshKey={version}
              />
            ))}
          </div>
        )}

        {/* Crowd vs. Judges — only shown once resolved */}
        {status === "resolved" && visibleProjects.length > 0 && (
          <CrowdVsJudges projects={visibleProjects} />
        )}
      </main>
    </div>
  );
}
