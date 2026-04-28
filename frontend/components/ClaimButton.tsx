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
      const feeRecipientAta = getAssociatedTokenAddressSync(
        hackathon.usdcMint,
        hackathon.feeRecipient,
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
          feeRecipientTokenAccount: feeRecipientAta,
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
        className="ui-btn ui-btn-emerald"
        style={{ width: "100%", padding: "10px 16px", fontSize: "0.875rem" }}
      >
        {busy ? "Claiming…" : "Claim winnings"}
      </button>
      {err && <p style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>{err}</p>}
    </div>
  );
}
