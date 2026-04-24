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

## On-Chain Program

**Network:** Solana Devnet  
**Program ID:** `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`  
**Framework:** Anchor 0.31.1 / solana-program 2.3.0 (Agave)

### Account Types

#### `HackathonState`
Created once per hackathon. Stores all configuration and state.

| Field | Type | Description |
|---|---|---|
| `admin` | Pubkey | Wallet that created the hackathon (always PROTOCOL_ADMIN) |
| `usdc_mint` | Pubkey | The USDC mint for this hackathon |
| `name` | String | Hackathon name (max 50 bytes), used as PDA seed |
| `start_timestamp` | i64 | Unix timestamp when hackathon was created |
| `results_timestamp` | i64 | Unix timestamp of judging results |
| `cutoff_timestamp` | i64 | `results_timestamp − 86400` — staking locks here |
| `total_pool` | u64 | Total USDC currently in the prize pool |
| `is_resolved` | bool | True after `finalize_resolve` is called |
| `tier_count` | u8 | Number of winner tiers |
| `tier_pcts` | [u8; 8] | Configured pool % per tier (sum = 100) |
| `effective_tier_pcts` | [u16; 8] | Computed at finalize, basis points (sum = 10,000) |
| `fee_recipient` | Pubkey | Wallet receiving protocol fees |
| `protocol_fee_bps` | u16 | Claim fee in basis points |
| `deposit_amount` | u64 | Required builder deposit (0 = none) |
| `requires_approval` | bool | Whether organiser must approve submissions |

PDA seeds: `["hackathon", admin, name]`

#### `ProjectAccount`
One per project registered in a hackathon.

| Field | Type | Description |
|---|---|---|
| `hackathon` | Pubkey | Parent hackathon |
| `github_url` | String | GitHub repo URL (max 200 chars), hashed for PDA seed |
| `total_staked` | u64 | Total USDC staked on this project |
| `total_shares` | u64 | Total time-weighted shares accumulated |
| `rank` | u8 | Judge rank (0 = unranked) |
| `builder_wallet` | Pubkey | Wallet that registered the project |
| `deposit_amount_paid` | u64 | USDC paid as commitment deposit |
| `builder_staked` | u64 | Cumulative builder self-stake |
| `builder_declared` | bool | Builder called `submit_project` |
| `submitted` | bool | Organiser approved via `approve_submissions` |
| `is_refund_enabled` | bool | Admin enabled exceptional refunds |

PDA seeds: `["project", hackathon, sha256(github_url)]`

#### `UserStake`
One per (user, project) pair.

| Field | Type | Description |
|---|---|---|
| `user` | Pubkey | Staker wallet |
| `project` | Pubkey | Project staked on |
| `amount` | u64 | USDC staked |
| `shares` | u64 | Time-weighted shares earned |
| `stake_timestamp` | i64 | When the first stake was placed |
| `is_claimed` | bool | True after claim or refund |

PDA seeds: `["stake", user, project]`

#### `WhitelistedWallet`
Per-hackathon per-wallet access grant. Created by admin. Presence = allowed to stake.

PDA seeds: `["whitelist", hackathon, wallet]`

---

### Instructions

#### User-Callable

**`register_project(github_url, url_hash)`**  
Any wallet can register a project for a hackathon by providing a GitHub URL and its SHA-256 hash (verified on-chain). Creates a `ProjectAccount` PDA.

**`pay_deposit`**  
Builder pays the hackathon's required commitment deposit into the escrow. Required before external backers can stake on the project.

**`self_stake(amount)`**  
Builder stakes their own funds behind their project. Minimum: `hackathon.deposit_amount`. Maximum cumulative: $2,000. Uses the same `UserStake` PDA and payout math as regular staking.

**`submit_project`**  
Builder declares on-chain that they have submitted their project (before cutoff). When `requires_approval = false`, this unlocks `claim_deposit_refund`. When `requires_approval = true`, the organiser must additionally call `approve_submissions`.

**`stake(amount)`**  
Whitelisted wallet stakes USDC on a project. Cap: $2,000 per wallet. Requires:
- `cutoff_timestamp` not yet passed
- Project's builder deposit paid (if hackathon has `deposit_amount > 0`)
- Caller's `WhitelistedWallet` PDA to exist for this hackathon

**`unstake`**  
Withdraws all stake before cutoff. 3% penalty: 1.5% to fee recipient, 1.5% stays in pool. Shares are zeroed.

**`claim`**  
After `finalize_resolve`, claim payout based on project rank + sqrt crowding + share weight. Marks `is_claimed = true`. Irreversible.

**`refund`**  
On admin-enabled refund projects only. Returns original stake with no penalty. For exceptional cases.

**`claim_deposit_refund`**  
Builder reclaims commitment deposit after submission is approved (or self-declared, if `requires_approval = false`).

#### Admin-Only

**`initialize_hackathon(name, results_timestamp, tier_pcts, tier_expected_counts, fee_recipient, protocol_fee_bps, deposit_amount, requires_approval)`**  
Creates a new hackathon. Only callable by `PROTOCOL_ADMIN` (`5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP`).

**`whitelist_wallet`**  
Creates a `WhitelistedWallet` PDA for a (hackathon, wallet) pair, granting that wallet the ability to call `stake`. Only callable by `PROTOCOL_ADMIN`.

**`resolve(rank)`**  
Sets the judge rank on a single project after `results_timestamp`. Call once per project. Rank 1 = first place.

**`finalize_resolve`**  
Computes `effective_tier_pcts` using proportional cascade (empty tiers redistribute to occupied ones), sets `is_resolved = true`. Irreversible. Unlocks `claim`.

**`enable_refund`**  
Marks a project as refund-eligible. One-way flag for exceptional cases.

**`approve_submissions`**  
Batch-approves builder submissions when `requires_approval = true`. Processed as `remaining_accounts`.

**`forfeit_deposit`**  
Confiscates deposit of a ghost builder (registered + paid deposit but never submitted). 50% to fee recipient, 50% added to prize pool.

#### Deployer-Only (BPF Loader)

**`transfer_upgrade_authority`**  
Transfers program upgrade rights to a new wallet. Both current and new authority must sign (BPF `SetAuthorityChecked`). Used to hand deploy rights to a partner.

**`revoke_upgrade_authority`**  
Permanently removes the upgrade authority. The program bytecode is frozen forever — no further deploys or patches by anyone.

---

## Frontend

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · Anchor client · Supabase

### Pages

| Route | Description |
|---|---|
| `/` | Landing page — hackathon list, project explorer, stake UI |
| `/hackathon/[id]` | Individual hackathon view — project cards, staking, leaderboard |
| `/admin` | Protocol admin panel — create hackathons, whitelist wallets, approve submissions, set ranks, finalize |
| `/master` | Deployer panel — view current upgrade authority, transfer or revoke it |
| `/dev` | Development utilities |

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

## Admin Panel Walkthrough

### Creating a Hackathon
1. Connect the protocol admin wallet (`5mxHcM…`)
2. Go to `/admin` → **Create Hackathon**
3. Fill in: name, results date, tier count, builder deposit, protocol fee bps, fee recipient, requires-approval flag
4. Step 2: configure tier percentages (must sum to 100) and expected project counts per tier
5. Submit — creates `HackathonState` PDA + escrow token account on-chain

### Whitelisting Stakers
Inside each hackathon card on `/admin`:
1. Expand the card
2. **Whitelist stakers** section — paste a wallet address
3. Click **Whitelist** — creates the `WhitelistedWallet` PDA on-chain
4. Repeat for each tester/participant

### Resolving Results
After `results_timestamp`:
1. Expand the hackathon card → **Resolve projects**
2. Enter ranks for each project (1 = winner)
3. Click **Set ranks** — sends one `resolve` transaction per ranked project
4. Click **Finalize resolve** → confirm the irreversible prompt
5. Stakers can now call `claim`

---

## Running Locally

### Prerequisites
- Node.js 18+
- Rust + Cargo (stable)
- Solana CLI (`solana-cli` 2.x)
- Anchor CLI 0.31.x
- A Solana devnet wallet with some SOL

### Smart Contract

```bash
cd hackathon-betting
anchor build
anchor test          # Bankrun tests
```

To deploy your own instance:
```bash
solana program deploy target/deploy/hackathon_betting.so \
  --program-id target/deploy/hackathon_betting-keypair.json
```

Update `frontend/lib/constants.ts` with the new program ID.

### Frontend

```bash
cd frontend
cp .env.example .env.local   # fill in RPC_URL and Supabase keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | Solana RPC endpoint (defaults to devnet public) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (Vercel)                   │
│  Next.js 16 App Router + React 19 + Tailwind CSS v4      │
│                                                          │
│  /             /hackathon/[id]    /admin     /master     │
│  Stake UI      Project detail     Admin ops  Deploy ops  │
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
│              Devnet USDC Escrow                           │
│  Mint: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  Supabase (off-chain)                    │
│  hackathon_metadata · project_metadata                   │
│  project_submissions                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Security Properties

- **Admin gate:** Only `PROTOCOL_ADMIN` can create hackathons or whitelist wallets. Enforced via on-chain `address` constraint — other wallets receive `Unauthorized`.
- **Whitelist gate:** Only wallets with a `WhitelistedWallet` PDA for the hackathon can stake. The PDA lookup fails natively if it doesn't exist.
- **Finalization is irreversible:** `finalize_resolve` sets `is_resolved = true` and computes `effective_tier_pcts` — no further ranking changes are possible.
- **CEI pattern:** All token transfers execute before state flags are set (`is_claimed`, `deposit_refunded`).
- **No f64 on-chain:** All math uses integer arithmetic (`u64`, `u128`). Sqrt uses Newton's method. Multipliers use basis points.
- **Upgrade authority:** The program's BPF upgrade authority can be revoked via `/master`, permanently ossifying the bytecode.

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
