import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd",
);

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export const TOKEN_DECIMALS = 6; // USDC has 6 decimals

export const MAX_STAKE_PER_WALLET = 250_000_000; // protocol cap, $250 USDC in smallest units

// USDC mint — set per environment
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

// Protocol super-admin + BPF upgrade authority
export const PROTOCOL_ADMIN = "Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD";
export const DEPLOYER = "Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD";

// Stale hackathon PDAs hidden from the frontend (e.g. recreated with wrong config).
// Each escrow is PDA-derived and isolated — these are safe to leave on-chain.
export const HIDDEN_HACKATHONS = new Set([
  "CKgWfqPwSXMWkjuycVYrVaKNMNy2YjMPWfpcBzLn6yTX",
]);
