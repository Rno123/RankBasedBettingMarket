"use client";

import { useState } from "react";
import { SystemProgram, Transaction } from "@solana/web3.js";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { getProgram } from "@/lib/program";
import { escrowPda, stakePda } from "@/lib/pda";
import { formatTokens } from "@/lib/format";
import type { HackathonInfo } from "@/hooks/useHackathons";
import type { ProjectInfo } from "@/hooks/useProjects";
import type { UserStakeInfo } from "@/hooks/useUserStake";

interface Props {
  hackathon: HackathonInfo;
  claimableProjects: ProjectInfo[];
  stakesByProject: Record<string, UserStakeInfo | null>;
  onSuccess: () => void;
}

export default function ClaimSlipButton({
  hackathon,
  claimableProjects,
  stakesByProject,
  onSuccess,
}: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (claimableProjects.length === 0) return null;

  const totalClaimableStake = claimableProjects.reduce((sum, project) => {
    const stake = stakesByProject[project.pubkey.toBase58()];
    return sum + (stake?.amount ?? 0n);
  }, 0n);

  async function handleClaimAll() {
    if (!publicKey || !anchorWallet) return;
    setBusy(true);
    setErr(null);

    try {
      const program = getProgram(anchorWallet);
      const userAta = getAssociatedTokenAddressSync(hackathon.usdcMint, publicKey);
      const feeRecipientAta = getAssociatedTokenAddressSync(
        hackathon.usdcMint,
        hackathon.feeRecipient,
      );
      const escrow = escrowPda(hackathon.pubkey);

      const ixs = await Promise.all(
        claimableProjects.map((project) => (
          (program.methods as any)
            .claim()
            .accounts({
              user: publicKey,
              hackathon: hackathon.pubkey,
              project: project.pubkey,
              userStake: stakePda(publicKey, project.pubkey),
              userTokenAccount: userAta,
              feeRecipientTokenAccount: feeRecipientAta,
              escrow,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        )),
      );

      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          feeRecipientAta,
          hackathon.feeRecipient,
          hackathon.usdcMint,
        ),
        ...ixs,
      );
      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, "confirmed");
      onSuccess();
    } catch (e: any) {
      setErr(e.message ?? "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-card" style={{ marginBottom: "16px", padding: "18px" }}>
      <div className="mobile-stack-between" style={{ gap: "14px" }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-emerald-text)" }}>
            Claim all picks
          </p>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 900, color: "var(--c-text)" }}>
            {claimableProjects.length} winning pick{claimableProjects.length === 1 ? "" : "s"} ready
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
            Claim every resolved winning stake in one wallet prompt.
          </p>
        </div>
        <div style={{ minWidth: 0, textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            Stake represented
          </p>
          <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 900, color: "var(--c-text)" }}>
            {formatTokens(totalClaimableStake)} <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
          </p>
        </div>
      </div>

      <div style={{ marginTop: "14px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {claimableProjects.map((project) => (
          <span
            key={project.pubkey.toBase58()}
            style={{ borderRadius: "9999px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "4px 10px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-emerald-text)" }}
          >
            #{project.rank}
          </span>
        ))}
      </div>

      <div style={{ marginTop: "16px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={handleClaimAll}
          disabled={busy || !publicKey}
          className="ui-btn ui-btn-emerald mobile-fill"
        >
          {busy ? "Claiming..." : "Claim all winning picks"}
        </button>
        {!publicKey && (
          <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
            Connect your wallet to claim.
          </span>
        )}
      </div>

      {err && (
        <p style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "var(--c-red-text)" }}>
          {err}
        </p>
      )}
    </div>
  );
}
