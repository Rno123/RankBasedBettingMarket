# HackBet — Rank-Weighted Hackathon Conviction Market

HackBet is a Solana-native protocol where participants stake USDC on hackathon projects before judging. When results are announced, the prize pool is redistributed to stakers who backed winning projects — weighted by how much was staked and how early.

It is not a prediction market. It is a conviction signal layer built on top of hackathon judging: the crowd puts money where its mouth is, and winners share the pool proportionally to the signal they attracted.

Live on devnet: **[hackbet.vercel.app](https://hackbet.vercel.app)**  
Program ID: `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`

---

## How It Works

### The Staking Window
A hackathon is created with a `results_timestamp`. Staking is open from creation until `cutoff_timestamp` (24 hours before results). After cutoff, all positions are locked — no new stakes, no unstakes.

### Time-Weighted Shares
Staking earlier earns more shares per USDC. The multiplier decays linearly from **1.5× at open** to **1.0× at cutoff**.

```
shares = amount × multiplier
multiplier = 1.5 − 0.5 × (elapsed / window)
```

This means an early backer who stakes $100 two days after launch earns more shares — and a larger slice of the payout — than someone who stakes $100 the day before cutoff.

### Payout Formula
After the admin resolves ranks and calls `finalize_resolve`, the total pool is distributed using a two-stage formula:

**Stage 1 — Tier allocation**  
The organiser configures tier percentages at hackathon creation (e.g. 55% to tier 1, 30% to tier 2, 15% to tier 3). If a tier has no ranked project, its percentage cascades proportionally to occupied tiers.

**Stage 2 — Within-tier distribution (sqrt crowding)**  
Within each tier, projects compete via sqrt crowding. A project with $10,000 staked gets `sqrt(10000) = 100` weight. A project with $1,000 staked gets `sqrt(1000) ≈ 31.6` weight. This prevents a single over-backed project from sweeping the whole tier; lightly-backed winners still get a meaningful share.

**Per-user payout (shares-weighted within project)**
```
payout = user_shares / project_total_shares × project_tier_share × total_pool
```

A protocol fee (default 1.5%) is deducted at claim time.

### Early Exit
Unstaking before cutoff incurs a fixed **3% penalty**: 1.5% goes to the fee recipient (protocol revenue), 1.5% stays in the escrow pool (benefiting remaining stakers). Unstaking is locked in the final 24 hours.

---

## Protocol Constants

| Constant | Value | Description |
|---|---|---|
| `SELL_CUTOFF_SECS` | 86,400 s | Seconds before results that staking locks |
| `UNSTAKE_PENALTY_BPS` | 300 bps | Total early-exit penalty (3%) |
| `UNSTAKE_PROTOCOL_BPS` | 150 bps | Portion routed to fee recipient (1.5%) |
| `EARLY_MULTIPLIER_BPS` | 15,000 bps | Share multiplier at open (1.5×) |
| `BASE_MULTIPLIER_BPS` | 10,000 bps | Share multiplier at cutoff (1.0×) |
| `MAX_STAKE_PER_WALLET` | 2,000,000,000 | $2,000 USDC cap per wallet per project |
| `MAX_SELF_STAKE` | 2,000,000,000 | $2,000 USDC builder self-stake cap |
| `DEFAULT_PROTOCOL_FEE_BPS` | 150 bps | Default claim fee (1.5%) |
| `DEFAULT_DEPOSIT_AMOUNT` | 10,000,000 | Default builder deposit ($10 USDC) |
| `MAX_TIERS` | 8 | Maximum number of winner tiers |

---

## Frontend

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · Anchor client · Supabase

### Pages

| Page | Description |
|---|---|
| Home | Hackathon list, project explorer, stake UI |
| Hackathon Detail | Individual hackathon view — project cards, staking, live leaderboard |
| Admin Panel | Create hackathons, whitelist wallets, approve submissions, set ranks, finalize results |
| Master Panel | View current upgrade authority, transfer or permanently revoke it |
| Dev | Development utilities |

### Key Components

**`StakeModal`**  
Opens on clicking a project. Shows current stake, current multiplier (decaying live), and stake/unstake actions. Checks the user's whitelist status on mount — shows a "Not whitelisted" notice before any transaction is attempted if the user isn't cleared.

**`Navbar`**  
Wallet connect (Phantom/Backpack/etc), dark mode toggle.

### Hooks

| Hook | Description |
|---|---|
| `useHackathons` | Fetches all `HackathonState` accounts on-chain |
| `useProjects(hackathon)` | Fetches all `ProjectAccount`s for a hackathon |
| `useUserStake(user, project)` | Fetches a single `UserStake` PDA |
| `useWhitelistStatus(hackathon, wallet)` | Checks whether a wallet has a `WhitelistedWallet` PDA |
| `useHackathonMeta(pubkey)` | Supabase — fetches off-chain name/icon/link metadata |

### Off-Chain Data (Supabase)

On-chain accounts store only what's required for the protocol. Display metadata is stored in Supabase:

| Table | Contents |
|---|---|
| `hackathon_metadata` | `official_link`, `icon_url` per hackathon pubkey |
| `project_metadata` | `twitter_handle`, `telegram`, `discord`, `github_url` per project |
| `project_submissions` | Builder registration requests (status: pending / approved / rejected) |

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (Vercel)                   │
│  Next.js 16 App Router + React 19 + Tailwind CSS v4      │
│                                                          │
│  Home     Hackathon Detail     Admin Panel  Master Panel │
└───────────────────────┬─────────────────────────────────┘
                        │ Anchor client + wallet adapter
┌───────────────────────▼─────────────────────────────────┐
│           Solana Program (Anchor 0.31.1 / Agave)         │
│                                                          │
│  HackathonState PDA   ProjectAccount PDAs                │
│  UserStake PDAs       WhitelistedWallet PDAs             │
│  Escrow token account (PDA-owned)                        │
└───────────────────────┬─────────────────────────────────┘
                        │ token::transfer (spl-token)
┌───────────────────────▼─────────────────────────────────┐
│                     USDC Escrow                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  Supabase (off-chain)                    │
│  hackathon_metadata · project_metadata                   │
│  project_submissions                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Roadmap

- [ ] On-chain milestone tracking (builder progress posts)
- [ ] Twitter/X handle verification for builder profiles
- [ ] Merkle-tree project approval (off-chain computation, on-chain proof)
- [ ] Address Lookup Tables for hackathons with >35 projects
- [ ] Mainnet USDC migration

---

## License

MIT
