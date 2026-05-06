"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatTokens, repoName, rankBadgeStyle, daysAgo } from "@/lib/format";
import { hackathonStatus } from "@/lib/format";
import { useUserStake } from "@/hooks/useUserStake";
import StakeModal from "@/components/StakeModal";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { ProjectMetadata, GithubStats } from "@/lib/types";

interface Props {
  hackathon: HackathonInfo;
  project: ProjectInfo;
  status: ReturnType<typeof hackathonStatus>;
  isWhitelisted: boolean | null;
  stake: ReturnType<typeof useUserStake>["stake"];
  metadata?: ProjectMetadata;
  githubStats?: GithubStats | null;
  onStakeUpdated: () => void;
  onClose: () => void;
}

export default function ProjectDetailModal({
  hackathon,
  project,
  status,
  isWhitelisted,
  stake,
  metadata,
  githubStats,
  onStakeUpdated,
  onClose,
}: Props) {
  const { publicKey } = useWallet();
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const totalPool = hackathon.totalPool;
  const share = totalPool > 0n ? Number((project.totalStaked * 10000n) / totalPool) / 100 : 0;
  const repoLabel = repoName(project.githubUrl);
  const projectLabel = metadata?.project_name?.trim() || repoLabel;
  const stakingEnabled = hackathon.depositAmount === 0n || project.depositAmountPaid > 0n;

  return (
    <>
      <div
        className="ui-modal-overlay"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="ui-modal-card" style={{ maxHeight: "85vh", overflowY: "auto" }}>
          {/* Header */}
          <div style={{ marginBottom: "16px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                {metadata?.icon_url ? (
                  <div style={{ height: "32px", width: "32px", flexShrink: 0, borderRadius: "8px", overflow: "hidden", border: "1px solid var(--c-divider)" }}>
                    <img src={metadata.icon_url} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} />
                  </div>
                ) : (
                  <div style={{ display: "flex", height: "32px", width: "32px", flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "8px", fontSize: "0.875rem", fontWeight: 900, ...rankBadgeStyle(project.rank) }}>
                    {project.rank > 0 ? project.rank : "–"}
                  </div>
                )}
                <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 900, color: "var(--c-text)" }}>{projectLabel}</h2>
              </div>
              <a href={project.githubUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", color: "var(--c-indigo-text)", textDecoration: "none" }}>{repoLabel}</a>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-4)", fontSize: "1rem", lineHeight: 1, padding: "4px", flexShrink: 0 }}>✕</button>
          </div>

          {/* Stats — 3 rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
            {/* Row 1: Total staked + pool share */}
            <div style={{ borderRadius: "10px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "14px 16px" }}>
              <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)", lineHeight: 1.2 }}>
                {formatTokens(project.totalStaked)} <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                Total staked · <span style={{ fontWeight: 600, color: "var(--c-text-2)" }}>{share.toFixed(1)}%</span> of pool
              </p>
            </div>

            {/* Row 2: Builder self-stake */}
            <div style={{ borderRadius: "10px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
              {project.builderStaked > 0n ? (
                <span style={{ display: "flex", height: "22px", width: "22px", alignItems: "center", justifyContent: "center", borderRadius: "6px", background: "var(--c-emerald-light)", color: "var(--c-emerald-text)", fontSize: "0.75rem", fontWeight: 900, flexShrink: 0 }}>✓</span>
              ) : (
                <span style={{ display: "flex", height: "22px", width: "22px", alignItems: "center", justifyContent: "center", borderRadius: "6px", background: "var(--c-divider-2)", color: "var(--c-text-4)", fontSize: "0.75rem", fontWeight: 900, flexShrink: 0 }}>✗</span>
              )}
              <span style={{ fontSize: "0.8125rem", color: "var(--c-text-3)" }}>Builder self-stake</span>
              <span style={{ marginLeft: "auto", fontSize: "0.875rem", fontWeight: 700, color: project.builderStaked > 0n ? "var(--c-text)" : "var(--c-text-4)" }}>
                {project.builderStaked > 0n ? formatTokens(project.builderStaked) : "None"}
              </span>
            </div>

            {/* Row 3: Your stake */}
            {(() => {
              const MAX = 250_000_000;
              const cur = stake?.amount ?? 0n;
              const pct = Math.min(100, Number(cur) / MAX * 100);
              return (
                <div style={{ borderRadius: "10px", border: cur > 0n ? "1px solid var(--c-indigo-border)" : "1px solid var(--c-divider)", background: cur > 0n ? "var(--c-indigo-light)" : "var(--card-bg-alt)", padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: cur > 0n ? "8px" : "0" }}>
                    <span style={{ fontSize: "0.8125rem", color: cur > 0n ? "var(--c-indigo-text)" : "var(--c-text-3)" }}>Your stake</span>
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: cur > 0n ? "var(--c-indigo-text)" : "var(--c-text-4)" }}>
                      {cur > 0n ? formatTokens(cur) : "—"} <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "var(--c-text-4)" }}>/ {formatTokens(BigInt(MAX))}</span>
                    </span>
                  </div>
                  {cur > 0n && (
                    <div className="ui-stake-bar-track">
                      <div className="ui-stake-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* GitHub stats */}
          {githubStats !== undefined && githubStats !== null && (
            <div style={{ marginBottom: "12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
              Last commit: <span style={{ fontWeight: 500, color: "var(--c-text-3)" }}>{daysAgo(githubStats.last_commit_at)}</span>
              {" · "}
              <span style={{ fontWeight: 500, color: "var(--c-text-3)" }}>{githubStats.commits_7d ?? "?"} commit{githubStats.commits_7d !== 1 ? "s" : ""} this week</span>
            </div>
          )}

          {/* Social links */}
          {metadata && (metadata.twitter_handle || metadata.telegram || metadata.discord) && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 12px", fontSize: "0.875rem", marginBottom: "16px" }}>
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

          {/* FYI notice */}
          {!stakingEnabled && (
            <div style={{ marginBottom: "16px", borderRadius: "10px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "10px 12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
              FYI only. This builder hasn&apos;t activated staking yet.
            </div>
          )}

          {/* Action button */}
          {status === "open" && stakingEnabled && (
            <>
              {!publicKey ? (
                <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>Connect your wallet to stake.</p>
              ) : isWhitelisted === false ? (
                <p style={{ fontSize: "0.875rem", color: "var(--c-amber-text)" }}>Your wallet isn&apos;t whitelisted for this hackathon.</p>
              ) : (
                <button
                  onClick={() => setStakeModalOpen(true)}
                  className="ui-btn ui-btn-indigo"
                  style={{ width: "100%" }}
                >
                  {stake && stake.amount > 0n && !stake.isClaimed ? "Manage stake" : "Stake"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {stakeModalOpen && (
        <StakeModal
          hackathon={hackathon}
          project={project}
          stake={stake ?? null}
          onClose={() => setStakeModalOpen(false)}
          onSuccess={() => { onStakeUpdated(); setStakeModalOpen(false); }}
        />
      )}
    </>
  );
}
