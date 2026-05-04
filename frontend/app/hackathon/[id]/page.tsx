"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { escrowPda, stakePda } from "@/lib/pda";
import Navbar from "@/components/Navbar";
import StakeModal from "@/components/StakeModal";
import ClaimButton from "@/components/ClaimButton";
import ClaimSlipButton from "@/components/ClaimSlipButton";
import ParlayModal from "@/components/ParlayModal";
import { useProjects } from "@/hooks/useProjects";
import { useHackathons } from "@/hooks/useHackathons";
import { useUserStake } from "@/hooks/useUserStake";
import { useUserStakesForProjects } from "@/hooks/useUserStakesForProjects";
import {
  formatTokens,
  formatTokensRounded,
  formatDate,
  hackathonStatus,
  timeUntil,
  repoName,
} from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { useWhitelistStatus } from "@/hooks/useWhitelistStatus";
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
  status,
  isWhitelisted,
  onStakeUpdated,
  metadata,
  githubStats,
  stakeRefreshKey,
}: {
  project: ProjectInfo;
  hackathon: HackathonInfo;
  status: ReturnType<typeof hackathonStatus>;
  isWhitelisted: boolean | null;
  onStakeUpdated: () => void;
  metadata?: ProjectMetadata;
  githubStats?: GithubStats | null;
  stakeRefreshKey?: number;
}) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { stake } = useUserStake(publicKey, project.pubkey, stakeRefreshKey);
  const [detailOpen, setDetailOpen] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundErr, setRefundErr] = useState<string | null>(null);

  async function handleRefund() {
    if (!publicKey || !anchorWallet) return;
    setRefundBusy(true); setRefundErr(null);
    try {
      const program = getProgram(anchorWallet);
      const userAta = getAssociatedTokenAddressSync(hackathon.usdcMint, publicKey);
      const escrow = escrowPda(hackathon.pubkey);
      const userStake = stakePda(publicKey, project.pubkey);
      await (program.methods as any).refund().accounts({
        user: publicKey,
        hackathon: hackathon.pubkey,
        project: project.pubkey,
        userStake,
        userTokenAccount: userAta,
        escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      }).rpc();
      onStakeUpdated();
    } catch (e: any) { setRefundErr(e.message ?? "Refund failed"); }
    finally { setRefundBusy(false); }
  }

  const totalPool = hackathon.totalPool;
  const stakingEnabled =
    hackathon.depositAmount === 0n || project.depositAmountPaid > 0n;
  const share =
    totalPool > 0n
      ? Number((project.totalStaked * 10000n) / totalPool) / 100
      : 0;

  const rankLabel = project.rank === 0 ? "Unranked" : `#${project.rank}`;
  const repoLabel = repoName(project.githubUrl);
  const projectLabel = metadata?.project_name?.trim() || repoLabel;
  const projectSubLabel = projectLabel === repoLabel ? rankLabel : `${repoLabel} · ${rankLabel}`;

  return (
    <>
      <div className="ui-project-row">
        {/* Top row: rank + name + action */}
        <div className="mobile-stack-between" style={{ gap: "10px" }}>
          <div style={{ display: "flex", minWidth: 0, alignItems: "center", gap: "12px" }}>
            {metadata?.icon_url ? (
              <div style={{ height: "36px", width: "36px", flexShrink: 0, borderRadius: "8px", overflow: "hidden", border: "1px solid var(--c-divider)" }}>
                <img src={metadata.icon_url} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} />
              </div>
            ) : (
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
            )}
            <div style={{ minWidth: 0 }}>
              <a
                href={project.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mobile-link-wrap"
                style={{ fontWeight: 600, color: "var(--c-text)", lineHeight: 1.35, textDecoration: "none", transition: "color 0.15s" }}
              >
                {projectLabel}
              </a>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--c-text-4)" }}>{projectSubLabel}</p>
            </div>
          </div>

          {/* Action button */}
          <div className="mobile-fill" style={{ flexShrink: 0 }}>
            {project.isRefundEnabled && stake && stake.amount > 0n && !stake.isClaimed ? (
              <div>
                <button onClick={handleRefund} disabled={refundBusy || !publicKey} className="ui-btn ui-btn-amber ui-btn-sm mobile-fill">
                  {refundBusy ? "Refunding…" : "Refund stake"}
                </button>
                {refundErr && <p style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{refundErr}</p>}
              </div>
            ) : status === "resolved" && stake && !stake.isClaimed && stake.amount > 0n && project.rank > 0 ? (
              <ClaimButton
                hackathon={hackathon}
                project={project}
                onSuccess={onStakeUpdated}
              />
            ) : status === "resolved" && stake?.isClaimed ? (
              <span style={{ borderRadius: "9999px", background: "var(--c-emerald-light)", padding: "4px 12px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-emerald-text)" }}>Claimed</span>
            ) : (
              <button onClick={() => setDetailOpen(true)} className="ui-btn ui-btn-amber ui-btn-sm mobile-fill">View</button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px 20px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Staked</p>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>
              {formatTokens(project.totalStaked)} <span style={{ fontSize: "0.75rem", color: "var(--c-text-3)" }}>USDC</span>
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Pool share</p>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>{share.toFixed(1)}%</p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Builder self-stake</p>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text-2)" }}>
              {formatTokens(project.builderStaked)} <span style={{ fontSize: "0.75rem", color: "var(--c-text-3)" }}>USDC</span>
            </p>
          </div>
        </div>

      </div>

      {detailOpen && (
        <ProjectDetailModal
          hackathon={hackathon}
          project={project}
          status={status}
          isWhitelisted={isWhitelisted}
          stake={stake}
          metadata={metadata}
          githubStats={githubStats}
          onStakeUpdated={onStakeUpdated}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}

// ── Project Detail Modal ──────────────────────────────────────────────────────

function ProjectDetailModal({
  hackathon,
  project,
  status,
  isWhitelisted,
  stake,
  metadata,
  githubStats,
  onStakeUpdated,
  onClose,
}: {
  hackathon: HackathonInfo;
  project: ProjectInfo;
  status: ReturnType<typeof hackathonStatus>;
  isWhitelisted: boolean | null;
  stake: ReturnType<typeof useUserStake>["stake"];
  metadata?: ProjectMetadata;
  githubStats?: GithubStats | null;
  onStakeUpdated: () => void;
  onClose: () => void;
}) {
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
        style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", padding: "16px", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div style={{ width: "100%", maxWidth: "28rem", borderRadius: "16px", border: "1px solid var(--card-border)", background: "var(--modal-bg)", padding: "24px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", maxHeight: "85vh", overflowY: "auto" }}>
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

// ── Sort type ────────────────────────────────────────────────────────────────

type SortMode = "stake" | "last_commit";

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
  }, [projects.map((p) => p.githubUrl).join(",")]);

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

  if (hError || !hackathon) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <Navbar />
        <main style={{ margin: "0 auto", maxWidth: "896px", padding: "48px 16px", textAlign: "center" }}>
          {hError ? (
            <>
              <p style={{ color: "var(--c-red-text)", marginBottom: "12px" }}>Failed to load: {hError}</p>
              <button onClick={reloadHackathons} className="ui-btn ui-btn-outline" style={{ fontSize: "0.875rem" }}>Retry</button>
            </>
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
            <div className="mobile-chip-wrap">
              {hackathon.tierPcts.map((pct, i) => {
                const count = hackathon.tierExpectedCounts[i];
                return (
                  <span
                    key={i}
                    style={{ borderRadius: "6px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "4px 10px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-indigo-text)" }}
                  >
                    {count > 1 ? `${count} × ${(pct / count).toFixed(0)}%` : `${pct}%`}
                  </span>
                );
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
