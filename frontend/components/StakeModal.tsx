"use client";

import { useState, useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { getProgram } from "@/lib/program";
import { escrowPda, stakePda, whitelistPda } from "@/lib/pda";
import { parseTokens, formatTokens } from "@/lib/format";
import { useWhitelistStatus } from "@/hooks/useWhitelistStatus";
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
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const { isWhitelisted, loading: checkingWhitelist } = useWhitelistStatus(
    hackathon.pubkey,
    publicKey,
    hackathon.openStaking,
  );

  const nowSecs = Math.floor(Date.now() / 1000);
  const canUnstake = !!stake && stake.amount > 0n && nowSecs < hackathon.cutoffTimestamp;

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

    setBusy(true);
    setTxError(null);
    try {
      const program = getProgram(anchorWallet);
      const userAta = getAssociatedTokenAddressSync(hackathon.usdcMint, publicKey);
      const escrow = escrowPda(hackathon.pubkey);
      const userStake = stakePda(publicKey, project.pubkey);

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

      // When open_staking is false, pass the whitelist PDA as a remaining account
      // so the program can verify membership.
      if (!hackathon.openStaking) {
        const whitelistEntry = whitelistPda(hackathon.pubkey, publicKey);
        stakeBuilder.remainingAccounts([
          { pubkey: whitelistEntry, isWritable: false, isSigner: false },
        ]);
      }

      await stakeBuilder.rpc();

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
      const userAta = getAssociatedTokenAddressSync(hackathon.usdcMint, publicKey);
      const feeRecipientAta = getAssociatedTokenAddressSync(hackathon.usdcMint, hackathon.feeRecipient);
      const escrow = escrowPda(hackathon.pubkey);
      const userStake = stakePda(publicKey, project.pubkey);

      await (program.methods as any)
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
        .rpc();

      onSuccess();
      onClose();
    } catch (e: any) {
      setTxError(e.message ?? "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  const repoLabel = project.githubUrl.replace("https://github.com/", "");
  const hasStake = stake && stake.amount > 0n;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.5)", padding: "16px", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: "100%", maxWidth: "28rem", borderRadius: "16px", border: "1px solid var(--card-border)", background: "var(--card-bg)", padding: "24px", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
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
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>
                Add stake (USDC)
              </label>
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
                disabled={busy || !publicKey || isWhitelisted === false}
                className="ui-btn ui-btn-indigo"
                style={{ flex: 1 }}
              >
                {busy ? "Sending…" : "Stake"}
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
