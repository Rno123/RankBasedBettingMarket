"use client";

import { useState } from "react";
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

interface Props {
  hackathon: HackathonInfo;
  project: ProjectInfo;
  onClose: () => void;
  onSuccess: () => void;
}

export default function StakeModal({
  hackathon,
  project,
  onClose,
  onSuccess,
}: Props) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Stake</h2>
            <p className="mt-0.5 text-sm text-slate-500">{repoName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-400">Currently staked</p>
          <p className="text-2xl font-bold text-slate-900">
            {formatTokens(project.totalStaked)} USDC
          </p>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Amount (USDC)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="0.000001"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
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
          <button
            onClick={handleUnstake}
            disabled={busy || !publicKey}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Unstake
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Early unstake incurs a linear penalty up to 30%. Unstaking is locked
          24 h before results.
        </p>
      </div>
    </div>
  );
}
