import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd",
);

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

export const TOKEN_DECIMALS = 6; // USDC has 6 decimals

export const MAX_STAKE_PER_WALLET = 250_000_000; // protocol cap, $250 USDC in smallest units

// Devnet USDC mint — hardcoded for MVP
export const USDC_MINT = new PublicKey(
  "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
);

// Hardcoded super-admin (controls Anchor program-layer instructions)
export const PROTOCOL_ADMIN = "5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP";

// BPF upgrade authority — controls bytecode; can access Admin + Master panels
export const DEPLOYER = "Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD";
