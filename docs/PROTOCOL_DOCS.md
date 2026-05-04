# HackBet Protocol Documentation

> A Solana-native conviction signal market for hackathons. Back projects you believe in with capped stakes. When judges announce results, the pool is redistributed by rank, crowd conviction, and time-weighted loyalty — not by parimutuel odds.

---

## Table of Contents

1. [What is HackBet?](#what-is-hackbet)
2. [How It Works](#how-it-works)
3. [For Bettors](#for-bettors)
4. [For Builders](#for-builders)
5. [For Hackathon Organizers](#for-hackathon-organizers)
6. [Protocol Mechanics](#protocol-mechanics)
7. [Security](#security)
8. [Glossary](#glossary)

---

## What is HackBet?

HackBet is a **conviction signal market** built on Solana. Unlike prediction markets (where you bet on binary outcomes), HackBet lets you stake USDC on which hackathon projects you think will win — and your conviction is rewarded proportionally when the judges agree.

The protocol is designed around three principles:

1. **Rank-weighted distribution** — Higher-ranked projects get a larger share of the pool, but not all of it. Everyone who backed a ranked winner earns something.

2. **Crowd conviction via sqrt-crowding** — A project backed by $100,000 doesn't pay out 100x more than one backed by $1,000. The sqrt scaling rewards early conviction in underrated projects.

3. **Time-weighted loyalty** — Staking early earns you more shares per dollar (1.5x multiplier decaying to 1.0x at cutoff). This rewards conviction, not last-minute bandwagoning.

![HackBet hero illustration — a split view showing a hackathon stage on the left (projects presenting) and a conviction leaderboard on the right with staked amounts and projected payouts. The center shows a "Stake → Resolve → Claim" flow diagram.]
*Placeholder: Hero illustration — hackathon stage + conviction leaderboard + flow diagram*

---

## How It Works

### The Lifecycle of a Hackathon

![Lifecycle diagram showing four phases: 1) Open (stakers back projects, builders self-stake, time multiplier decays from 1.5x to 1.0x), 2) Cutoff (24h before results — staking locked, builders submit), 3) Pending (results announced, judges rank, admin calls resolve + finalize), 4) Resolved (winners claim payouts, builders claim deposit refunds).]
*Placeholder: Four-phase lifecycle diagram with color-coded phases*

#### Phase 1: Open Staking
- Hackathon is created on-chain by the organizer
- Builders register projects and pay a commitment deposit
- Anyone can stake USDC on projects they believe in
- Early stakers earn up to 1.5x shares multiplier
- Builders can self-stake to signal confidence

#### Phase 2: Cutoff (24h before results)
- All staking, self-staking, and unstaking is locked
- Builders must declare on-chain that they submitted
- The 24-hour dead zone prevents last-minute manipulation

#### Phase 3: Pending (results announced)
- Organizer assigns ranks to projects via `resolve()`
- Organizer calls `finalize_resolve()` to compute tier allocations
- Tier percentages are redistributed if some tiers are empty (proportional cascade)

#### Phase 4: Resolved
- Stakers on ranked projects call `claim()` to receive their payout
- Builders of approved projects call `claim_deposit_refund()` to recover their deposit
- After 14 days, unclaimed deposits of ghost builders are forfeitable

---

## For Bettors

### Staking on a Project

![Stake modal screenshot showing: amount input, current multiplier display (e.g. 1.32x), estimated payout if tier 1 winner, wallet balance, and the per-wallet cap progress bar.]
*Placeholder: Stake modal UI screenshot with annotations*

1. Connect your Solana wallet (USDC on the correct network)
2. Browse active hackathons and projects
3. Click "Stake" on a project you believe in
4. Enter your USDC amount (max $250 per wallet per project)
5. Review the multiplier and estimated payout
6. Confirm the transaction

**The 3% unstake penalty**: You can withdraw your stake at any time before the cutoff, but you'll pay a flat 3% fee (1.5% to the protocol, 1.5% stays in the pool for remaining stakers). There is no time-based decay on the penalty.

### The Multiplier

![Multiplier decay chart — x-axis: time from hackathon start to cutoff, y-axis: multiplier from 1.0 to 1.5. A straight line decays from 1.5 at t=0 to 1.0 at t=cutoff.]
*Placeholder: Line chart showing multiplier decay from 1.5x to 1.0x*

Staking early earns you more "shares" per dollar. The formula:

```
shares = amount × multiplier / 10,000

where multiplier = 15,000 - 5,000 × (elapsed / window)
```

This means:
- **Day 1 of a 30-day window**: 1.48x multiplier
- **Day 15**: 1.25x multiplier
- **Day 30 (cutoff)**: 1.00x multiplier

### How Payouts Work

Your payout depends on four factors:

1. **Your shares** — Based on how much you staked and when
2. **Tier allocation** — What % of the pool goes to the project's rank tier
3. **Sqrt-crowding** — How much total stake is on this project vs. competing projects in the same tier
4. **Protocol fee** — 1.5% deducted from your gross payout

![Payout formula diagram breaking down the four components visually with arrows and example numbers.]
*Placeholder: Visual breakdown of the payout formula with example calculation*

### Claiming Winnings

Once a hackathon is resolved:
1. Navigate to the hackathon page
2. If you backed a ranked winner, the "Claim winnings" button appears
3. Click it to receive your payout (minus 1.5% protocol fee)
4. If you backed multiple winners, use "Claim all winning picks" to batch-claim

### Parlay Mode (Top 3 Slip)

![Parlay modal showing: three project picker slots (Pick #1, #2, #3), total amount input, estimated combined payout, and the "Place 3-pick slip" button.]
*Placeholder: Parlay modal screenshot with three picks selected*

Pick up to 3 projects in a single transaction. The total amount is split equally across your picks (or weighted if you use advanced mode). Each pick maps to your projected finish order (#1, #2, #3).

---

## For Builders

### Registering Your Project

![Builder portal screenshot showing: GitHub URL input, project name field, social links, the registration message with signature prompt, and the deposit status indicator.]
*Placeholder: Builder portal — registration flow screenshot*

1. Go to `/dev` and connect your wallet
2. Enter your GitHub repo URL and project details
3. Sign the registration message with your wallet
4. If the hackathon requires a deposit, pay the commitment deposit (typically $10 USDC)
5. Your project is now eligible for crowd staking

### Self-Staking

Once your deposit is paid, you can self-stake up to $250 USDC on your own project. This:
- Signals confidence to potential backers
- Highlights your project in the UI ("Builder self-stake" badge)
- Participates in payout distribution just like any other stake

### Submitting and Claiming Your Deposit

![Deposit lifecycle diagram: Pay Deposit → Submit Project (on-chain button) → Organizer Approves → Claim Refund. Shows the 14-day window.]
*Placeholder: Builder deposit lifecycle flowchart*

1. **Before results**: Click "I've submitted!" to declare on-chain that you completed your project
2. **After results**: The organizer approves submissions off-chain
3. **Within 14 days of results**: Claim your deposit back via `claim_deposit_refund`
4. **If you don't submit**: Your deposit may be forfeited (50% to prize pool, 50% to protocol)

---

## For Hackathon Organizers

### Creating a Hackathon

![Admin panel — create hackathon form showing: name field, results timestamp picker, tier configuration (e.g. 55/25/15/5), fee recipient address, protocol fee slider, deposit amount, and the open_staking toggle.]
*Placeholder: Admin create-hackathon form with all fields filled in*

You'll need:
- **Name**: Short identifier (max 50 characters)
- **Results timestamp**: When judges announce winners
- **Tier percentages**: How the pool is split across ranks (must sum to 100, up to 8 tiers)
- **Expected counts per tier**: For display only — doesn't affect the math
- **Fee recipient**: Wallet receiving protocol fees
- **Protocol fee**: Up to 30% (3000 bps), typically 1.5%
- **Deposit amount**: Builder commitment deposit (0 = no deposit required, $10 typical)
- **Open staking**: When true, anyone can stake. When false, only whitelisted wallets can stake.

### Managing Projects

1. **Register projects**: Add projects on behalf of builders (when `requires_approval = true`)
2. **Approve submissions**: After the hackathon, verify which builders actually submitted and approve them
3. **Enable refunds**: In exceptional cases, enable refund for a specific project (must be done before resolution)

### Resolution Process

1. Call `resolve(rank)` once per project to assign judge rankings
2. Call `finalize_resolve()` with ALL project accounts to compute tier allocations and lock in results
3. After finalization, stakers can claim and builders can recover deposits

### Whitelist Management

When `open_staking = false`, only whitelisted wallets can stake. Use the admin panel to:
- Review whitelist requests (with email and wallet signature verification)
- Approve or reject requests
- Requests are global per wallet — approved wallets can stake across all whitelist-gated hackathons

---

## Protocol Mechanics

### Payout Formula (Full)

The claim payout is computed as a two-stage process:

**Stage 1 — Tier allocation**:
```
For each tier t with at least one ranked project:
  total_non_empty_bps += tier_pcts[t] * 100

For each occupied tier t:
  effective[t] = tier_pcts[t] * 1,000,000 / total_non_empty_bps
```
Empty tiers have their configured percentage redistributed proportionally among occupied tiers.

**Stage 2 — Within-tier sqrt crowding**:
```
C_i       = isqrt(project.total_staked)
C_total_t = Σ isqrt(project_j.total_staked) for all projects in tier t
           (snapshotted at finalize_resolve — cannot be manipulated by claimers)

payout = user_shares × C_i × effective[tier] × total_pool
         ─────────────────────────────────────────────────
         project.total_shares × C_total_t × 10,000
```

![Formula visualization: a Sankey-like diagram showing total_pool flowing into tier buckets (weighted by effective_tier_pcts), then within each tier flowing into project buckets (weighted by sqrt(total_staked)), then within each project flowing to individual stakers (weighted by shares).]  
*Placeholder: Sankey diagram of the two-stage payout distribution*

### Sqrt-Crowding Intuition

Without sqrt-crowding, a project with $100,000 staked would pay 100x more than one with $1,000 staked — the signal would be purely about crowd size, not conviction.

With sqrt-crowding:
- $100,000 project → C_i = 316
- $1,000 project → C_i = 31.6

The ratio is 10:1 instead of 100:1. The crowd still has more weight, but early conviction in underrated projects is rewarded.

![Comparison bar chart: "Without sqrt-crowding" shows extreme disparity between whale-backed and lightly-backed projects. "With sqrt-crowding" shows compressed but still differentiated payouts.]
*Placeholder: Side-by-side bar chart comparing payout distribution with and without sqrt-crowding*

### Constants Reference

| Constant | Value | Description |
|----------|-------|-------------|
| MAX_STAKE_PER_WALLET | $250 USDC | Per-wallet cap per project |
| MAX_SELF_STAKE | $250 USDC | Builder self-stake cap |
| UNSTAKE_PENALTY_BPS | 300 (3%) | Flat penalty on early unstake |
| UNSTAKE_PROTOCOL_BPS | 150 (1.5%) | Portion of penalty to fee recipient |
| EARLY_MULTIPLIER_BPS | 15,000 (1.5x) | Share multiplier at hackathon start |
| BASE_MULTIPLIER_BPS | 10,000 (1.0x) | Share multiplier at cutoff |
| SELL_CUTOFF_SECS | 86,400 (24h) | Staking lock before results |
| DEPOSIT_CLAIM_WINDOW_SECS | 1,209,600 (14d) | Builder refund window |
| DEFAULT_PROTOCOL_FEE_BPS | 150 (1.5%) | Fee on claim payouts |
| DEFAULT_DEPOSIT_AMOUNT | $10 USDC | Builder commitment deposit |
| MAX_TIERS | 8 | Maximum winner tiers |

---

## Security

### Audit Status

The protocol has undergone internal adversarial review. Key protections:

- **Reentrancy**: Checks-Effects-Interactions pattern on all value-transferring instructions. `is_claimed` and `deposit_refunded` flags set before CPI calls.
- **Auth**: Three-tier model — PROTOCOL_ADMIN → delegated ProtocolAdminEntry → hackathon admin. PDA derivation includes program ID preventing cross-program forgery.
- **Arithmetic**: All math uses checked operations. No floating point. Integer division dust is bounded to 1-2 raw units.
- **Frontrunning**: 24-hour dead zone between staking cutoff and resolution prevents last-minute manipulation.
- **C-01 fix**: `tier_c_totals` snapshot stored on-chain at `finalize_resolve` — callers cannot manipulate claim denominators by omitting projects.

### Attack Surface

| Vector | Status |
|--------|--------|
| Escrow drainage | Not possible — all transfers gated by PDA auth |
| Double-claim | Blocked by `is_claimed` flag (CEI pattern) |
| PDA collision | Seeds include unique identifiers (hackathon key, SHA-256 hash, wallet) |
| Sybil cap bypass | Possible by splitting across wallets (on-chain limit is per-wallet) |
| Timestamp manipulation | Mitigated by 24h buffers and 14-day windows |
| Griefing via spam registration | Costly (SOL rent per project), limited by tx size caps |

---

## Glossary

| Term | Definition |
|------|------------|
| **Conviction signal** | A stake-backed prediction of project quality, not a financial bet |
| **Shares** | Time-weighted stake units. Early stakers get more shares per dollar |
| **Sqrt-crowding** | Using sqrt(total_staked) to compress the influence of whale-backed projects |
| **Tier** | A rank group with an allocated pool percentage |
| **Proportional cascade** | Redistribution of empty-tier percentages to occupied tiers |
| **Cutoff** | 24 hours before results — all staking/unstaking locks |
| **Effective tier pct** | Final tier allocation after cascade, computed at `finalize_resolve` |
| **C_total** | Sum of sqrt(total_staked) for all projects in a tier, used as claim denominator |
| **Self-stake** | A builder staking on their own project to signal confidence |
| **Builder deposit** | Commitment deposit paid by builders to prevent spam registrations |
| **Parlay / Slip** | Multi-project stake in a single transaction |

---

*Document version: 1.0 — Last updated: May 2026*
