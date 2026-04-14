"use client";

import { useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getProgram } from "@/lib/program";
import { escrowPda, stakePda } from "@/lib/pda";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";

interface Props {
  hackathon: HackathonInfo;
  project: ProjectInfo;
  allProjects: ProjectInfo[];
  onSuccess: () => void;
}

export default function ClaimButton({
  hackathon,
  project,
  allProjects,
  onSuccess,
}: Props) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClaim() {
    if (!publicKey || !anchorWallet) return;
    setBusy(true);
    setErr(null);
    try {
      const program = getProgram(anchorWallet);
      const userAta = getAssociatedTokenAddressSync(
        hackathon.usdcMint,
        publicKey,
      );
      const escrow = escrowPda(hackathon.pubkey);
      const userStake = stakePda(publicKey, project.pubkey);

      await (program.methods as any)
        .claim()
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
        .remainingAccounts(
          allProjects.map((p) => ({
            pubkey: p.pubkey,
            isWritable: false,
            isSigner: false,
          })),
        )
        .rpc();

      onSuccess();
    } catch (e: any) {
      setErr(e.message ?? "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClaim}
        disabled={busy || !publicKey}
        className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Claiming…" : "Claim payout"}
      </button>
      {err && <p className="mt-1.5 text-xs text-red-500">{err}</p>}
    </div>
  );
}
