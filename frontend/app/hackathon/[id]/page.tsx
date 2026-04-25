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

function daysAgo(isoDate: string | null): string {
  if (!isoDate) return "unknown";
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function rankBadgeStyle(rank: number): React.CSSProperties {
  if (rank === 1) return { background: "var(--rank-1-bg)", color: "var(--rank-1-text)" };
  if (rank === 2) return { background: "var(--rank-2-bg)", color: "var(--rank-2-text)" };
  if (rank === 3) return { background: "var(--rank-3-bg)", color: "var(--rank-3-text)" };
  if (rank > 0) return { background: "var(--rank-other-bg)", color: "var(--rank-other-text)" };
  return { background: "var(--rank-none-bg)", color: "var(--rank-none-text)" };
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

  const rankLabel = project.rank === 0 ? "Unranked" : `#${project.rank}`;

  return (
    <>
      <div className="ui-project-row">
        {/* Top row: rank + name + action */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ display: "flex", minWidth: 0, alignItems: "center", gap: "12px" }}>
            <div
              style={{
                display: "flex",
                height: "36px",
                width: "36px",
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "8px",
                fontSize: "0.875rem",
                fontWeight: 900,
                ...rankBadgeStyle(project.rank),
              }}
            >
              {project.rank > 0 ? project.rank : "–"}
            </div>
            <div style={{ minWidth: 0 }}>
              <a
                href={project.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "var(--c-text)", textDecoration: "none", transition: "color 0.15s" }}
              >
                {repoName(project.githubUrl)}
              </a>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>{rankLabel}</p>
            </div>
          </div>

          {/* Action button */}
          <div style={{ flexShrink: 0 }}>
            {status === "resolved" && stake && !stake.isClaimed && stake.amount > 0n ? (
              <ClaimButton
                hackathon={hackathon}
                project={project}
                allProjects={allProjects}
                onSuccess={onStakeUpdated}
              />
            ) : status === "resolved" && stake?.isClaimed ? (
              <span style={{ borderRadius: "9999px", background: "var(--c-emerald-light)", padding: "4px 12px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-emerald-text)" }}>
                Claimed
              </span>
            ) : status === "open" ? (
              <button
                onClick={() => setModalOpen(true)}
                className="ui-btn ui-btn-indigo ui-btn-sm"
              >
                Back
              </button>
            ) : status === "cutoff" ? (
              <span style={{ borderRadius: "9999px", background: "var(--c-amber-light)", padding: "4px 12px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-amber-text)" }}>
                Cutoff
              </span>
            ) : null}
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Staked</p>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>
              {formatTokens(project.totalStaked)} <span style={{ fontSize: "0.75rem", color: "var(--c-text-3)" }}>USDC</span>
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }} title="% of total staked USDC backing this project">Pool share</p>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>{share.toFixed(1)}%</p>
          </div>
          {stake && stake.amount > 0n && (
            <div>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Your stake</p>
              <p style={{ margin: 0, fontWeight: 700, color: "var(--c-indigo-text)" }}>
                {formatTokens(stake.amount)} <span style={{ fontSize: "0.75rem", color: "var(--c-text-3)" }}>USDC</span>
              </p>
            </div>
          )}
        </div>

        {/* GitHub stats row */}
        {githubStats !== undefined && (
          <div style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
            {githubStats === null ? (
              <span style={{ fontStyle: "italic" }}>GitHub stats unavailable</span>
            ) : (
              <>
                Last commit: <span style={{ fontWeight: 500, color: "var(--c-text-3)" }}>{daysAgo(githubStats.last_commit_at)}</span>
                {" · "}
                <span style={{ fontWeight: 500, color: "var(--c-text-3)" }}>
                  {githubStats.commits_7d ?? "?"} commit{githubStats.commits_7d !== 1 ? "s" : ""} this week
                </span>
              </>
            )}
          </div>
        )}

        {/* Social links row */}
        {metadata && (metadata.twitter_handle || metadata.telegram || metadata.discord) && (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "0.875rem" }}>
            {metadata.twitter_handle && (
              <a href={`https://twitter.com/${metadata.twitter_handle}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--c-sky-text)", textDecoration: "none" }}>
                <span>🐦</span><span style={{ fontSize: "0.75rem" }}>Twitter</span>
              </a>
            )}
            {metadata.telegram && (
              <a href={metadata.telegram.startsWith("http") ? metadata.telegram : `https://t.me/${metadata.telegram}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: "4px", color: "#3b82f6", textDecoration: "none" }}>
                <span>✈️</span><span style={{ fontSize: "0.75rem" }}>Telegram</span>
              </a>
            )}
            {metadata.discord && (
              <a href={metadata.discord.startsWith("http") ? metadata.discord : `https://discord.gg/${metadata.discord}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--c-indigo-text)", textDecoration: "none" }}>
                <span>💬</span><span style={{ fontSize: "0.75rem" }}>Discord</span>
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
  const ranked = projects.filter((p) => p.rank > 0);
  if (ranked.length === 0) return null;

  const byStake = [...ranked].sort((a, b) => Number(b.totalStaked - a.totalStaked));
  const crowdRankMap = new Map<string, number>();
  byStake.forEach((p, i) => crowdRankMap.set(p.pubkey.toBase58(), i + 1));

  const rows = [...ranked].sort((a, b) => a.rank - b.rank);

  return (
    <div style={{ marginTop: "32px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>Crowd vs. Judges</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Did the crowd call it? Judge ranking (official results) vs. crowd ranking (by backing).
      </p>
      <div className="ui-card" style={{ overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "16px", borderBottom: "1px solid var(--c-divider-2)", padding: "10px 16px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
          <span>Project</span>
          <span style={{ width: "80px", textAlign: "center" }}>Judge rank</span>
          <span style={{ width: "80px", textAlign: "center" }}>Crowd rank</span>
          <span style={{ width: "48px", textAlign: "center" }}>Match</span>
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
              style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: "16px", borderBottom: "1px solid var(--c-divider-2)", padding: "12px 16px", transition: "background 0.15s" }}
            >
              <a
                href={p.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)", textDecoration: "none" }}
              >
                {repoName(p.githubUrl)}
              </a>

              <div style={{ width: "80px", display: "flex", justifyContent: "center" }}>
                <span style={{ display: "flex", height: "28px", width: "28px", alignItems: "center", justifyContent: "center", borderRadius: "8px", fontSize: "0.75rem", fontWeight: 900, ...rankBadgeStyle(judgeRank) }}>
                  #{judgeRank}
                </span>
              </div>

              <div style={{ width: "80px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                <span style={{ display: "flex", height: "28px", width: "28px", alignItems: "center", justifyContent: "center", borderRadius: "8px", fontSize: "0.75rem", fontWeight: 900, ...rankBadgeStyle(crowdRank) }}>
                  #{crowdRank}
                </span>
                {!exact && (
                  <span
                    style={{ fontSize: "0.75rem", fontWeight: 700, color: delta < 0 ? "var(--c-emerald-text)" : "var(--c-red-text)" }}
                    title={delta < 0 ? "Crowd ranked higher than judges" : "Crowd ranked lower than judges"}
                  >
                    {delta < 0 ? `▲${Math.abs(delta)}` : `▼${delta}`}
                  </span>
                )}
              </div>

              <div style={{ width: "48px", display: "flex", justifyContent: "center" }}>
                {exact ? (
                  <span style={{ borderRadius: "9999px", background: "var(--c-emerald-light)", padding: "2px 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-emerald-text)" }}>
                    ✓ Exact
                  </span>
                ) : close ? (
                  <span style={{ borderRadius: "9999px", background: "var(--c-sky-light)", padding: "2px 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-sky-text)" }}>
                    ≈ Close
                  </span>
                ) : (
                  <span style={{ borderRadius: "9999px", background: "var(--c-divider-2)", padding: "2px 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-text-4)" }}>
                    Miss
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(() => {
        const exactCount = rows.filter(
          (p) => (crowdRankMap.get(p.pubkey.toBase58()) ?? 0) === p.rank,
        ).length;
        return (
          <p style={{ marginTop: "12px", textAlign: "center", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
            Crowd got{" "}
            <span style={{ fontWeight: 700, color: "var(--c-text-2)" }}>{exactCount}</span>{" "}
            of{" "}
            <span style={{ fontWeight: 700, color: "var(--c-text-2)" }}>{rows.length}</span>{" "}
            placements exactly right
          </p>
        );
      })()}
    </div>
  );
}

// ── Sort type ────────────────────────────────────────────────────────────────

type SortMode = "stake" | "last_commit" | "commits_week";

// ── Status labels ────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  open: "Open for staking",
  cutoff: "Cutoff passed",
  pending: "Awaiting resolution",
  resolved: "Resolved",
};

// ── Main page ────────────────────────────────────────────────────────────────

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

  const [hackathonMeta, setHackathonMeta] = useState<{ official_link?: string | null; icon_url?: string | null } | null>(null);
  const [metadataMap, setMetadataMap] = useState<Record<string, ProjectMetadata>>({});
  const [githubStatsMap, setGithubStatsMap] = useState<Record<string, GithubStats | null>>({});
  const [sortMode, setSortMode] = useState<SortMode>("stake");
  const [blockedPubkeys, setBlockedPubkeys] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    if (projects.length === 0) return;
    Promise.all(
      projects.map(async (p) => {
        try {
          const res = await fetch(`/api/github-stats?url=${encodeURIComponent(p.githubUrl)}`);
          if (!res.ok) return { key: p.githubUrl, stats: null };
          const json = await res.json();
          return { key: p.githubUrl, stats: (json.data ?? null) as GithubStats | null };
        } catch {
          return { key: p.githubUrl, stats: null };
        }
      }),
    ).then((results) => {
      const map: Record<string, GithubStats | null> = {};
      for (const r of results) map[r.key] = r.stats;
      setGithubStatsMap(map);
    });
  }, [projects.map((p) => p.githubUrl).join(",")]);

  if (hLoading) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <main style={{ margin: "0 auto", maxWidth: "896px", padding: "48px 16px" }}>
          <div className="ui-skeleton" style={{ height: "32px", width: "256px" }} />
          <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="ui-skeleton" style={{ height: "80px" }} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (!hackathon) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <main style={{ margin: "0 auto", maxWidth: "896px", padding: "48px 16px", textAlign: "center", color: "var(--c-text-3)" }}>
          Hackathon not found.{" "}
          <Link href="/" className="ui-text-link">Go back</Link>
        </main>
      </div>
    );
  }

  const status = hackathonStatus(hackathon.resultsTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved);

  const visibleProjects = projects.filter((p) => !blockedPubkeys.has(p.pubkey.toBase58()));
  const sortedProjects = [...visibleProjects].sort((a, b) => {
    if (sortMode === "stake") {
      if (a.rank === 0 && b.rank === 0) return Number(b.totalStaked - a.totalStaked);
      if (a.rank === 0) return 1;
      if (b.rank === 0) return -1;
      return a.rank - b.rank;
    }
    if (sortMode === "last_commit") {
      const aStats = githubStatsMap[a.githubUrl];
      const bStats = githubStatsMap[b.githubUrl];
      const aDate = aStats?.last_commit_at ? new Date(aStats.last_commit_at).getTime() : 0;
      const bDate = bStats?.last_commit_at ? new Date(bStats.last_commit_at).getTime() : 0;
      return bDate - aDate;
    }
    if (sortMode === "commits_week") {
      const aStats = githubStatsMap[a.githubUrl];
      const bStats = githubStatsMap[b.githubUrl];
      const aC = aStats?.commits_7d ?? -1;
      const bC = bStats?.commits_7d ?? -1;
      return bC - aC;
    }
    return 0;
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "896px", padding: "40px 16px" }}>
        {/* Back */}
        <Link href="/" className="ui-back-link">← All hackathons</Link>

        {/* Header card */}
        <div className="ui-card" style={{ marginBottom: "24px", padding: "24px" }}>
          <div className="sm-flex-row" style={{ gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
                {hackathonMeta?.icon_url && (
                  <div style={{ display: "flex", height: "40px", width: "40px", flexShrink: 0, overflow: "hidden", borderRadius: "12px", border: "1px solid var(--c-divider)" }}>
                    <img src={hackathonMeta.icon_url} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} />
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                  <h1 style={{ margin: 0, fontSize: "clamp(1.25rem, 3vw, 1.5rem)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>
                    {hackathon.name || "Hackathon"}
                  </h1>
                  <span className={`ui-badge ui-badge-${status}`}>{STATUS_LABELS[status]}</span>
                </div>
              </div>
              <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "12px" }}>
                <p style={{ margin: 0, fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                  {id.slice(0, 16)}…
                </p>
                {hackathonMeta?.official_link && (
                  <a
                    href={hackathonMeta.official_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: "4px", borderRadius: "6px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "2px 8px", fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)", textDecoration: "none" }}
                  >
                    <svg style={{ height: "12px", width: "12px" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Official site
                  </a>
                )}
              </div>
            </div>
            {/* Pool */}
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Total pool</p>
              <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>
                {formatTokens(hackathon.totalPool)}{" "}
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
              </p>
            </div>
          </div>

          {/* Meta row */}
          <div style={{ marginTop: "16px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ display: "flex", gap: "64px" }}>
              <div>
                <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Cutoff</p>
                <p style={{ margin: "2px 0 0", fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)" }}>{formatDate(hackathon.cutoffTimestamp)}</p>
                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Staking closes</p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Results</p>
                <p style={{ margin: "2px 0 0", fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)" }}>{formatDate(hackathon.resultsTimestamp)}</p>
                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Judge announcement</p>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Projects</p>
              <p style={{ margin: "2px 0 0", fontSize: "0.875rem", fontWeight: 700, color: "var(--c-text-2)" }}>
                {pLoading ? "…" : projects.length}
              </p>
            </div>
          </div>

          {/* Prize tiers */}
          <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "12px" }}>
            <p style={{ margin: "0 0 6px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Prize tiers</p>
            <div style={{ display: "inline-flex", overflow: "hidden", borderRadius: "6px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)" }}>
              {hackathon.tierPcts.map((pct, i) => (
                <span
                  key={i}
                  style={{ padding: "4px 10px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-indigo-text)", borderLeft: i > 0 ? "1px solid var(--c-indigo-border)" : "none" }}
                >
                  #{i + 1}: {pct}%
                </span>
              ))}
            </div>
          </div>

          {/* Effective tier pcts if resolved */}
          {hackathon.isResolved && (
            <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "12px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>
                Effective tier allocations (after cascade)
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {hackathon.effectiveTierPcts.map((bps, i) => (
                  <span
                    key={i}
                    style={{ borderRadius: "8px", background: "var(--c-indigo-light)", border: "1px solid var(--c-indigo-border)", padding: "4px 10px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-indigo-text)" }}
                  >
                    Tier {i + 1}: {(bps / 100).toFixed(2)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Time indicator */}
          {!hackathon.isResolved && status !== "pending" && (
            <div style={{ marginTop: "16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
              {status === "open" && (
                <>Staking closes in <span style={{ fontWeight: 600, color: "var(--c-amber-text)" }}>{timeUntil(hackathon.cutoffTimestamp)}</span></>
              )}
              {status === "cutoff" && (
                <>Results in <span style={{ fontWeight: 600, color: "var(--c-sky-text)" }}>{timeUntil(hackathon.resultsTimestamp)}</span></>
              )}
            </div>
          )}
        </div>

        {/* Projects header + sort controls */}
        <div className="sm-flex-row" style={{ marginBottom: "12px", gap: "8px", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>Projects</h2>
          {projects.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", borderRadius: "12px", border: "1px solid var(--card-border)", background: "var(--card-bg)", padding: "4px" }}>
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
                  className={`ui-sort-tab ${sortMode === mode ? "ui-sort-tab-active" : "ui-sort-tab-inactive"}`}
                >
                  <span className="sm-hidden">{label}</span>
                  <span className="hidden-sm-inline">{labelFull}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {pLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="ui-skeleton" style={{ height: "80px" }} />
            ))}
          </div>
        ) : pError ? (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
            {pError}
          </div>
        ) : projects.length === 0 ? (
          <div style={{ borderRadius: "12px", border: "1px dashed var(--c-divider)", background: "var(--card-bg)", padding: "32px", textAlign: "center" }}>
            <p style={{ margin: 0, color: "var(--c-text-4)" }}>No projects registered yet.</p>
            {status === "open" && (
              <p style={{ margin: "8px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
                Building something?{" "}
                <Link href="/dev" className="ui-text-link" style={{ fontWeight: 500 }}>Submit your project →</Link>
              </p>
            )}
          </div>
        ) : (
          <div key={version} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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

        {status === "resolved" && visibleProjects.length > 0 && (
          <CrowdVsJudges projects={visibleProjects} />
        )}
      </main>
    </div>
  );
}
