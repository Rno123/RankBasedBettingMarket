# RankBasedBettingMarket — Claude Code Context

## What This Is
A Solana-native hackathon betting protocol (HackBet). Users back hackathon projects with capped stakes. At resolution, the total prize pool is redistributed based on official judge ranking, time-weighted shares, and a sqrt crowding adjustment.

**This is NOT a prediction market. It is a rank-weighted, crowd-adjusted conviction pool.**

## Tech Stack
- Rust + Cargo (stable) · Anchor 0.31.x
- Solana CLI (devnet) — program deployed at `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`
- Node.js 18+ · Yarn · TypeScript
- Bankrun (for tests — preferred over solana-test-validator)
- Next.js 16 (App Router) + Tailwind CSS v4 frontend

## On-Chain Constants (authoritative — check `lib.rs` for any changes)
```
SELL_CUTOFF_SECS        = 86_400          // staking locks 24 h before results
UNSTAKE_PENALTY_BPS     = 300             // flat 3% penalty on early exit (always, no time decay)
UNSTAKE_PROTOCOL_BPS    = 150             // 1.5% to fee recipient; 1.5% stays in pool
EARLY_MULTIPLIER_BPS    = 15_000          // share multiplier at stake open (1.5×)
BASE_MULTIPLIER_BPS     = 10_000          // share multiplier at cutoff (1.0×)
MAX_STAKE_PER_WALLET    = 2_000_000_000   // $2,000 USDC per wallet per project
MAX_SELF_STAKE          = 2_000_000_000   // $2,000 USDC builder self-stake cap
DEFAULT_PROTOCOL_FEE_BPS = 150            // 1.5% deducted at claim
DEFAULT_DEPOSIT_AMOUNT  = 10_000_000      // $10 USDC builder commitment deposit
MAX_TIERS               = 8
PROTOCOL_ADMIN          = "5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP"
```

## Key Formulas

### Unstake penalty (flat, time-independent)
```
penalty     = stake × UNSTAKE_PENALTY_BPS / 10_000   // always 3%
to_protocol = stake × UNSTAKE_PROTOCOL_BPS / 10_000  // 1.5% out
stays_pool  = penalty - to_protocol                   // 1.5% in
```
There is no time-based linear decay. The 3% penalty applies from T0 to cutoff equally.

### Time-weighted shares (accrued at stake time)
```
window   = cutoff_timestamp - hackathon.start_timestamp
elapsed  = clamp(now - start_timestamp, 0, window)
mult_bps = 15_000 - floor(5_000 × elapsed / window)   // 15000→10000
shares   = floor(amount × mult_bps / 10_000)
```

### Payout formula (two-stage)
```
// Stage 1: tier allocation (set at finalize_resolve)
effective_tier_pcts[t]  // proportional cascade — empty tiers redistribute to occupied ones

// Stage 2: within-tier sqrt crowding
C_i       = isqrt(project.total_staked)
C_total_t = hackathon.tier_c_totals[tier]   // snapshotted at finalize_resolve (C-01 fix)

payout = user_shares × C_i × effective_tier_pcts[tier] × total_pool
         ──────────────────────────────────────────────────────────
         project.total_shares × C_total_t × 10_000
```
Protocol fee is deducted from payout at claim time.

## Account Structs (current — post-audit)

```rust
HackathonState {
    admin: Pubkey,
    usdc_mint: Pubkey,
    name: String,             // max 50 bytes; PDA seed
    start_timestamp: i64,
    irl_hackathon_deadline_timestamp: i64,
    cutoff_timestamp: i64,    // irl_hackathon_deadline_timestamp - 86400
    total_pool: u64,
    is_resolved: bool,
    tier_count: u8,
    tier_pcts: [u8; 8],
    effective_tier_pcts: [u16; 8],   // computed at finalize_resolve
    tier_c_totals: [u64; 8],         // C_total per tier; snapshotted at finalize_resolve
    fee_recipient: Pubkey,
    protocol_fee_bps: u16,   // capped at 3000 (30%)
    deposit_amount: u64,
    requires_approval: bool,
    bump: u8,
}

ProjectAccount {
    hackathon: Pubkey,
    github_url: String,      // max 200 chars; SHA-256 used for PDA seed
    total_staked: u64,
    total_shares: u64,
    rank: u8,                // 0 = unresolved
    builder_wallet: Pubkey,
    deposit_amount_paid: u64,
    builder_staked: u64,
    builder_declared: bool,
    submitted: bool,
    is_refund_enabled: bool,
    deposit_forfeited: bool,
    deposit_refunded: bool,
    bump: u8,
}

UserStake {
    user: Pubkey,
    project: Pubkey,
    amount: u64,
    shares: u64,
    stake_timestamp: i64,
    is_claimed: bool,
    bump: u8,
}

WhitelistedWallet { hackathon: Pubkey, wallet: Pubkey, bump: u8 }
```

## PDA Seeds
```
HackathonState : ["hackathon", admin, name]
ProjectAccount : ["project", hackathon, sha256(github_url)]   ← hash, not raw URL
UserStake      : ["stake", user, project]
Escrow         : ["escrow", hackathon]
WhitelistedWallet : ["whitelist", hackathon, wallet]
```

## Claim Architecture (C-01 fix — important)
`claim` does NOT iterate `remaining_accounts` to compute `C_total_t`.
`finalize_resolve` snapshots `tier_c_totals[t]` for each tier and stores it on `HackathonState`.
`claim` reads `hackathon.tier_c_totals[tier]` — caller-manipulation-proof.

CU results (Bankrun, post-C-01-fix, 2026-04-25):
| N projects | Claim CU |
|---|---|
| 5 | 18,111 |
| 10 | 18,111 |
| 20 | 18,111 |

Flat CU (no longer N-dependent) because `claim` no longer iterates projects.

## Audit Fixes Applied (2026-04-25)
All findings from the Codex audit have been fixed:
- **C-01**: `tier_c_totals` snapshot at `finalize_resolve`; claim uses stored value
- **C-02**: `refund` decrements `total_pool`, `total_staked`, `total_shares` (CEI)
- **H-01**: `claim_deposit_refund` rejects if `deposit_forfeited = true`
- **M-01**: `initialize_hackathon` requires `irl_hackathon_deadline_timestamp > now + SELL_CUTOFF_SECS`
- **M-02**: `protocol_fee_bps` capped at 3000

## Test Suite
```
cd hackathon-betting
anchor build -- --features testing   # testing feature swaps PROTOCOL_ADMIN → local wallet
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
# 82/82 passing
```
The `testing` Cargo feature swaps `PROTOCOL_ADMIN` to `Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD` (local `~/.config/solana/id.json`). Tests pre-fund this keypair via `startAnchor` extra accounts.

## Development Phases
- [x] Step 1 — Environment verified
- [x] Step 2 — TypeScript simulation (`simulation/payout.ts`, 43/43 assertions)
- [x] Step 3 — Anchor scaffold
- [x] Step 4 — Instructions: initialize_hackathon, register_project, stake, unstake, resolve, claim
- [x] Step 5 — Full test suite with Bankrun (82/82 passing — post-audit)
- [x] Step 6 — CU audit: 18K CU flat post C-01 fix
- [x] Step 7 — Devnet deploy: `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`
- [x] Step 8 — Next.js 16 + Tailwind frontend (`frontend/`)
- [ ] Step 9 — Mainnet deploy

## Rules
- No `f64` in on-chain math — fixed-point integer only
- Unstake penalty is FLAT 3% (not linear decay — CLAUDE.md history is stale)
- `MAX_STAKE_PER_WALLET = 2_000_000_000` (not 1B)
- ProjectAccount PDA seeds use `sha256(github_url)` — not the raw URL
- For mainnet: update `PROGRAM_ID`, `USDC_MINT`, and `RPC_URL` in `frontend/lib/constants.ts`
