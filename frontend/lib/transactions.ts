import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { escrowPda, stakePda, whitelistPda } from "@/lib/pda";

export interface StakeAccounts {
  userAta: PublicKey;
  escrow: PublicKey;
  userStake: PublicKey;
  feeRecipientAta: PublicKey;
  whitelistEntry: PublicKey | null;
}

/**
 * Derives all token account and PDA addresses needed for a single-project
 * stake / unstake / refund / claim transaction. Multi-project flows (parlay,
 * claim-slip) should call this per project.
 */
export function buildStakeAccounts(params: {
  hackathon: PublicKey;
  project: PublicKey;
  user: PublicKey;
  usdcMint: PublicKey;
  feeRecipient: PublicKey;
  openStaking: boolean;
}): StakeAccounts {
  return {
    userAta: getAssociatedTokenAddressSync(params.usdcMint, params.user),
    escrow: escrowPda(params.hackathon),
    userStake: stakePda(params.user, params.project),
    feeRecipientAta: getAssociatedTokenAddressSync(
      params.usdcMint,
      params.feeRecipient,
    ),
    whitelistEntry: params.openStaking
      ? null
      : whitelistPda(params.hackathon, params.user),
  };
}
