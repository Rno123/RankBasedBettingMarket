"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import { useHackathons } from "@/hooks/useHackathons";
import { useProjects } from "@/hooks/useProjects";
import { PublicKey } from "@solana/web3.js";
import { formatTokens, repoName } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import type { ProjectMetadata, GithubStats } from "@/lib/types";

function daysAgo(isoDate: string | null): string {
  if (!isoDate) return "—";
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function activityColor(commits: number | null): string {
  if (commits === null) return "var(--c-text-4)";
  if (commits >= 10) return "var(--c-emerald-text)";
  if (commits >= 3) return "var(--c-amber-text)";
  return "var(--c-text-3)";
}

export default function DashboardPage() {
  const { hackathons, loading: hLoading } = useHackathons();
  const [selectedId, setSelectedId] = useState<string>("");

  // Set default selection once hackathons load
  useEffect(() => {
    if (!selectedId && hackathons.length > 0) {
      setSelectedId(hackathons[0].pubkey.toBase58());
    }
  }, [hackathons.length]);

  const selectedHackathon = hackathons.find((h) => h.pubkey.toBase58() === selectedId) ?? null;
  const selectedPk = selectedHackathon ? new PublicKey(selectedId) : null;

  const { projects, loading: pLoading } = useProjects(selectedPk);

  const [metadataMap, setMetadataMap] = useState<Record<string, ProjectMetadata>>({});
  const [githubStatsMap, setGithubStatsMap] = useState<Record<string, GithubStats | null>>({});
  const [statsLoading, setStatsLoading] = useState(false);

  // Load project metadata from Supabase
  useEffect(() => {
    if (!selectedId || projects.length === 0) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase
      .from("project_metadata")
      .select("*")
      .eq("hackathon_pubkey", selectedId)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, ProjectMetadata> = {};
        for (const row of data) map[row.project_pubkey] = row as ProjectMetadata;
        setMetadataMap(map);
      });
  }, [selectedId, projects.length]);

  // Load GitHub stats
  useEffect(() => {
    if (projects.length === 0) return;
    setStatsLoading(true);
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
      setStatsLoading(false);
    });
  }, [projects.map((p) => p.githubUrl).join(",")]);

  // Sort by most recent commit, then by commits_7d
  const sortedProjects = [...projects].sort((a, b) => {
    const aStats = githubStatsMap[a.githubUrl];
    const bStats = githubStatsMap[b.githubUrl];
    const aDate = aStats?.last_commit_at ? new Date(aStats.last_commit_at).getTime() : 0;
    const bDate = bStats?.last_commit_at ? new Date(bStats.last_commit_at).getTime() : 0;
    if (bDate !== aDate) return bDate - aDate;
    return (bStats?.commits_7d ?? -1) - (aStats?.commits_7d ?? -1);
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "960px", padding: "40px 16px" }}>
        {/* Header */}
        <div style={{ marginBottom: "24px" }}>
          <h1 style={{ margin: "0 0 4px", fontSize: "clamp(1.25rem, 3vw, 1.5rem)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>
            Activity Dashboard
          </h1>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-3)" }}>
            Live commit activity and social links for all registered projects.
          </p>
        </div>

        {/* Hackathon selector */}
        {hLoading ? (
          <div className="ui-skeleton" style={{ height: "40px", width: "280px", marginBottom: "24px" }} />
        ) : hackathons.length === 0 ? (
          <p style={{ color: "var(--c-text-4)" }}>No hackathons found.</p>
        ) : (
          <div style={{ marginBottom: "24px" }}>
            <label
              htmlFor="hackathon-select"
              style={{ display: "block", marginBottom: "6px", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}
            >
              Hackathon
            </label>
            <select
              id="hackathon-select"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setMetadataMap({});
                setGithubStatsMap({});
              }}
              style={{
                borderRadius: "8px",
                border: "1px solid var(--c-divider)",
                background: "var(--card-bg-alt)",
                padding: "8px 12px",
                fontSize: "0.875rem",
                color: "var(--c-text)",
                minWidth: "260px",
                cursor: "pointer",
              }}
            >
              {hackathons.map((h) => (
                <option key={h.pubkey.toBase58()} value={h.pubkey.toBase58()}>
                  {h.name || h.pubkey.toBase58().slice(0, 12) + "…"}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Stats summary strip */}
        {!pLoading && projects.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
            {[
              { label: "Projects", value: projects.length },
              {
                label: "Active this week",
                value: Object.values(githubStatsMap).filter((s) => (s?.commits_7d ?? 0) > 0).length,
              },
              {
                label: "Total commits (7d)",
                value: Object.values(githubStatsMap).reduce((acc, s) => acc + (s?.commits_7d ?? 0), 0),
              },
              {
                label: "Total pool",
                value: selectedHackathon ? formatTokens(selectedHackathon.totalPool) + " USDC" : "—",
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="ui-card"
                style={{ padding: "12px 16px", minWidth: "120px" }}
              >
                <p style={{ margin: 0, fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>{label}</p>
                <p style={{ margin: "2px 0 0", fontSize: "1.125rem", fontWeight: 900, color: "var(--c-text)" }}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Project table */}
        {pLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="ui-skeleton" style={{ height: "64px" }} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div style={{ borderRadius: "12px", border: "1px dashed var(--c-divider)", padding: "32px", textAlign: "center", color: "var(--c-text-4)" }}>
            No projects registered for this hackathon.
          </div>
        ) : (
          <div className="ui-card" style={{ overflow: "hidden" }}>
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px 90px 90px 120px",
                gap: "12px",
                borderBottom: "1px solid var(--c-divider-2)",
                padding: "10px 16px",
                fontSize: "0.6875rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--c-text-4)",
              }}
            >
              <span>Project</span>
              <span style={{ textAlign: "right" }}>Last commit</span>
              <span style={{ textAlign: "right" }}>7d commits</span>
              <span style={{ textAlign: "right" }}>Staked</span>
              <span style={{ textAlign: "center" }}>Links</span>
            </div>

            {sortedProjects.map((p) => {
              const stats = p.githubUrl in githubStatsMap ? githubStatsMap[p.githubUrl] : undefined;
              const meta = metadataMap[p.pubkey.toBase58()];
              const commits7d = stats?.commits_7d ?? null;

              return (
                <div
                  key={p.pubkey.toBase58()}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px 90px 90px 120px",
                    gap: "12px",
                    alignItems: "center",
                    borderBottom: "1px solid var(--c-divider-2)",
                    padding: "12px 16px",
                  }}
                >
                  {/* Project name */}
                  <div style={{ minWidth: 0 }}>
                    <a
                      href={p.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                        color: "var(--c-text)",
                        textDecoration: "none",
                      }}
                    >
                      {repoName(p.githubUrl)}
                    </a>
                    {p.rank > 0 && (
                      <span style={{ fontSize: "0.6875rem", color: "var(--c-text-4)" }}>Rank #{p.rank}</span>
                    )}
                  </div>

                  {/* Last commit */}
                  <div style={{ textAlign: "right", fontSize: "0.8125rem", color: "var(--c-text-3)" }}>
                    {statsLoading && stats === undefined ? (
                      <span style={{ opacity: 0.4 }}>…</span>
                    ) : (
                      daysAgo(stats?.last_commit_at ?? null)
                    )}
                  </div>

                  {/* 7-day commits */}
                  <div style={{ textAlign: "right", fontSize: "0.875rem", fontWeight: 700, color: activityColor(commits7d) }}>
                    {statsLoading && stats === undefined ? (
                      <span style={{ opacity: 0.4, fontWeight: 400 }}>…</span>
                    ) : commits7d !== null ? (
                      commits7d
                    ) : (
                      <span style={{ fontWeight: 400, color: "var(--c-text-4)" }}>—</span>
                    )}
                  </div>

                  {/* Staked */}
                  <div style={{ textAlign: "right", fontSize: "0.8125rem", color: "var(--c-text-3)" }}>
                    {formatTokens(p.totalStaked)}
                    <span style={{ fontSize: "0.6875rem", marginLeft: "2px", color: "var(--c-text-4)" }}>USDC</span>
                  </div>

                  {/* Social links */}
                  <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
                    {meta?.twitter_handle && (
                      <a
                        href={`https://twitter.com/${meta.twitter_handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`@${meta.twitter_handle} on X`}
                        style={{ color: "var(--c-sky-text)", fontSize: "0.75rem", textDecoration: "none", fontWeight: 600 }}
                      >
                        𝕏
                      </a>
                    )}
                    {meta?.telegram && (
                      <a
                        href={meta.telegram.startsWith("http") ? meta.telegram : `https://t.me/${meta.telegram}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Telegram"
                        style={{ color: "#3b82f6", fontSize: "0.75rem", textDecoration: "none", fontWeight: 600 }}
                      >
                        TG
                      </a>
                    )}
                    {meta?.discord && (
                      <a
                        href={meta.discord.startsWith("http") ? meta.discord : `https://discord.gg/${meta.discord}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Discord"
                        style={{ color: "var(--c-indigo-text)", fontSize: "0.75rem", textDecoration: "none", fontWeight: 600 }}
                      >
                        DC
                      </a>
                    )}
                    {!meta?.twitter_handle && !meta?.telegram && !meta?.discord && (
                      <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
