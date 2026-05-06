"use client";

import { repoName, rankBadgeStyle } from "@/lib/format";
import type { ProjectInfo } from "@/hooks/useProjects";

export default function CrowdVsJudges({ projects }: { projects: ProjectInfo[] }) {
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
      <div className="ui-card">
        {/* Header — columns: project name | judge | crowd | match */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 56px 56px", gap: "8px", borderBottom: "1px solid var(--c-divider-2)", padding: "10px 16px", fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
          <span>Project</span>
          <span style={{ textAlign: "center" }}>Judge</span>
          <span style={{ textAlign: "center" }}>Crowd</span>
          <span style={{ textAlign: "center" }}>Match</span>
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
              style={{ display: "grid", gridTemplateColumns: "1fr 56px 56px 56px", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--c-divider-2)", padding: "12px 16px", transition: "background 0.15s" }}
            >
              <a
                href={p.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 500, color: "var(--c-text-2)", textDecoration: "none" }}
              >
                {repoName(p.githubUrl)}
              </a>

              <div style={{ display: "flex", justifyContent: "center" }}>
                <span style={{ display: "flex", height: "28px", width: "28px", alignItems: "center", justifyContent: "center", borderRadius: "8px", fontSize: "0.75rem", fontWeight: 900, ...rankBadgeStyle(judgeRank) }}>
                  #{judgeRank}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
                <span style={{ display: "flex", height: "28px", width: "28px", alignItems: "center", justifyContent: "center", borderRadius: "8px", fontSize: "0.75rem", fontWeight: 900, ...rankBadgeStyle(crowdRank) }}>
                  #{crowdRank}
                </span>
                {!exact && (
                  <span
                    style={{ fontSize: "0.6875rem", fontWeight: 700, color: delta < 0 ? "var(--c-emerald-text)" : "var(--c-red-text)" }}
                    title={delta < 0 ? "Crowd ranked higher than judges" : "Crowd ranked lower than judges"}
                  >
                    {delta < 0 ? `▲${Math.abs(delta)}` : `▼${delta}`}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "center" }}>
                {exact ? (
                  <span style={{ borderRadius: "9999px", background: "var(--c-emerald-light)", padding: "2px 6px", fontSize: "0.6875rem", fontWeight: 600, color: "var(--c-emerald-text)", whiteSpace: "nowrap" }}>
                    ✓
                  </span>
                ) : close ? (
                  <span style={{ borderRadius: "9999px", background: "var(--c-sky-light)", padding: "2px 6px", fontSize: "0.6875rem", fontWeight: 600, color: "var(--c-sky-text)", whiteSpace: "nowrap" }}>
                    ≈
                  </span>
                ) : (
                  <span style={{ borderRadius: "9999px", background: "var(--c-divider-2)", padding: "2px 6px", fontSize: "0.6875rem", fontWeight: 600, color: "var(--c-text-4)", whiteSpace: "nowrap" }}>
                    ✗
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
