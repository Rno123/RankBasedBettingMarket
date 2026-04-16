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
import { escrowPda, stakePda } from "@/lib/pda";
import { parseTokens, formatTokens } from "@/lib/format";
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

  // Compute estimated unstake return (client-side, approximate)
  const unstakePreview = useMemo(() => {
    if (!stake || stake.amount === 0n) return null;
    const nowSecs = Math.floor(Date.now() / 1000);
    const t0 = stake.stakeTimestamp;
    const tCutoff = hackathon.cutoffTimestamp;
    if (nowSecs >= tCutoff) return null; // cutoff passed, unstake locked
    const elapsed = Math.max(0, nowSecs - t0);
    const totalPeriod = Math.max(1, tCutoff - t0);
    // penaltyBps ∈ [0, 3000]
    const penaltyBps = Math.min(3000, Math.floor(3000 * elapsed / totalPeriod));
    const penaltyRaw = (stake.amount * BigInt(penaltyBps)) / 10000n;
    const returnRaw = stake.amount - penaltyRaw;
    return { returnRaw, penaltyBps };
  }, [stake, hackathon.cutoffTimestamp]);

  async function handleStake() {
    if (!publicKey || !anchorWallet) return;
    const raw = parseTokens(amount);
    if (raw <= 0n) { setTxError("Enter a valid amount"); return; }

    setBusy(true);
    setTxError(null);
    try {
      const program = getProgram(anchorWallet);
      const userAta = getAssociatedTokenAddressSync(
        hackathon.usdcMint,
        publicKey,
      );
      const escrow = escrowPda(hackathon.pubkey);
      const userStake = stakePda(publicKey, project.pubkey);

      await (program.methods as any)
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

  async function handleUnstake() {
    if (!publicKey || !anchorWallet) return;
    setBusy(true);
    setTxError(null);
    try {
      const program = getProgram(anchorWallet);
      const userAta = getAssociatedTokenAddressSync(
        hackathon.usdcMint,
        publicKey,
      );
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

  const repoName = project.githubUrl.replace("https://github.com/", "");
  const hasStake = stake && stake.amount > 0n;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Manage Stake</h2>
            <p className="mt-0.5 text-sm text-slate-500">{repoName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {/* Current stake */}
        {hasStake && (
          <div className="mb-4 rounded-xl bg-indigo-50 p-4">
            <p className="text-xs text-indigo-400">Your current stake</p>
            <p className="text-2xl font-bold text-indigo-700">
              {formatTokens(stake.amount)} USDC
            </p>
          </div>
        )}

        {/* Unstake preview */}
        {unstakePreview && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-800">Unstake estimate</p>
            <p className="mt-1 text-amber-700">
              You'll receive approximately{" "}
              <span className="font-bold">
                {formatTokens(unstakePreview.returnRaw)} USDC
              </span>{" "}
              after a{" "}
              <span className="font-bold">
                {(unstakePreview.penaltyBps / 100).toFixed(1)}%
              </span>{" "}
              early-exit penalty.
            </p>
            <p className="mt-1 text-xs text-amber-600">
              Penalty increases linearly up to 30% at cutoff.
            </p>
          </div>
        )}

        {!hasStake && (
          <div className="mb-4 rounded-xl bg-slate-50 p-4">
            <p className="text-xs text-slate-400">Total staked on project</p>
            <p className="text-2xl font-bold text-slate-900">
              {formatTokens(project.totalStaked)} USDC
            </p>
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Add stake (USDC)
          </label>
          <input
            type="number"
            min="0"
            step="0.000001"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {txError && (
          <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {txError}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleStake}
            disabled={busy || !publicKey}
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Stake"}
          </button>
          {hasStake && (
            <button
              onClick={handleUnstake}
              disabled={busy || !publicKey || !unstakePreview}
              className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
              title={!unstakePreview ? "Unstaking is locked (cutoff passed)" : undefined}
            >
              Unstake all
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Early unstake incurs a linear penalty up to 30%. Unstaking is locked
          24 h before results. USDC returns to your wallet after the transaction confirms.
        </p>
      </div>
    </div>
  );
}
