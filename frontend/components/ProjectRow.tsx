"use client";

import { useState } from "react";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { buildStakeAccounts } from "@/lib/transactions";
import { formatTokens, repoName, rankBadgeStyle, hackathonStatus } from "@/lib/format";
import { useUserStake } from "@/hooks/useUserStake";
import ClaimButton from "@/components/ClaimButton";
import ProjectDetailModal from "@/components/ProjectDetailModal";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { ProjectMetadata, GithubStats } from "@/lib/types";

interface Props {
  project: ProjectInfo;
  hackathon: HackathonInfo;
  status: ReturnType<typeof hackathonStatus>;
  isWhitelisted: boolean | null;
  onStakeUpdated: () => void;
  metadata?: ProjectMetadata;
  githubStats?: GithubStats | null;
  stakeRefreshKey?: number;
}

export default function ProjectRow({
  project,
  hackathon,
  status,
  isWhitelisted,
  onStakeUpdated,
  metadata,
  githubStats,
  stakeRefreshKey,
}: Props) {
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
      const { userAta, escrow, userStake } = buildStakeAccounts({
        hackathon: hackathon.pubkey,
        project: project.pubkey,
        user: publicKey,
        usdcMint: hackathon.usdcMint,
        feeRecipient: hackathon.feeRecipient,
        openStaking: hackathon.openStaking,
      });
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
