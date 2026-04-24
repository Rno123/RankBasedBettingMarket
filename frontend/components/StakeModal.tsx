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
      const whitelistEntry = whitelistPda(hackathon.pubkey, publicKey);

      await (program.methods as any)
        .stake(new BN(raw.toString()))
        .accounts({
          user: publicKey,
          hackathon: hackathon.pubkey,
          project: project.pubkey,
          userStake,
          whitelistEntry,
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center dark:bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/[0.08] dark:bg-[#0f0f1a] dark:shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">Manage Stake</h2>
            <p className="mt-0.5 text-sm text-slate-500">{repoLabel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 transition hover:text-slate-700 dark:text-slate-600 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Current stake */}
        {hasStake && (
          <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
            <p className="text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-500">Your current stake</p>
            <p className="text-2xl font-black text-indigo-700 dark:text-white">
              {formatTokens(stake.amount)} <span className="text-sm font-semibold text-slate-500">USDC</span>
            </p>
          </div>
        )}

        {/* Multiplier info */}
        {nowSecs < hackathon.cutoffTimestamp && (
          <div className="mb-4 rounded-xl border border-indigo-200/60 bg-indigo-50/60 p-3 text-sm dark:border-indigo-500/20 dark:bg-indigo-500/10">
            <p className="font-semibold text-indigo-700 dark:text-indigo-300">
              Current stake multiplier: <span className="font-black">{currentMultiplier.toFixed(2)}×</span>
            </p>
            <p className="mt-1 text-xs text-indigo-500 dark:text-indigo-400/70">
              Earlier stakers earn more shares. Multiplier decays from 1.5× at open to 1.0× at cutoff.
            </p>
          </div>
        )}

        {!hasStake && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <p className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-600">Total staked on project</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white">
              {formatTokens(project.totalStaked)} <span className="text-sm font-semibold text-slate-500">USDC</span>
            </p>
          </div>
        )}

        {/* Whitelist gate */}
        {publicKey && checkingWhitelist && (
          <div className="mb-4 h-10 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.05]" />
        )}

        {publicKey && !checkingWhitelist && isWhitelisted === false && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Not whitelisted</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Your wallet hasn't been approved to stake in this hackathon. Contact the organiser to get whitelisted.
            </p>
          </div>
        )}

        {(!publicKey || isWhitelisted !== false) && (
          <>
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-400">
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder-slate-600 dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/20"
              />
            </div>

            {txError && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
                {txError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleStake}
                disabled={busy || !publicKey || isWhitelisted === false}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-40"
              >
                {busy ? "Sending…" : "Stake"}
              </button>
              {hasStake && (
                <button
                  onClick={handleUnstake}
                  disabled={busy || !publicKey || !canUnstake}
                  className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm font-bold text-amber-400 transition hover:bg-amber-500/20 disabled:opacity-40"
                  title={!canUnstake ? "Unstaking is locked (cutoff passed)" : undefined}
                >
                  Unstake all
                </button>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-400 dark:text-slate-600">
              Early unstake incurs a fixed 3% exit fee (1.5% to protocol, 1.5% stays in pool).
              Unstaking is locked 24 h before results.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
