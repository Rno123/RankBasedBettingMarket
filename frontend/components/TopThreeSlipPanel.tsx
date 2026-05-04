"use client";

import { useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { SystemProgram, Transaction } from "@solana/web3.js";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getProgram } from "@/lib/program";
import { escrowPda, stakePda, whitelistPda } from "@/lib/pda";
import { MAX_STAKE_PER_WALLET } from "@/lib/constants";
import { formatTokens, repoName } from "@/lib/format";
import { estimateSlipPayout, formatRoi } from "@/lib/payout";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { UserStakeInfo } from "@/hooks/useUserStake";

export type BetMode = "single" | "top3";

export type SlipLeg = {
  project: ProjectInfo;
  weightPct: number;
  amountLamports: bigint;
};

export type SlipDraft = {
  mode: BetMode;
  totalLamports: bigint;
  legs: SlipLeg[];
  advancedWeights: boolean;
};

interface Props {
  hackathon: HackathonInfo;
  draft: SlipDraft;
  totalInput: string;
  projectNames: Record<string, string>;
  stakesByProject: Record<string, UserStakeInfo | null>;
  isWhitelisted: boolean | null;
  onTotalInputChange: (value: string) => void;
  onToggleAdvanced: () => void;
  onWeightChange: (index: number, value: number) => void;
  onMoveLeg: (index: number, direction: -1 | 1) => void;
  onRemoveLeg: (projectKey: string) => void;
  onSuccess: () => void;
}

const MAX_STAKE_PER_WALLET_BIGINT = BigInt(MAX_STAKE_PER_WALLET);

export default function TopThreeSlipPanel({
  hackathon,
  draft,
  totalInput,
  projectNames,
  stakesByProject,
  isWhitelisted,
  onTotalInputChange,
  onToggleAdvanced,
  onWeightChange,
  onMoveLeg,
  onRemoveLeg,
  onSuccess,
}: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);
  const walletBalance = useTokenBalance(publicKey, hackathon.usdcMint, walletRefreshKey);

  const estimate = useMemo(() => estimateSlipPayout(
    draft.legs.map((leg) => {
      const existingStake = stakesByProject[leg.project.pubkey.toBase58()];
      return {
        amountLamports: leg.amountLamports,
        projectTotalShares: leg.project.totalShares,
        existingUserShares: existingStake?.shares ?? 0n,
        existingUserAmount: existingStake?.amount ?? 0n,
      };
    }),
    {
      nowSecs: Math.floor(Date.now() / 1000),
      startTimestamp: hackathon.startTimestamp,
      cutoffTimestamp: hackathon.cutoffTimestamp,
      hackathonTotalPool: hackathon.totalPool,
      tierPcts: hackathon.tierPcts,
      protocolFeeBps: hackathon.protocolFeeBps ?? 150,
    },
  ), [draft.legs, hackathon.startTimestamp, hackathon.cutoffTimestamp, hackathon.totalPool, hackathon.tierPcts, hackathon.protocolFeeBps, stakesByProject]);

  const validationError = useMemo(() => {
    if (!publicKey) return "Connect your wallet to place a Top 3 slip.";
    if (isWhitelisted === false) return "Your wallet is not whitelisted for this hackathon.";
    if (draft.legs.length === 0) return "Add up to 3 distinct projects to your slip.";
    if (draft.totalLamports <= 0n) return "Enter a total USDC amount for the slip.";
    if (draft.legs.some((leg) => leg.project.depositAmountPaid === 0n && hackathon.depositAmount > 0n)) {
      return "Every selected project must have its builder deposit paid before crowd staking is allowed.";
    }
    if (walletBalance !== null && draft.totalLamports > walletBalance) {
      return "Your wallet does not have enough USDC for this slip.";
    }
    for (const leg of draft.legs) {
      if (leg.amountLamports <= 0n) {
        return "Each selected project must receive more than 0 USDC.";
      }
      const existingStake = stakesByProject[leg.project.pubkey.toBase58()];
      if ((existingStake?.amount ?? 0n) + leg.amountLamports > MAX_STAKE_PER_WALLET_BIGINT) {
        return "One of your picks would exceed the 250 USDC per-project wallet cap.";
      }
    }
    const totalAssigned = draft.legs.reduce((sum, leg) => sum + leg.amountLamports, 0n);
    if (totalAssigned !== draft.totalLamports) {
      return "Slip amounts must add up to the total stake exactly.";
    }
    return null;
  }, [draft.legs, draft.totalLamports, hackathon.depositAmount, isWhitelisted, publicKey, stakesByProject, walletBalance]);
  const visibleError = txError || ((draft.legs.length > 0 || totalInput.trim()) ? validationError : null);

  async function handleSubmit() {
    if (!publicKey || !anchorWallet || validationError) return;
    setBusy(true);
    setTxError(null);

    try {
      const program = getProgram(anchorWallet);
      const userAta = getAssociatedTokenAddressSync(hackathon.usdcMint, publicKey);
      const escrow = escrowPda(hackathon.pubkey);
      const whitelistEntry = !hackathon.openStaking
        ? whitelistPda(hackathon.pubkey, publicKey)
        : null;

      const ixs = await Promise.all(
        draft.legs.map((leg) => {
          const builder = (program.methods as any)
            .stake(new BN(leg.amountLamports.toString()))
            .accounts({
              user: publicKey,
              hackathon: hackathon.pubkey,
              project: leg.project.pubkey,
              userStake: stakePda(publicKey, leg.project.pubkey),
              userTokenAccount: userAta,
              escrow,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            });

          if (whitelistEntry) {
            builder.remainingAccounts([
              { pubkey: whitelistEntry, isWritable: false, isSigner: false },
            ]);
          }

          return builder.instruction();
        }),
      );

      const tx = new Transaction().add(...ixs);
      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, "confirmed");
      setWalletRefreshKey((value) => value + 1);
      onSuccess();
    } catch (e: any) {
      setTxError(e.message ?? "Slip transaction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-card" style={{ marginBottom: "20px", padding: "18px" }}>
      <div className="mobile-stack-between" style={{ gap: "14px" }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-indigo-text)" }}>
            Top 3 slip
          </p>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 900, color: "var(--c-text)" }}>
            Pick up to 3 projects in one transaction
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
            Ordered picks map to your projected #1, #2, and #3 finish.
          </p>
        </div>
        <div style={{ minWidth: 0, textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            Picks added
          </p>
          <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 900, color: "var(--c-text)" }}>
            {draft.legs.length} / 3
          </p>
        </div>
      </div>

      <div style={{ marginTop: "16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
          <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>
            Total stake (USDC)
          </label>
          <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
            Split across every selected leg
          </span>
        </div>
        {walletBalance !== null && (
          <p style={{ margin: "0 0 6px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
            Wallet available: <span style={{ fontWeight: 600, color: "var(--c-text-3)" }}>{formatTokens(walletBalance)} USDC</span>
          </p>
        )}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.000001"
          placeholder="0.00"
          value={totalInput}
          onChange={(event) => onTotalInputChange(event.target.value)}
          className="ui-input"
        />
      </div>

      <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {draft.legs.length === 0 ? (
          <div style={{ borderRadius: "12px", border: "1px dashed var(--c-divider)", background: "var(--card-bg-alt)", padding: "16px", fontSize: "0.875rem", color: "var(--c-text-4)" }}>
            Add projects from the list below. Once a pick is added, you can reorder it here.
          </div>
        ) : (
          draft.legs.map((leg, index) => {
            const projectKey = leg.project.pubkey.toBase58();
            const existingStake = stakesByProject[projectKey];
            const projectName = projectNames[projectKey] || repoName(leg.project.githubUrl);

            return (
              <div
                key={projectKey}
                style={{ borderRadius: "12px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "14px" }}
              >
                <div className="mobile-stack-between" style={{ gap: "10px" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: "0 0 4px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--c-indigo-text)" }}>
                      My #{index + 1}
                    </p>
                    <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "var(--c-text)" }}>
                      {projectName}
                    </p>
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                      This leg stakes {formatTokens(leg.amountLamports)} USDC
                      {existingStake && existingStake.amount > 0n ? ` on top of your existing ${formatTokens(existingStake.amount)} USDC` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => onMoveLeg(index, -1)}
                      disabled={index === 0}
                      className="ui-btn ui-btn-outline ui-btn-xs"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveLeg(index, 1)}
                      disabled={index === draft.legs.length - 1}
                      className="ui-btn ui-btn-outline ui-btn-xs"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveLeg(projectKey)}
                      className="ui-btn ui-btn-outline-red ui-btn-xs"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px 14px" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
                      Weight
                    </p>
                    <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>
                      {leg.weightPct.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
                      Tier estimate
                    </p>
                    <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>
                      #{index + 1} uses {estimate.legs[index]?.tierPct ?? 0}%
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {draft.legs.length > 1 && (
        <div style={{ marginTop: "16px" }}>
          <button
            type="button"
            onClick={onToggleAdvanced}
            className="ui-btn ui-btn-outline"
          >
            {draft.advancedWeights ? "Hide advanced weighting" : "Advanced weighting"}
          </button>

          {draft.advancedWeights && (
            <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
              {draft.legs.map((leg, index) => (
                <label key={leg.project.pubkey.toBase58()} style={{ display: "block" }}>
                  <span style={{ display: "block", marginBottom: "6px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-text-3)" }}>
                    Pick #{index + 1} weight
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    value={Number.isFinite(leg.weightPct) ? Number(leg.weightPct.toFixed(1)) : 0}
                    onChange={(event) => onWeightChange(index, Number.parseFloat(event.target.value))}
                    className="ui-input"
                  />
                </label>
              ))}
            </div>
          )}

          {draft.advancedWeights && (
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
              Weights are normalized automatically, and the final leg absorbs the rounding remainder so the totals match exactly.
            </p>
          )}
        </div>
      )}

      {draft.legs.length > 0 && draft.totalLamports > 0n && (
        <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid var(--c-emerald-border, var(--c-indigo-border))", background: "var(--c-emerald-light, var(--c-indigo-light))", padding: "14px" }}>
          <p style={{ margin: "0 0 4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            Ordered slip estimate
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "1.25rem", fontWeight: 900, color: "var(--c-text)" }}>
              ~{formatTokens(estimate.combinedEstimated)} USDC
            </span>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: estimate.combinedEstimated >= estimate.combinedStaked ? "var(--c-emerald-text, var(--c-indigo-text))" : "var(--c-text-4)" }}>
              {formatRoi(estimate.combinedEstimated, estimate.combinedStaked)}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: "var(--c-text-4)" }}>
            Assumes your #1, #2, and #3 picks land in those tiers and no other project shares that tier allocation.
          </p>
        </div>
      )}

      {visibleError && (
        <p style={{ margin: "14px 0 0", borderRadius: "8px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "12px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
          {visibleError}
        </p>
      )}

      <div style={{ marginTop: "16px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={handleSubmit}
          disabled={busy || !!validationError}
          className="ui-btn ui-btn-indigo mobile-fill"
        >
          {busy ? "Sending..." : draft.legs.length > 0 ? `Place ${draft.legs.length}-pick slip` : "Place Top 3 slip"}
        </button>
        <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
          Top 3 mode keeps everything in one wallet prompt.
        </span>
      </div>
    </div>
  );
}
