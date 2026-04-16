import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd",
);

export const RPC_URL = "https://api.devnet.solana.com";

export const TOKEN_DECIMALS = 6; // USDC has 6 decimals

export const MAX_STAKE_PER_WALLET = 1_000_000_000; // protocol cap, in smallest units

// Devnet USDC mint — hardcoded for MVP
export const USDC_MINT = new PublicKey(
  "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
);

// Only this wallet can create hackathons (enforced on-chain after redeploy)
export const PROTOCOL_ADMIN = "5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP";
