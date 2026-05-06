"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import ClaimSlipButton from "@/components/ClaimSlipButton";
import ParlayModal from "@/components/ParlayModal";
import ProjectRow from "@/components/ProjectRow";
import CrowdVsJudges from "@/components/CrowdVsJudges";
import ErrorBanner from "@/components/ErrorBanner";
import SkeletonRow from "@/components/SkeletonRow";
import { useProjects } from "@/hooks/useProjects";
import { useHackathons } from "@/hooks/useHackathons";
import { useUserStakesForProjects } from "@/hooks/useUserStakesForProjects";
import {
  formatTokens,
  formatTokensRounded,
  formatDate,
  hackathonStatus,
  timeUntil,
  repoName,
  ordinal,
  fmtTierPct,
} from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { useWhitelistStatus } from "@/hooks/useWhitelistStatus";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { ProjectMetadata, GithubStats, SortMode } from "@/lib/types";


// ── Main page ────────────────────────────────────────────────────────────────

export default function HackathonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { publicKey } = useWallet();
  const { hackathons, loading: hLoading, error: hError, reload: reloadHackathons } = useHackathons();
  const hackathon = hackathons.find((h) => h.pubkey.toBase58() === id) ?? null;
  const hackathonPk = hackathon?.pubkey ?? null;
  const { isWhitelisted } = useWhitelistStatus(hackathonPk, publicKey ?? null, hackathon?.openStaking);
  const { projects, loading: pLoading, error: pError, reload: reloadProjects } = useProjects(hackathonPk);
  const [version, setVersion] = useState(0);
  const [parlayOpen, setParlayOpen] = useState(false);
  const { stakesByProject, loading: stakesLoading } = useUserStakesForProjects(
    publicKey ?? null,
    projects,
    version,
  );

  const [hackathonMeta, setHackathonMeta] = useState<{ official_link?: string | null; icon_url?: string | null } | null>(null);
  const [metadataMap, setMetadataMap] = useState<Record<string, ProjectMetadata>>({});
  const [githubStatsMap, setGithubStatsMap] = useState<Record<string, GithubStats | null>>({});
  const [sortMode, setSortMode] = useState<SortMode>("stake");
  useEffect(() => {
    if (!hackathonPk) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase
      .from("hackathon_metadata")
      .select("official_link, icon_url")
      .eq("hackathon_pubkey", hackathonPk.toBase58())
      .maybeSingle()
      .then(({ data }) => { if (data) setHackathonMeta(data); });
  }, [hackathonPk?.toBase58()]);

  useEffect(() => {
    if (!hackathonPk || projects.length === 0) {
      setMetadataMap({});
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    const hpk = hackathonPk.toBase58();
    Promise.all([
      supabase.from("project_metadata").select("*").eq("hackathon_pubkey", hpk),
      supabase
        .from("project_submissions_public")
        .select("project_pubkey, github_url, icon_url, project_name, twitter_handle, telegram, discord, wallet_address")
        .eq("hackathon_pubkey", hpk),
    ]).then(([{ data: metaData }, { data: subData }]) => {
      const map: Record<string, ProjectMetadata> = {};
      if (metaData) {
        for (const row of metaData) map[row.project_pubkey] = row as ProjectMetadata;
      }
      if (subData) {
        for (const row of subData as Array<Record<string, string | null>>) {
          if (!row.project_pubkey) continue;
          if (!map[row.project_pubkey]) {
            map[row.project_pubkey] = {
              project_pubkey: row.project_pubkey,
              hackathon_pubkey: hpk,
              github_url: row.github_url ?? "",
              icon_url: row.icon_url ?? null,
              project_name: row.project_name ?? null,
              twitter_handle: row.twitter_handle ?? null,
              telegram: row.telegram ?? null,
              discord: row.discord ?? null,
              registered_wallet: row.wallet_address ?? "",
              created_at: "",
              updated_at: "",
            };
          }
        }
      }
      setMetadataMap(map);
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
  }, [projects.map((p) => p.githubUrl).sort().join(",")]);

  // Derived state — all useMemo calls must be before any early return (Rules of Hooks)
  const status = hackathon
    ? hackathonStatus(hackathon.irlHackathonDeadlineTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved)
    : ("open" as ReturnType<typeof hackathonStatus>);

  const projectNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const project of projects) {
      const projectKey = project.pubkey.toBase58();
      names[projectKey] = metadataMap[projectKey]?.project_name?.trim() || repoName(project.githubUrl);
    }
    return names;
  }, [metadataMap, projects]);

  const claimableProjects = useMemo(() => {
    if (status !== "resolved") return [];
    return projects.filter((project) => {
      const stake = stakesByProject[project.pubkey.toBase58()];
      return project.rank > 0 && !!stake && stake.amount > 0n && !stake.isClaimed;
    });
  }, [projects, stakesByProject, status]);

  if (hLoading) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <main style={{ margin: "0 auto", maxWidth: "896px", padding: "48px 16px" }}>
          <SkeletonRow height="32px" width="256px" />
          <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {[...Array(4)].map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (hError || !hackathon) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <main style={{ margin: "0 auto", maxWidth: "896px", padding: "48px 16px", textAlign: "center" }}>
          {hError ? (
            <ErrorBanner error={`Failed to load: ${hError}`} onRetry={reloadHackathons} />
          ) : (
            <p style={{ color: "var(--c-text-3)" }}>
              Hackathon not found.{" "}
              <Link href="/hackathons" className="ui-text-link">Go back</Link>
            </p>
          )}
        </main>
      </div>
    );
  }

  function refreshHackathonView() {
    setVersion((value) => value + 1);
    reloadProjects();
    reloadHackathons();
  }

  const sortedProjects = [...projects].sort((a, b) => {
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
    return 0;
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "896px", padding: "40px 16px" }}>
        {/* Back */}
        <Link href="/hackathons" className="ui-back-link">← All hackathons</Link>

        {/* Header card */}
        <div className="ui-card" style={{ marginBottom: "24px", padding: "clamp(18px, 5vw, 24px)" }}>
          <div className="mobile-stack-between">
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
                </div>
              </div>
              <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
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
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Total pool</p>
              <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>
                {formatTokensRounded(hackathon.totalPool)}{" "}
                <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
              </p>
            </div>
          </div>

          {/* Meta row */}
          <div className="grid-auto-3" style={{ marginTop: "16px", gap: "12px 16px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Cutoff</p>
              <p style={{ margin: "2px 0 0", fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)" }}>{formatDate(hackathon.cutoffTimestamp)}</p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Staking closes</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Deadline</p>
              <p style={{ margin: "2px 0 0", fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)" }}>{formatDate(hackathon.irlHackathonDeadlineTimestamp)}</p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Hackathon submissions closes</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Projects</p>
              <p style={{ margin: "2px 0 0", fontSize: "0.875rem", fontWeight: 700, color: "var(--c-text-2)" }}>
                {pLoading ? "…" : projects.length}
              </p>
            </div>
          </div>

          {/* Prize tiers */}
          <div style={{ marginTop: "16px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "12px" }}>
            <p style={{ margin: "0 0 6px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Prize tiers</p>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
              {hackathon.tierPcts.flatMap((pct, i) => {
                const count = hackathon.tierExpectedCounts[i] ?? 1;
                const chip = (
                  <span
                    key={`tier-${i}`}
                    style={{ borderRadius: "6px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "4px 10px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-indigo-text)", whiteSpace: "nowrap" }}
                  >
                    {ordinal(i + 1)}: {count} × {fmtTierPct(pct, count)}
                  </span>
                );
                return i === 0
                  ? [chip]
                  : [<span key={`sep-${i}`} style={{ color: "var(--c-text-4)", fontSize: "0.75rem", userSelect: "none" }}>|</span>, chip];
              })}
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
                <>Results in <span style={{ fontWeight: 600, color: "var(--c-sky-text)" }}>{timeUntil(hackathon.irlHackathonDeadlineTimestamp)}</span></>
              )}
            </div>
          )}
        </div>

        {status === "open" && (
          <div className="ui-card" style={{ marginBottom: "16px", padding: "16px" }}>
            <div className="mobile-stack-between" style={{ gap: "14px", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 900, color: "var(--c-text)" }}>
                  Parlay Bet
                </h2>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-3)" }}>
                  Pick 3 projects you think will win — one wallet prompt, one bet.
                </p>
              </div>
              <button
                onClick={() => setParlayOpen(true)}
                className="ui-btn ui-btn-indigo"
                style={{ flexShrink: 0, fontWeight: 800 }}
              >
                Bet
              </button>
            </div>
          </div>
        )}

        {parlayOpen && (
          <ParlayModal
            hackathon={hackathon}
            projects={projects}
            projectNames={projectNames}
            stakesByProject={stakesByProject}
            isWhitelisted={isWhitelisted}
            onClose={() => setParlayOpen(false)}
            onSuccess={() => {
              setParlayOpen(false);
              refreshHackathonView();
            }}
          />
        )}

        {status === "resolved" && publicKey && (
          stakesLoading ? (
            <div className="ui-skeleton" style={{ marginBottom: "16px", height: "112px" }} />
          ) : (
            <ClaimSlipButton
              hackathon={hackathon}
              claimableProjects={claimableProjects}
              stakesByProject={stakesByProject}
              onSuccess={refreshHackathonView}
            />
          )
        )}

        {/* Projects header + sort controls */}
        <div className="mobile-stack-between" style={{ marginBottom: "12px", gap: "10px" }}>
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>Projects</h2>
          {projects.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", borderRadius: "12px", border: "1px solid var(--card-border)", background: "var(--card-bg)", padding: "4px" }}>
              {(
                [
                  { mode: "stake", label: "Stake", labelFull: "By stake" },
                  { mode: "last_commit", label: "Commit", labelFull: "By last commit" },
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
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : pError ? (
          <ErrorBanner error={pError} />
        ) : projects.length === 0 ? (
          <div style={{ borderRadius: "12px", border: "1px dashed var(--c-divider)", background: "var(--card-bg)", padding: "32px", textAlign: "center" }}>
            <p style={{ margin: 0, color: "var(--c-text-4)" }}>No projects registered yet.</p>
            {status === "open" && (
              <p style={{ margin: "8px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
                Building something?{" "}
                <Link href="/devs" className="ui-text-link" style={{ fontWeight: 500 }}>Submit your project →</Link>
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
                status={status}
                isWhitelisted={isWhitelisted}
                onStakeUpdated={refreshHackathonView}
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

        {status === "resolved" && sortedProjects.length > 0 && (
          <CrowdVsJudges projects={sortedProjects} />
        )}
      </main>

    </div>
  );
}
