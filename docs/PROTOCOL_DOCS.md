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
4. **If you don't submit**: Your deposit may be forfeited (50% to prize pool, 50% to protocol)

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

### Payout Formula (Full)

The claim payout is computed as a two-stage process, both stages snapshotted at `finalize_resolve`.

**Stage 1 — Per-project tier allocation (named tiers)**:

Each named tier defines `tier_pcts[t]` (percentage) and `tier_expected_counts[t]` (expected project count). At `finalize_resolve`:

```
per_project_bps[t] = tier_pcts[t] × 100 / tier_expected_counts[t]
drawn_bps[t]       = per_project_bps[t] × actual_project_count[t]
effective[t]       = drawn_bps[t]   (stored as u16 basis points)
```

Under-filled tiers draw fewer bps than their configured percentage; the remainder cascades to occupied tiers proportionally to their already-drawn amounts:

```
remaining = 10,000 − Σ drawn_bps[t]

for each occupied named tier t (last one gets the dust):
  effective[t] += remaining × drawn_bps[t] / Σ drawn_bps
```

"Rest" tiers (`tier_expected_counts[t] = 0`) collect whatever bps remain after named tiers draw, split proportionally by their `tier_pcts`.

**Stage 2 — Within-project share split**:

```
N = tier_c_totals[tier]   (actual project count in tier, snapshotted at finalize_resolve)

payout = user_shares × effective[tier] × total_pool
         ─────────────────────────────────────────────
         project.total_shares × N × 10,000
```

Protocol fee deducted at claim:
```
fee          = payout × protocol_fee_bps / 10,000
user_receives = payout − fee
```

![Formula visualization: a Sankey-like diagram showing total_pool flowing into tier buckets (weighted by effective_tier_pcts), then within each tier splitting equally among N project buckets, then within each project flowing to individual stakers weighted by shares.]
*Placeholder: Sankey diagram of the two-stage payout distribution*

### Per-Project Equal-Split Intuition

Within a tier, every project draws the same fixed bps (`effective[t] / N`). The total capital backing a project does not affect its tier allocation — only the number of projects in the tier (`N`) matters for the project's slot size.

Consequence: backing a project with fewer total stakers earns a higher per-dollar return, even compared to an equally-ranked project in the same tier.

| | Project B | Project C |
|--|-----------|-----------|
| Tier | 1 (both N=2) | 1 (both N=2) |
| Total staked | $100 | $10,000 |
| Tier allocation | 1,500 bps of pool | 1,500 bps of pool |
| Payout (same pool) | **same dollars** | **same dollars** |
| Per-dollar return | **+2,855%** | **−70.5%** |

The equal-split mechanism converts the problem from "pick the winner" to "pick the winner that the crowd underrated."

### Worked Examples

The following examples use `effective_tier_pcts` in basis points (0–10,000), `tier_c_totals` as the project count N, and a 30-day hackathon window. Protocol fee is 1.5%.

---

#### Example 1 — Time-weighted shares: same USDC, same winning project, different returns

**Setup:** winner-take-all (1 tier, 100%, expected=1). Pool = 2,000 USDC.

| Staker | Stake | Day | `mult_bps` | Shares |
|--------|-------|-----|------------|--------|
| Alice | 1,000 | 0 | `15,000 − ⌊5,000×0/30⌋ = 15,000` | 1,500 |
| Bob | 1,000 | 25 | `15,000 − ⌊5,000×25/30⌋ = 10,834` | 1,083 |

`total_shares = 2,583`, `effective[0] = 10,000`, N = 1

```
Alice: 1,500 × 10,000 × 2,000 / (2,583 × 1 × 10,000) = 1,161 USDC pre-fee → 1,143 net  (+14.3%)
Bob:   1,083 × 10,000 × 2,000 / (2,583 × 1 × 10,000) =   839 USDC pre-fee →   826 net  (−17.4%)
```

Both backed the winner. Alice captures 58.1% of the pool on 50% of the capital because she staked 25 days earlier. Bob nets negative on a winning bet — his late entry cost him the early-conviction premium.

---

#### Example 2 — Per-project equal split: lightly-backed project earns the same as heavily-backed

**Setup:** 2 tiers, `tier_pcts=[70, 30]`, `tier_expected_counts=[1, 2]`. All tiers fully filled (no cascade). Pool = 20,000 USDC. All stake Day 0 (1.5× mult).

| Project | Rank → Tier | Staker | Stake | `total_shares` |
|---------|-------------|--------|-------|----------------|
| A | 1 → tier 0 (N=1) | Alice | 10,000 | 15,000 |
| B | 2 → tier 1 (N=2) | Bob | 100 | 150 |
| C | 3 → tier 1 (N=2) | Carol | 10,000 | 15,000 |

`effective[0] = 7,000`, `effective[1] = 3,000` (= 2 × 1,500 per-slot)

```
Alice: 15,000 × 7,000 × 20,000 / (15,000 × 1 × 10,000) = 14,000 pre-fee → 13,790 net (+37.9%)
Bob:      150 × 3,000 × 20,000 / (   150 × 2 × 10,000) =  3,000 pre-fee →  2,955 net (+2,855%)
Carol:  15,000 × 3,000 × 20,000 / (15,000 × 2 × 10,000) =  3,000 pre-fee →  2,955 net  (−70.5%)
```

Bob and Carol both backed tier-1 projects with the same rank. Each project draws 1,500 bps (= $3,000) regardless of how much was staked in it. Bob's $100 earns the same dollars as Carol's $10,000 because the per-project allocation is fixed.

---

#### Example 3 — Named tier cascade: one expected slot goes unfilled

**Setup:** 3 tiers, `tier_pcts=[60, 30, 10]`, `tier_expected_counts=[1, 1, 1]`. Rank 3 didn't submit — tier 2 is empty. Pool = 9,000 USDC. All stake Day 0.

**First pass:**

| Tier | per-slot bps | actual | drawn bps |
|------|-------------|--------|-----------|
| 0 | 6,000 | 1 | 6,000 |
| 1 | 3,000 | 1 | 3,000 |
| 2 | 1,000 | 0 | 0 (skipped) |

`drawn_bps = 9,000`, `remaining = 1,000`

**Cascade** (proportional to drawn: 6,000 vs 3,000):
```
Tier 0 additional: ⌊1,000 × 6,000/9,000⌋ = 666 bps
Tier 1 additional: 1,000 − 666             = 334 bps  (remainder to last)
→ effective = [6,666, 3,334, 0]
```

Stakes: Alice 3,000 USDC in Project A (sole staker); Bob 6,000 USDC in Project B (sole staker).

```
Alice: 6,666/10,000 × 9,000 = 5,999 pre-fee → 5,909 net  (+96.9% on 3,000 staked)
Bob:   3,334/10,000 × 9,000 = 3,001 pre-fee → 2,956 net  (−50.7% on 6,000 staked)
```

Without cascade Alice would have received `6,000/10,000 × 9,000 = 5,400` USDC. The missing slot's 1,000 bps (= $900) redistributes 2:1 toward tier 0 — higher-ranked tiers absorb more of the cascade because they drew more bps in the first pass.

---

#### Example 4 — Early unstake: flat 3% penalty reshapes the pool

**Setup:** winner-take-all (100%, expected=1). One project wins. Protocol fee 1.5%.

| Staker | Amount | Day | Action |
|--------|--------|-----|--------|
| Alice | 10,000 | 0 | holds |
| Bob | 5,000 | 0 | **unstakes** before cutoff |
| Carol | 5,000 | 20 | holds |

**Bob's unstake math:**
```
penalty total  = 5,000 × 300/10,000 = 150 USDC
→ to protocol  = 5,000 × 150/10,000 =  75 USDC  (leaves escrow)
→ stays in pool= 150 − 75           =  75 USDC
Bob receives:  5,000 − 150          = 4,850 USDC
```

Bob's 7,500 shares are removed from the project.

Carol's shares: `mult = 15,000 − ⌊5,000×20/30⌋ = 11,667` → `⌊5,000×11,667/10,000⌋ = 5,833`

**Pool at resolution:** `10,000 + 75 + 5,000 = 15,075 USDC`
`total_shares = 15,000 (Alice) + 5,833 (Carol) = 20,833`

```
Alice: 15,000 × 10,000 × 15,075 / (20,833 × 1 × 10,000) = 10,854 pre-fee → 10,691 net  (+6.9%)
Carol:  5,833 × 10,000 × 15,075 / (20,833 × 1 × 10,000) =  4,221 pre-fee →  4,158 net  (−16.8%)
Bob:    exited for 4,850 USDC                                                             (−3.0%)
```

Had Bob stayed and the project still won, he would have received ≈ $3,900 net (−22%). Exiting at −3% was economically rational given his uncertainty — but the 75 USDC penalty that stayed in the pool is a small gift to Alice and Carol, earned proportionally to their shares.

### Constants Reference

| Constant | Value | Description |
|----------|-------|-------------|
| MAX_STAKE_PER_WALLET | $250 USDC | Per-wallet cap per project |
| MAX_SELF_STAKE | $250 USDC | Builder self-stake cap |
| UNSTAKE_PENALTY_BPS | 300 (3%) | Flat penalty on early unstake (no time decay) |
| UNSTAKE_PROTOCOL_BPS | 150 (1.5%) | Portion of penalty sent to fee recipient; remainder stays in pool |
| EARLY_MULTIPLIER_BPS | 15,000 (1.5×) | Share multiplier at hackathon start |
| BASE_MULTIPLIER_BPS | 10,000 (1.0×) | Share multiplier at cutoff |
| SELL_CUTOFF_SECS | 86,400 (24 h) | Staking lock before results |
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
| **Cutoff** | 24 hours before results — all staking/unstaking locks |
| **Self-stake** | A builder staking on their own project to signal confidence |
| **Builder deposit** | Commitment deposit paid by builders to prevent spam registrations |
| **Parlay / Slip** | Multi-project stake in a single transaction |

---

*Document version: 1.1 — Last updated: May 2026*
