# RankBasedBettingMarket — Claude Code Context

## What This Is
A Solana-native hackathon betting protocol. Users back hackathon projects with capped stakes. Positions are tradable only against the protocol before a cutoff. At resolution, the total prize pool is redistributed based on official judge ranking, amount staked per project, and a sqrt crowding adjustment, with full normalization so the entire pool is always disbursed.

**This is NOT a prediction market. It is a rank-weighted, crowd-adjusted betting pool.**

## Tech Stack
- Rust + Cargo (latest stable)
- Solana CLI (devnet)
- Anchor (latest)
- Node.js 18+
- Yarn
- Bankrun (for tests, preferred over solana-test-validator)
- TypeScript (simulation + tests)
- Devnet USDC (token for stakes)

## Mechanism Constants
```
SELL_DISCOUNT_FLOOR             = 0.70         // min 70% returned on early sell
SELL_CUTOFF_BEFORE_RESULTS      = 86400        // 24 hours in seconds
MAX_STAKE_PER_WALLET_PER_PROJECT = 1_000_000_000  // lamports / USDC smallest unit
PROTOCOL_FEE                    = 0            // 0% for MVP
JUDGE_WEIGHTS                   = { 1: 55, 2: 30, 3: 10, rest: 5 }  // out of 100
```

## Key Formulas

### Linear Decay (unstake penalty)
```
penalty_rate(t) = 0.30 × ((t_now - t_stake) / (t_cutoff - t_stake))
return_amount   = stake × (1 - penalty_rate(t))
```
- Penalty accrues from stake time to cutoff. Max 30% penalty at cutoff (70% returned).
- After cutoff: selling is impossible (hard reject).
- Penalty amount stays in pool T — benefits remaining holders at resolution.
- **Use i64 fixed-point arithmetic on-chain. No f64.**

### Payout Math
```
S_i     = total staked on project i
C_i     = sqrt(S_i)                        // crowding adjustment
J_i     = judge weight for project i rank  // 0.55, 0.30, 0.10, or split of 0.05
R_i     = J_i × C_i                        // raw payout weight
R_total = sum of all R_i
P_i     = (R_i / R_total) × T             // project i's share of total pool T

// Per user:
share_u,i  = s_u,i / S_i
payout_u,i = share_u,i × P_i
```

## Account Structs

```rust
HackathonState {
    admin: Pubkey,
    results_timestamp: i64,
    cutoff_timestamp: i64,      // results_timestamp - 86400
    total_pool: u64,
    is_resolved: bool,
    judge_weights: [u8; 4],     // [55, 30, 10, 5]
    bump: u8,
}

ProjectAccount {
    hackathon: Pubkey,
    github_url: String,         // max 200 chars
    total_staked: u64,
    rank: u8,                   // 0 = unresolved
    is_registered: bool,
    bump: u8,
}

UserStake {
    user: Pubkey,
    project: Pubkey,
    amount: u64,
    stake_timestamp: i64,
    is_claimed: bool,
    bump: u8,
}
```

## Instructions (build in this order, each must compile + pass tests before next)
1. `initialize_hackathon` — admin creates HackathonState PDA
2. `register_project` — creates ProjectAccount PDA (seed: hackathon pubkey + github_url)
3. `stake` — deposit devnet USDC to PDA-owned escrow, create/update UserStake PDA (seed: user + project)
4. `unstake` — linear decay penalty, return_amount to user, penalty stays in escrow
5. `resolve` — admin sets ranks on ProjectAccounts, sets is_resolved = true. Does NOT compute payouts.
6. `claim` — compute full payout math on-chain, transfer to user, mark is_claimed = true

## Critical Architecture Decision (TBD — Step 6)
The `claim` instruction iterates all ProjectAccounts to compute R_total. This may exceed compute unit limits at scale.

**Thresholds:**
- Run CU audit at 5 / 10 / 20 / 50 projects
- If 20 projects > 200,000 CU: snapshot R_total inside `resolve` and read it in `claim`

This is the single most important feasibility question. Flag immediately if triggered.

## Development Phases
- [x] Step 1 — Verify environment (Rust, Solana CLI, Anchor, Node)
- [ ] Step 2 — TypeScript simulation at `simulation/payout.ts` with 5 test cases
- [ ] Step 3 — Anchor program scaffold (`anchor init hackathon-betting`)
- [ ] Step 4 — Instructions 4.1–4.6 (one at a time, test before next)
- [ ] Step 5 — Full test suite with Bankrun
- [ ] Step 6 — CU audit on claim instruction
- [ ] Step 7 — Devnet deploy, record program ID

## Test Cases (from simulation — outputs become on-chain assertions)
1. All funds on winner (rank 1) — single project
2. All funds on loser (rank 4+) — single project
3. Even distribution across 5 projects ranks 1–5
4. Sybil sim: 20 wallets × 1000 vs 1 whale × 20000 — sqrt neutralizes splitting
5. Crowded 2nd vs lightly backed 1st — show per-dollar return difference

## Rules for Claude
- Do not proceed to next step until current step compiles and tests pass
- Flag any assumption that differs from spec
- Flag any Solana/Anchor constraint that required a design change
- No f64 in on-chain math — fixed-point i64 only
- After Step 6: give explicit verdict on claim instruction viability
