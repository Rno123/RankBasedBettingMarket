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

> **Quick reference:** jump straight to [Worked Examples](#worked-examples) for concrete payout calculations.

---

## What is HackBet?

HackBet is a **conviction signal market** built on Solana. Unlike prediction markets (where you bet on binary outcomes), HackBet lets you stake USDC on which hackathon projects you think will win — and your conviction is rewarded proportionally when the judges agree.

The protocol is designed around three principles:

1. **Rank-weighted distribution** — Higher-ranked projects get a larger share of the pool, but not all of it. Everyone who backed a ranked winner earns something.

2. **Per-project equal allocation** — Within a tier, every ranked project draws the same fixed bps of the pool regardless of how much total capital was staked in it. This rewards early conviction in underrated projects: a project backed by $100 and one backed by $10,000 both draw the same tier allocation, so the $100 project's backer earns far more per dollar.

3. **Time-weighted loyalty** — Staking early earns you more shares per dollar (1.5x multiplier decaying to 1.0x at cutoff). This rewards conviction, not last-minute bandwagoning.

![HackBet hero illustration — a split view showing a hackathon stage on the left (projects presenting) and a conviction leaderboard on the right with staked amounts and projected payouts. The center shows a "Stake → Resolve → Claim" flow diagram.]
*Placeholder: Hero illustration — hackathon stage + conviction leaderboard + flow diagram*

---

## How It Works

### The Lifecycle of a Hackathon

![Lifecycle diagram showing four phases: 1) Open (stakers back projects, builders self-stake, time multiplier decays from 1.5x to 1.0x), 2) Cutoff (staking locked at configurable cutoff_timestamp, builders submit), 3) Pending (results announced, judges rank, admin calls resolve + finalize), 4) Resolved (winners claim payouts, builders claim deposit refunds).]
*Placeholder: Four-phase lifecycle diagram with color-coded phases*

#### Phase 1: Open Staking
- Hackathon is created on-chain by the organizer
- Builders register projects and pay a commitment deposit
- Anyone can stake USDC on projects they believe in
- Early stakers earn up to 1.5x shares multiplier
- Builders can self-stake to signal confidence

#### Phase 2: Cutoff
- All staking, self-staking, and unstaking is locked at `cutoff_timestamp`
- Builders must declare on-chain that they submitted
- The dead zone between cutoff and results prevents last-minute manipulation

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

Your payout depends on three factors:

1. **Your shares** — Based on how much you staked and when (earlier = more shares per dollar)
2. **Tier allocation** — Each project in your tier draws a fixed bps slot; your payout is your share of that slot
3. **Protocol fee** — 1.5% deducted from your gross payout

![Payout formula diagram breaking down the three components visually with arrows and example numbers.]
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
4. **If you don't submit**: Your deposit may be forfeited after resolution (100% to protocol)

---

## For Hackathon Organizers

### Creating a Hackathon

![Admin panel — create hackathon form showing: name field, results timestamp picker, tier configuration (e.g. 55/25/15/5), fee recipient address, protocol fee slider, deposit amount, and the open_staking toggle.]
*Placeholder: Admin create-hackathon form with all fields filled in*

You'll need:
- **Name**: Short identifier (max 50 characters)
- **Results timestamp**: When judges announce winners
- **Tier percentages**: How the pool is split across tiers (must sum to 100, up to 8 tiers)
- **Expected counts per tier**: How many projects are expected in each tier. Each project draws `tier_pct / expected` of the pool. Under-filled slots cascade to occupied tiers. Set to 0 for "rest" tiers that absorb any remaining allocation.
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

### How your payout is calculated (plain English)

When you stake on a project and it wins, your payout depends on **four things**, in order:

1. **What rank did your project get?** Higher rank = bigger slice of the pool. The organizer configures this when they create the hackathon (e.g. "1st place gets 55%, 2nd gets 30%, rest split 15%").

2. **How many projects share your project's rank?** The tier's pool is split equally among every project at that rank. If 5 projects tie for 2nd place, the 2nd-place pool is divided by 5. Fewer competitors in your tier = a bigger slice for your project.

3. **How much of the project's stake do you own?** Within your project, payouts are proportional to how much you staked AND how early you staked (early stakers earn up to 1.5× more shares per dollar).

4. **The protocol fee** (typically 1.5%) is subtracted from your payout.

That's it. The formula just makes this precise.

---

### Payout Formula (Full)

The claim payout is computed in two stages, both snapshotted at `finalize_resolve`.

**Stage 1 — Tier allocation:**

The organizer sets two arrays per tier: `tier_pcts[t]` (% of pool) and `tier_expected_counts[t]` (how many projects should be in this tier).

For **named tiers** (`expected > 0`), each project in the tier draws a fixed per-project share:

```
per_project_share[t] = tier_pcts[t] / tier_expected_counts[t]
tier_allocation[t]   = per_project_share[t] × actual_project_count[t]
```

If fewer projects land in a tier than expected, the unused allocation **cascades** to other occupied tiers, weighted by how much each tier already drew. If no projects land in a tier at all, that tier gets zero.

For **rest tiers** (`expected == 0`), whatever pool percentage remains after named tiers draw is split equally among all rest-tier projects. If there are no named tiers either, the rest tiers split 100% of the pool.

The final per-tier allocation is stored as `effective_tier_pcts[t]` in basis points (0–10,000).

**Stage 2 — Your payout:**

```
N        = number of projects in your tier (snapshotted at finalize_resolve)
your_cut = your_shares × effective_tier_pcts[tier] × total_pool
           ──────────────────────────────────────────────────────
           project_total_shares × N × 10,000
```

Protocol fee is deducted at claim time:
```
fee          = payout × protocol_fee_bps / 10,000
user_receives = payout − fee
```

---

### Why backing an overlooked project pays more

Because every project in a tier gets the **same dollar allocation** regardless of how many people staked on it.

| | Project B (crowded) | Project C (overlooked) |
|--|---------------------|------------------------|
| Rank | 2nd | 2nd |
| Backers | 50 people, $80,000 total | 1 person, $100 total |
| Project's tier slice | $3,000 | $3,000 |
| Your share of project | $60 (1/50th) | $3,000 (all of it) |

Same rank. Same $3,000 flowing to each project. The overlooked project's lone backer gets 50× the return. Finding quality projects before the crowd discovers them is the entire game.

![Formula visualization: a Sankey-like diagram showing total_pool flowing into tier buckets, then within each tier splitting equally among N project buckets, then within each project flowing to individual stakers weighted by shares.]
*Placeholder: Sankey diagram of the two-stage payout distribution*

---

### Worked Examples

All examples use a 30-day hackathon window and 1.5% protocol fee. `effective_tier_pcts` are in basis points (0–10,000).

---

#### Example 1 — Early stake beats late stake (same winner, different returns)

Pool = $2,000. Winner-take-all (1 tier, 100%, 1 project expected).

| | Stake | Day | Multiplier | Shares |
|--|-------|-----|------------|--------|
| Alice | $1,000 | 0 | 1.50× | 1,500 |
| Bob | $1,000 | 25 | 1.08× | 1,083 |

Total shares = 2,583. Effective tier 0 = 10,000 bps. N = 1.

```
Alice payout = 1,500 × 10,000 × 2,000 / (2,583 × 1 × 10,000)
             = $1,161 pre-fee → $1,143 net (+14.3%)
Bob payout   = 1,083 × 10,000 × 2,000 / (2,583 × 1 × 10,000)
             = $839 pre-fee → $826 net (−17.4%)
```

Both backed the winner. Alice gets 58% of the pool with 50% of the capital because she staked 25 days earlier. Bob loses money despite picking correctly — late conviction is penalized by the time-weight multiplier.

---

#### Example 2 — Overlooked project earns 30× more per dollar

Pool = $20,000. Two tiers: 1st = 70% (1 expected), 2nd = 30% (2 expected). All tiers filled. Everyone stakes Day 0 (1.5×).

| Project | Rank | Backer | Stake | Shares |
|---------|------|--------|-------|--------|
| A | 1st | Alice | $10,000 | 15,000 |
| B | 2nd | Bob | $100 | 150 |
| C | 2nd | Carol | $10,000 | 15,000 |

Per-project for tier 1 = 30% / 2 = 15% each. Both projects get $3,000.

```
Alice: 15,000 × 7,000 × 20,000 / (15,000 × 1 × 10,000) = $14,000 → $13,790 net (+38%)
Bob:      150 × 3,000 × 20,000 / (   150 × 2 × 10,000) =  $3,000 →  $2,955 net (+2,855%)
Carol:  15,000 × 3,000 × 20,000 / (15,000 × 2 × 10,000) =  $3,000 →  $2,955 net (−71%)
```

Bob's $100 earns the same dollars as Carol's $10,000. The per-project allocation is fixed — total capital has zero effect on how much a project receives from the tier.

---

#### Example 3 — Under-filled tier cascades to remaining tiers

Pool = $9,000. Three tiers: [60%, 30%, 10%], each expects 1 project. Rank 3 never submitted — tier 2 is completely empty.

**First pass (per-project draws):**

| Tier | Per-slot | Actual | Drawn |
|------|----------|--------|-------|
| 0 | 6,000 bps | 1 project | 6,000 |
| 1 | 3,000 bps | 1 project | 3,000 |
| 2 | 1,000 bps | 0 projects | 0 |

Drawn = 9,000 bps, remaining = 1,000 bps.

**Cascade:** The unused 1,000 bps is redistributed proportionally to what each tier drew (6:3 ratio):

```
Tier 0 gets 666 bps, tier 1 gets 334 bps
Final effective: [6,666, 3,334, 0]
```

Alice staked $3,000 on the 1st-place project. Bob staked $6,000 on the 2nd-place project.

```
Alice: 6,666 bps → $5,999 pre-fee → $5,909 net (+97%)
Bob:   3,334 bps → $3,001 pre-fee → $2,956 net (−51%)
```

Without cascade Alice would have gotten $5,400. The empty tier 2's allocation redistributes toward the occupied tiers — and since tier 0 drew twice as much as tier 1, it gets twice as much of the cascade.

---

#### Example 4 — Early exit with the 3% penalty

Pool ends at $15,075. Winner-take-all (100%, 1 expected). Alice stakes $10,000 Day 0 and holds. Bob stakes $5,000 Day 0 but unstakes before cutoff. Carol stakes $5,000 on Day 20 and holds.

**Bob's unstake:** 3% penalty = $150. $75 goes to protocol, $75 stays in the pool for remaining backers. Bob walks away with $4,850 (−3%).

**Carol's shares:** Day 20 multiplier = 1.17× → 5,833 shares.

At resolution: Alice has 15,000 shares, Carol has 5,833. Total = 20,833.

```
Alice: 15,000 / 20,833 × $15,075 = $10,854 → $10,691 net (+7%)
Carol:  5,833 / 20,833 × $15,075 =  $4,221 →  $4,158 net (−17%)
Bob:    exited for $4,850 (−3%)
```

Bob's 3% exit was rational for his uncertainty level. The $75 pool penalty he left behind is a small bonus distributed to Alice and Carol proportional to their shares.

### Constants Reference

| Constant | Value | Description |
|----------|-------|-------------|
| MAX_STAKE_PER_WALLET | $250 USDC | Per-wallet cap per project |
| MAX_SELF_STAKE | $250 USDC | Builder self-stake cap |
| UNSTAKE_PENALTY_BPS | 300 (3%) | Flat penalty on early unstake (no time decay) |
| UNSTAKE_PROTOCOL_BPS | 150 (1.5%) | Portion of penalty sent to fee recipient; remainder stays in pool |
| EARLY_MULTIPLIER_BPS | 15,000 (1.5×) | Share multiplier at hackathon start |
| BASE_MULTIPLIER_BPS | 10,000 (1.0×) | Share multiplier at cutoff |
| cutoff_secs (per-hackathon) | 0–86,400 | Seconds before results that staking locks. 0 = no early cutoff (multiplier decays over full hackathon duration). Set by organizer at creation; max 24 h. |
| DEFAULT_PROTOCOL_FEE_BPS | 150 (1.5%) | Fee deducted from claim payouts |
| DEFAULT_DEPOSIT_AMOUNT | $10 USDC | Builder commitment deposit |
| MAX_TIERS | 8 | Maximum winner tiers |
| TIER_BPS_TOTAL | 10,000 | Total basis points across all tiers (= 100%) |

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
| **Shares** | Time-weighted stake units. Early stakers earn more shares per dollar staked |
| **Tier** | A rank group with a configured pool percentage and expected project count |
| **Per-project slot** | Each expected project in a named tier draws `tier_pct × 100 / expected` bps of the pool, regardless of how much was staked in it |
| **Named tier** | A tier with `tier_expected_counts > 0`; each slot draws a fixed per-project bps |
| **Rest tier** | A tier with `tier_expected_counts = 0`; collects whatever pool % remains after named tiers draw |
| **Per-project cascade** | When a named tier has fewer ranked projects than expected, the unused slots' bps redistributes to occupied tiers proportionally to their drawn amounts |
| **effective_tier_pcts** | Final per-tier bps allocation (0–10,000) after cascade, stored at `finalize_resolve` |
| **tier_c_totals** | Actual project count per tier, snapshotted at `finalize_resolve`; used as N in the claim formula |
| **Cutoff** | The `cutoff_timestamp` set by the organizer — all staking/unstaking locks at this point. Configurable 0–24 h before results; `cutoff_secs=0` means the multiplier decays over the full hackathon duration and cutoff equals the results deadline. |
| **Self-stake** | A builder staking on their own project to signal confidence |
| **Builder deposit** | Commitment deposit paid by builders to prevent spam registrations |
| **Parlay / Slip** | Multi-project stake in a single transaction |

---

*Document version: 1.2 — Last updated: May 2026*
