"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { useHackathons } from "@/hooks/useHackathons";
import { useMyStakes } from "@/hooks/useMyStakes";
import { formatTokens, hackathonStatus, repoName } from "@/lib/format";
import { estimatePayout, formatRoi } from "@/lib/payout";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { MyStakeEntry } from "@/hooks/useMyStakes";

function getTierFromRank(rank: number, hackathon: HackathonInfo): number | null {
  if (rank === 0) return null;
  let count = 0;
  for (let i = 0; i < hackathon.tierCount - 1; i++) {
    count += hackathon.tierExpectedCounts[i] ?? 0;
    if (rank <= count) return i;
  }
  return hackathon.tierCount - 1;
}

function getStakeLifecycleStatus(entry: MyStakeEntry, hackathon: HackathonInfo | null) {
  if (entry.stake.isClaimed) return "claimed" as const;
  if (!hackathon) return "unknown" as const;
  return hackathonStatus(hackathon.irlHackathonDeadlineTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved);
}

function StakeCard({ entry, hackathon, onRefresh }: {
  entry: MyStakeEntry;
  hackathon: HackathonInfo | null;
  onRefresh: () => void;
}) {
  const { stake, project } = entry;
  const status = hackathon
    ? hackathonStatus(hackathon.irlHackathonDeadlineTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved)
    : null;

  const resolvedTierIndex = (hackathon && project && project.rank > 0)
    ? getTierFromRank(project.rank, hackathon)
    : null;

  // Tier estimates — shown for all non-claimed, non-zero positions
  const showEstimates = !stake.isClaimed && stake.amount > 0n && hackathon && project && project.totalShares > 0n;

  const estimates = showEstimates
    ? hackathon!.tierPcts.map((pct, i) => ({
        tier: i + 1,
        pct,
        estimated: estimatePayout(
          stake.shares,
          project!.totalShares,
          hackathon!.totalPool,
          pct,
          hackathon!.tierExpectedCounts[i] ?? 1,
          hackathon!.protocolFeeBps,
        ),
      }))
    : [];

  const hackathonId = hackathon?.pubkey.toBase58();
  const repoLabel = project ? repoName(project.githubUrl) : stake.project.toBase58().slice(0, 16) + "…";

  const statusBadge = stake.isClaimed
    ? { label: "Claimed", cls: "ui-badge-resolved" }
    : status === "open"   ? { label: "Active",    cls: "ui-badge-open" }
    : status === "cutoff" ? { label: "Cutoff",    cls: "ui-badge-cutoff" }
    : status === "pending"? { label: "Judging",   cls: "ui-badge-pending" }
    : status === "resolved" && stake.amount > 0n ? { label: "Claimable", cls: "ui-badge-open" }
    : { label: "Resolved", cls: "ui-badge-resolved" };

  return (
    <div className="ui-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <div>
          <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            {hackathon?.name || (hackathon ? hackathonId!.slice(0, 8) + "…" : "Unknown hackathon")}
          </p>
          <a
            href={project?.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontWeight: 700, color: "var(--c-text)", textDecoration: "none", fontSize: "0.9375rem" }}
          >
            {repoLabel}
          </a>
        </div>
        <span className={`ui-badge ${statusBadge.cls}`}>{statusBadge.label}</span>
      </div>

      {/* Stake stats */}
      <div style={{ display: "flex", gap: "24px" }}>
        <div>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Staked</p>
          <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>
            {formatTokens(stake.amount)} <span style={{ fontSize: "0.75rem", color: "var(--c-text-3)" }}>USDC</span>
          </p>
        </div>
        {project && project.rank > 0 && (
          <div>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Rank</p>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--c-indigo-text)" }}>#{project.rank}</p>
          </div>
        )}
        {project && (
          <div>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>Pool share</p>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>
              {project.totalShares > 0n
                ? ((Number(stake.shares) / Number(project.totalShares)) * 100).toFixed(2) + "%"
                : "—"}
            </p>
          </div>
        )}
      </div>

      {/* Tier estimates */}
      {showEstimates && estimates.length > 0 && (
        <div style={{ borderTop: "1px solid var(--c-divider-2)", paddingTop: "12px" }}>
          <p style={{ margin: "0 0 8px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            Est. payout if project places
            <span style={{ marginLeft: "6px", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
              (assumes sole winner in tier)
            </span>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {estimates.map(({ tier, pct, estimated }) => {
              const isActualTier = resolvedTierIndex !== null && resolvedTierIndex === tier - 1;
              return (
                <div
                  key={tier}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    borderRadius: "8px",
                    background: isActualTier ? "var(--c-indigo-light)" : "var(--card-bg-alt)",
                    border: `1px solid ${isActualTier ? "var(--c-indigo-border)" : "var(--c-divider-2)"}`,
                  }}
                >
                  <span style={{ fontSize: "0.8125rem", color: isActualTier ? "var(--c-indigo-text)" : "var(--c-text-3)" }}>
                    Tier {tier} ({pct}%)
                    {isActualTier && <span style={{ marginLeft: "6px", fontSize: "0.7rem", fontWeight: 700 }}>PLACED ✓</span>}
                  </span>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 700, color: isActualTier ? "var(--c-indigo-text)" : "var(--c-text)" }}>
                      ~{formatTokens(estimated)} USDC
                    </span>
                    <span style={{ marginLeft: "8px", fontSize: "0.75rem", color: estimated >= stake.amount ? "var(--c-emerald-text)" : "var(--c-text-4)" }}>
                      {formatRoi(estimated, stake.amount)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px", marginTop: "auto" }}>
        {hackathonId && (
          <Link
            href={`/hackathon/${hackathonId}`}
            className="ui-btn ui-btn-outline ui-btn-sm"
            style={{ flex: 1, textAlign: "center" }}
          >
            {status === "resolved" && !stake.isClaimed && stake.amount > 0n
              ? "Claim on hackathon page →"
              : "View hackathon →"}
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { publicKey } = useWallet();
  const { hackathons, loading: hackathonsLoading } = useHackathons();
  const [refreshKey, setRefreshKey] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { entries, loading: stakesLoading } = useMyStakes(publicKey ?? null, refreshKey);

  const hackathonMap = new Map(hackathons.map(h => [h.pubkey.toBase58(), h]));
  const entriesWithHackathons = entries.map((entry) => ({
    entry,
    hackathon: entry.project
      ? hackathonMap.get(entry.project.hackathon.toBase58()) ?? null
      : null,
  }));

  const totalStaked = entriesWithHackathons.reduce(
    (sum, { entry }) => sum + (entry.stake.isClaimed ? 0n : entry.stake.amount),
    0n,
  );
  const openCount = entriesWithHackathons.filter(({ entry, hackathon }) =>
    entry.stake.amount > 0n && getStakeLifecycleStatus(entry, hackathon) === "open",
  ).length;
  const claimedCount = entriesWithHackathons.filter(({ entry }) => entry.stake.isClaimed).length;

  const statusSortOrder: Record<string, number> = {
    open: 0,
    cutoff: 1,
    pending: 2,
    resolved: 3,
    unknown: 4,
    claimed: 5,
  };

  const sortedEntries = [...entriesWithHackathons].sort((a, b) => {
    const statusDiff =
      statusSortOrder[getStakeLifecycleStatus(a.entry, a.hackathon)] -
      statusSortOrder[getStakeLifecycleStatus(b.entry, b.hackathon)];
    if (statusDiff !== 0) return statusDiff;
    return b.entry.stake.stakeTimestamp - a.entry.stake.stakeTimestamp;
  });

  const groupedByHackathon = new Map<string, { hackathon: HackathonInfo | null; entries: typeof sortedEntries }>();
  for (const item of sortedEntries) {
    const key = item.hackathon?.pubkey.toBase58() ?? "unknown";
    if (!groupedByHackathon.has(key)) {
      groupedByHackathon.set(key, { hackathon: item.hackathon, entries: [] });
    }
    groupedByHackathon.get(key)!.entries.push(item);
  }
  const hackathonGroups = [...groupedByHackathon.entries()].map(([key, val]) => ({ key, ...val }));

  const loading = hackathonsLoading || stakesLoading;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "960px", padding: "48px 16px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ margin: 0, fontSize: "clamp(28px,5vw,40px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>
            My Portfolio
          </h1>
        </div>

        {!publicKey ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 16px", textAlign: "center" }}>
            <p style={{ margin: "0 0 24px", fontSize: "1rem", color: "var(--c-text-4)" }}>Connect your wallet to view your portfolio.</p>
            <ConnectWalletButton />
          </div>
        ) : loading ? (
          <>
            <div style={{ marginBottom: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
              {[0,1,2].map(i => <div key={i} className="ui-skeleton" style={{ height: "72px" }} />)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {[0,1,2].map(i => <div key={i} className="ui-skeleton" style={{ height: "180px" }} />)}
            </div>
          </>
        ) : (
          <>
            {/* Summary strip */}
            <div className="ui-card" style={{ marginBottom: "28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", padding: "16px" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.375rem", fontWeight: 900, color: "var(--c-indigo-text)" }}>
                  {formatTokens(totalStaked)}
                </div>
                <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>USDC staked</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.375rem", fontWeight: 900, color: "var(--c-text)" }}>{openCount}</div>
                <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Open positions</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.375rem", fontWeight: 900, color: "var(--c-text)" }}>{claimedCount}</div>
                <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Claimed</div>
              </div>
            </div>

            {entries.length === 0 ? (
              <div style={{ borderRadius: "16px", border: "1px dashed var(--c-divider)", padding: "48px", textAlign: "center", color: "var(--c-text-4)" }}>
                No stakes yet.{" "}
                <Link href="/hackathons" className="ui-text-link">Browse hackathons →</Link>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {hackathonGroups.map(({ key, hackathon, entries }) => {
                  const isExpanded = !collapsedGroups.has(key);
                  const hackathonName = hackathon?.name || (key !== "unknown" ? key.slice(0, 8) + "…" : "Unknown hackathon");
                  const groupTotal = entries.reduce((sum, { entry }) => sum + entry.stake.amount, 0n);
                  const projectCount = entries.length;
                  return (
                    <div key={key}>
                      <button
                        onClick={() => {
                          setCollapsedGroups(prev => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 16px",
                          borderRadius: isExpanded ? "12px 12px 0 0" : "12px",
                          background: "var(--card-bg)",
                          border: "1px solid var(--card-border)",
                          borderBottom: isExpanded ? "1px solid var(--c-divider)" : "1px solid var(--card-border)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ fontWeight: 700, color: "var(--c-text)", fontSize: "0.9375rem" }}>{hackathonName}</span>
                          <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                            {projectCount} project{projectCount !== 1 ? "s" : ""} · {formatTokens(groupTotal)} USDC staked
                          </span>
                        </div>
                        <span style={{ color: "var(--c-text-4)", fontSize: "0.875rem", display: "inline-block", transform: isExpanded ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}>▾</span>
                      </button>
                      {isExpanded && (
                        <div style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "12px",
                          padding: "12px",
                          border: "1px solid var(--card-border)",
                          borderTop: "none",
                          borderRadius: "0 0 12px 12px",
                        }}>
                          {entries.map(({ entry, hackathon: h }) => (
                            <StakeCard
                              key={entry.stake.pubkey.toBase58()}
                              entry={entry}
                              hackathon={h}
                              onRefresh={() => setRefreshKey(k => k + 1)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
