"use client";

import { useState, useMemo } from "react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { getProgram } from "@/lib/program";
import { buildStakeAccounts } from "@/lib/transactions";
import { parseTokens, formatTokens, repoName } from "@/lib/format";
import { computeShares, estimatePayout, formatRoi } from "@/lib/payout";
import { MAX_STAKE_PER_WALLET } from "@/lib/constants";
import { useWhitelistStatus } from "@/hooks/useWhitelistStatus";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { UserStakeInfo } from "@/hooks/useUserStake";

interface Props {
  hackathon: HackathonInfo;
  project: ProjectInfo;
  stake: UserStakeInfo | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function StakeModal({
  hackathon,
  project,
  stake,
  onClose,
  onSuccess,
}: Props) {
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const walletBalance = useTokenBalance(publicKey, hackathon.usdcMint);

  const { isWhitelisted, loading: checkingWhitelist } = useWhitelistStatus(
    hackathon.pubkey,
    publicKey,
    hackathon.openStaking,
  );

  const nowSecs = Math.floor(Date.now() / 1000);
  const isBuilder = !!publicKey && project.builderWallet.equals(publicKey);
  const canUnstake = !!stake && stake.amount > 0n && !stake.isClaimed && nowSecs < hackathon.cutoffTimestamp;

  // Live tier-1 payout estimate for the amount being typed
  const tier1Estimate = useMemo(() => {
    const parsed = parseTokens(amount);
    if (parsed <= 0n || hackathon.tierPcts.length === 0) return null;
    const newShares = computeShares(parsed, nowSecs, hackathon.startTimestamp, hackathon.cutoffTimestamp);
    const totalUserShares = (stake?.shares ?? 0n) + newShares;
    const totalProjectShares = project.totalShares + newShares;
    const totalPool = hackathon.totalPool + parsed;
    const estimated = estimatePayout(
      totalUserShares,
      totalProjectShares,
      totalPool,
      hackathon.tierPcts[0],
      hackathon.tierExpectedCounts[0] ?? 1,
      hackathon.protocolFeeBps ?? 150,
    );
    const totalStaked = (stake?.amount ?? 0n) + parsed;
    return { estimated, totalStaked, tierPct: hackathon.tierPcts[0] };
  }, [amount, stake?.shares, stake?.amount, project.totalShares, hackathon.totalPool, hackathon.tierPcts, hackathon.protocolFeeBps, hackathon.startTimestamp, hackathon.cutoffTimestamp, nowSecs]);

  const currentMultiplier = useMemo(() => {
    const start = hackathon.startTimestamp;
    const cutoff = hackathon.cutoffTimestamp;
    if (nowSecs >= cutoff) return 1.0;
    if (nowSecs <= start || cutoff <= start) return 1.5;
    const window = cutoff - start;
    const elapsed = nowSecs - start;
    return 1.5 - 0.5 * (elapsed / window);
  }, [hackathon.startTimestamp, hackathon.cutoffTimestamp]);

  async function handleStake() {
    if (!publicKey || !anchorWallet) return;
    const raw = parseTokens(amount);
    if (raw <= 0n) { setTxError("Enter a valid amount"); return; }

    const existingAmount = stake?.amount ?? 0n;
    if (existingAmount + raw > BigInt(MAX_STAKE_PER_WALLET)) {
      setTxError(`Stake would exceed the ${Number(MAX_STAKE_PER_WALLET) / 1_000_000} USDC per-wallet cap`);
      return;
    }
    if (walletBalance !== null && raw > walletBalance) {
      setTxError("Insufficient wallet balance");
      return;
    }

    if (isBuilder && hackathon.depositAmount > 0n && raw < hackathon.depositAmount) {
      setTxError(`Self-stake minimum is ${formatTokens(hackathon.depositAmount)} USDC`);
      return;
    }

    setBusy(true);
    setTxError(null);
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

      if (isBuilder) {
        await (program.methods as any)
          .selfStake(new BN(raw.toString()))
          .accounts({
            builder: publicKey,
            hackathon: hackathon.pubkey,
            project: project.pubkey,
            userStake,
            builderTokenAccount: userAta,
            escrow,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } else {
        const { whitelistEntry } = buildStakeAccounts({
          hackathon: hackathon.pubkey,
          project: project.pubkey,
          user: publicKey,
          usdcMint: hackathon.usdcMint,
          feeRecipient: hackathon.feeRecipient,
          openStaking: hackathon.openStaking,
        });

        const stakeBuilder = (program.methods as any)
          .stake(new BN(raw.toString()))
          .accounts({
            user: publicKey,
            hackathon: hackathon.pubkey,
            project: project.pubkey,
            userStake,
            userTokenAccount: userAta,
            escrow,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          });

        if (whitelistEntry) {
          stakeBuilder.remainingAccounts([
            { pubkey: whitelistEntry, isWritable: false, isSigner: false },
          ]);
        }

        await stakeBuilder.rpc();
      }

      onSuccess();
      onClose();
    } catch (e: any) {
      setTxError(e.message ?? "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnstake() {
    if (!publicKey || !anchorWallet) return;
    setBusy(true);
    setTxError(null);
    try {
      const program = getProgram(anchorWallet);
      const { userAta, feeRecipientAta, escrow, userStake } = buildStakeAccounts({
        hackathon: hackathon.pubkey,
        project: project.pubkey,
        user: publicKey,
        usdcMint: hackathon.usdcMint,
        feeRecipient: hackathon.feeRecipient,
        openStaking: hackathon.openStaking,
      });

      const unstakeIx = await (program.methods as any)
        .unstake()
        .accounts({
          user: publicKey,
          hackathon: hackathon.pubkey,
          project: project.pubkey,
          userStake,
          userTokenAccount: userAta,
          feeRecipientTokenAccount: feeRecipientAta,
          escrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          feeRecipientAta,
          hackathon.feeRecipient,
          hackathon.usdcMint,
        ),
        unstakeIx,
      );

      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, "confirmed");

      onSuccess();
      onClose();
    } catch (e: any) {
      setTxError(e.message ?? "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  const repoLabel = repoName(project.githubUrl);
  const hasStake = stake && stake.amount > 0n && !stake.isClaimed;

  return (
    <div
      className="ui-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ui-modal-card">
        <div style={{ marginBottom: "16px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", color: "var(--c-text)" }}>Manage Stake</h2>
            <p style={{ margin: "2px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>{repoLabel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-4)", fontSize: "1rem", lineHeight: 1, padding: "4px" }}
          >
            ✕
          </button>
        </div>

        {/* Current stake */}
        {hasStake && (
          <div style={{ marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "16px" }}>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-indigo-text)" }}>Your current stake</p>
            <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>
              {formatTokens(stake.amount)} <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
            </p>
          </div>
        )}

        {/* Multiplier info */}
        {nowSecs < hackathon.cutoffTimestamp && (
          <div style={{ marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "12px", fontSize: "0.875rem" }}>
            <p style={{ margin: 0, fontWeight: 600, color: "var(--c-indigo-text)" }}>
              Current stake multiplier: <span style={{ fontWeight: 900 }}>{currentMultiplier.toFixed(2)}×</span>
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-3)" }}>
              Earlier stakers earn more shares. Multiplier decays from 1.5× at open to 1.0× at cutoff.
            </p>
          </div>
        )}

        {!hasStake && (
          <div style={{ marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "16px" }}>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Total staked on project</p>
            <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>
              {formatTokens(project.totalStaked)} <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
            </p>
          </div>
        )}

        {/* Whitelist gate */}
        {publicKey && checkingWhitelist && (
          <div className="ui-skeleton" style={{ marginBottom: "16px", height: "40px" }} />
        )}

        {publicKey && !checkingWhitelist && isWhitelisted === false && (
          <div style={{ marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "16px" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--c-amber-text)" }}>Not whitelisted</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-amber-text)" }}>
              Your wallet hasn&apos;t been approved to stake in this hackathon. Contact the organiser to get whitelisted.
            </p>
          </div>
        )}

        {(!publicKey || isWhitelisted !== false) && (
          <>
            {tier1Estimate && (
              <div style={{ marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--c-emerald-border, var(--c-indigo-border))", background: "var(--c-emerald-light, var(--c-indigo-light))", padding: "12px" }}>
                <p style={{ margin: "0 0 4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
                  Est. if tier 1 alone ({tier1Estimate.tierPct}% of pool)
                </p>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "1.25rem", fontWeight: 900, color: "var(--c-text)" }}>
                    ~{formatTokens(tier1Estimate.estimated)} USDC
                  </span>
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: tier1Estimate.estimated >= tier1Estimate.totalStaked ? "var(--c-emerald-text, var(--c-indigo-text))" : "var(--c-text-4)" }}>
                    {formatRoi(tier1Estimate.estimated, tier1Estimate.totalStaked)}
                  </span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "var(--c-text-4)" }}>
                  Assumes no other projects in tier 1. Actual payout depends on competing winners.
                </p>
              </div>
            )}
            {/* Wallet cap progress bar */}
            {stake && stake.amount > 0n && (() => {
              const pct = Math.min(100, Number(stake.amount) / MAX_STAKE_PER_WALLET * 100);
              const remaining = BigInt(MAX_STAKE_PER_WALLET) - stake.amount;
              return (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>Wallet limit</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--c-text-3)" }}>
                      {formatTokens(stake.amount)} / {Number(MAX_STAKE_PER_WALLET) / 1_000_000} USDC · <span style={{ color: "var(--c-indigo-text)" }}>{formatTokens(remaining)} left</span>
                    </span>
                  </div>
                  <div className="ui-stake-bar-track">
                    <div className="ui-stake-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}

            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "6px" }}>
                <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>
                  Add stake (USDC)
                </label>
                {(!stake || stake.amount === 0n) && (
                  <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>max {Number(MAX_STAKE_PER_WALLET) / 1_000_000} USDC</span>
                )}
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
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={!publicKey || isWhitelisted === false}
                className="ui-input"
              />
            </div>

            {txError && (
              <p style={{ marginBottom: "12px", borderRadius: "8px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "12px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
                {txError}
              </p>
            )}

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={handleStake}
                disabled={busy || !publicKey || isWhitelisted === false || nowSecs >= hackathon.cutoffTimestamp}
                className="ui-btn ui-btn-indigo"
                style={{ flex: 1 }}
              >
                {busy ? "Sending…" : isBuilder ? "Self-stake" : "Stake"}
              </button>
              {hasStake && (
                <button
                  onClick={handleUnstake}
                  disabled={busy || !publicKey || !canUnstake}
                  className="ui-btn ui-btn-amber"
                  title={!canUnstake ? "Unstaking is locked (cutoff passed)" : undefined}
                >
                  Unstake all
                </button>
              )}
            </div>

            <p style={{ marginTop: "12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
              Early unstake incurs a fixed 3% exit fee (1.5% to protocol, 1.5% stays in pool).
              Unstaking is locked 24 h before results.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
