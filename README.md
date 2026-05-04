# HackBet — Rank-Weighted Hackathon Conviction Market

HackBet is a Solana-native protocol where participants stake USDC on hackathon projects before judging. When results are announced, the prize pool is redistributed to stakers who backed winning projects — weighted by how much was staked and how early.

It is not a prediction market. It is a conviction signal layer built on top of hackathon judging: the crowd puts money where its mouth is, and winners share the pool proportionally to the signal they attracted.

Live on devnet: **[hackbet.vercel.app](https://hackbet.vercel.app)**  
Program ID: `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`
Contract reference: [CONTRACT_REFERENCE.md](./CONTRACT_REFERENCE.md)

---

## How It Works

### The Staking Window
A hackathon is created with a `results_timestamp`. Staking is open from creation until `cutoff_timestamp` (24 hours before results). After cutoff, all positions are locked — no new stakes, no unstakes.

### Time-Weighted Shares
Staking earlier earns more shares per USDC. The multiplier decays linearly from **1.5× at open** to **1.0× at cutoff**.

```
shares     = amount × multiplier_bps / 10_000
multiplier_bps = 15_000 − floor(5_000 × elapsed / window)
```

An early backer staking $100 near launch earns more shares — and a larger slice of the payout — than someone staking $100 the day before cutoff.

### Payout Formula
After the admin resolves ranks and calls `finalize_resolve`, the total pool is distributed using a two-stage formula:

**Stage 1 — Tier allocation**  
The organiser configures tier percentages at hackathon creation (e.g. 55% to tier 1, 30% to tier 2, 15% to tier 3). If a tier has no ranked project, its percentage cascades proportionally to occupied tiers. The effective percentages are computed at `finalize_resolve` and stored on-chain.

**Stage 2 — Within-tier distribution (sqrt crowding)**  
Within each tier, projects compete via sqrt crowding. A project with $10,000 staked gets `sqrt(10000) = 100` weight. A project with $1,000 staked gets `sqrt(1000) ≈ 31.6` weight. This prevents a single over-backed project from sweeping the whole tier; lightly-backed winners still earn a meaningful share.

The per-tier crowding denominator (`C_total_t`) is snapshotted at `finalize_resolve` and stored on `HackathonState`, making it impossible for a claimer to manipulate payouts by omitting competitors.

**Per-user payout**
```
payout = user_shares × C_i × effective_tier_pct × total_pool
         ────────────────────────────────────────────────────
         project_total_shares × C_total_t × 10_000
```

A protocol fee (default 1.5%) is deducted from the payout at claim time.

### Early Exit
Unstaking before cutoff incurs a fixed **3% penalty**: 1.5% goes to the fee recipient (protocol revenue), 1.5% stays in the escrow pool (benefiting remaining stakers). Unstaking is locked in the final 24 hours before results.

---

## Protocol Constants

| Constant | Value | Description |
|---|---|---|
| `SELL_CUTOFF_SECS` | 86,400 s | Seconds before results that staking locks |
| `UNSTAKE_PENALTY_BPS` | 300 bps | Total early-exit penalty (3%, flat — not time-decayed) |
| `UNSTAKE_PROTOCOL_BPS` | 150 bps | Portion routed to fee recipient (1.5%) |
| `EARLY_MULTIPLIER_BPS` | 15,000 bps | Share multiplier at open (1.5×) |
| `BASE_MULTIPLIER_BPS` | 10,000 bps | Share multiplier at cutoff (1.0×) |
| `MAX_STAKE_PER_WALLET` | 2,000,000,000 | $2,000 USDC cap per wallet per project |
| `MAX_SELF_STAKE` | 2,000,000,000 | $2,000 USDC builder self-stake cap |
| `DEFAULT_PROTOCOL_FEE_BPS` | 150 bps | Default claim fee (1.5%) |
| `DEFAULT_DEPOSIT_AMOUNT` | 10,000,000 | Default builder commitment deposit ($10 USDC) |
| `MAX_TIERS` | 8 | Maximum number of winner tiers |

---

## On-Chain Program

**Network:** Solana Devnet  
**Program ID:** `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`  
**Framework:** Anchor 0.31.0  
**Protocol admin:** `5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP`

### Instructions

#### Builder / Staker Callables

| Instruction | Description |
|---|---|
| `pay_deposit` | Builder pays the hackathon's optional commitment deposit into escrow when that hackathon requires one. Required before backers can stake. |
| `self_stake(amount)` | Builder stakes their own funds. Min: `deposit_amount`. Max cumulative: $2,000. |
| `submit_project` | Builder declares on-chain submission before results. Organizer approval of that submission is still required before `claim_deposit_refund` unless refund override is enabled. |
| `stake(amount)` | Whitelisted wallet stakes USDC. Cap: $2,000. Requires `WhitelistedWallet` PDA, deposit paid, and a project that is already live on-chain. |
| `unstake` | Withdraw all stake before cutoff. Flat 3% penalty. Shares zeroed. |
| `claim` | After `finalize_resolve`, claim payout. Marks `is_claimed = true`. Irreversible. |
| `refund` | Admin-enabled exceptional refund path. Returns original stake, no penalty. |
| `claim_deposit_refund` | Builder reclaims the optional commitment deposit after organizer approval of the submission or refund override. |

Multi-pick products such as a "Top 3 slip" do not need a separate on-chain payout path. The client can batch multiple existing `stake(amount)` instructions into one Solana transaction, one leg per selected project, and later batch the matching `claim()` instructions the same way. Equal-weight and custom-weight slips are both just different per-leg stake amounts using the existing payout formula.

#### Hackathon Admin / Protocol-Admin Callables

| Instruction | Description |
|---|---|
| `register_project(github_url, url_hash)` | Register an approved project on-chain for a builder wallet. Callable by the hackathon admin or a protocol admin. |
| `whitelist_wallet` | Grant a wallet the ability to stake in a specific hackathon. |
| `resolve(rank)` | Set the judge rank on one project (after `results_timestamp`). |
| `finalize_resolve` | Compute effective tier percentages, snapshot `tier_c_totals`, set `is_resolved = true`. Irreversible. |
| `enable_refund` | Mark a project refund-eligible (exceptional case). |
| `approve_submissions` | Batch-approve builder submissions so optional deposits become claimable. |
| `forfeit_deposit` | Confiscate deposit of a ghost builder after the post-results grace period. 50% to fee recipient, 50% to pool. |

#### Protocol-Admin Only

| Instruction | Description |
|---|---|
| `initialize_hackathon(...)` | Create a hackathon. Sets name, timestamps, tier config, fee recipient, and deposit rules. Callable by the super-admin or a delegated `ProtocolAdminEntry` wallet. |
| `add_protocol_admin` / `remove_protocol_admin` | Delegate / revoke admin rights to another wallet. |

#### Deployer-Only (BPF Upgrade Authority)

| Instruction | Description |
|---|---|
| `transfer_upgrade_authority` | Hand program upgrade rights to a new wallet. Both parties sign. |
| `revoke_upgrade_authority` | Permanently freeze the program bytecode. No further upgrades by anyone. |

### Account Types

**`HackathonState`** — one per hackathon  
PDA: `["hackathon", admin, name]`

**`ProjectAccount`** — one per registered project  
PDA: `["project", hackathon, sha256(github_url)]`  
Key fields: `total_staked`, `total_shares`, `rank`, `builder_declared`, `submitted`, `deposit_forfeited`

**`UserStake`** — one per (user, project) pair  
PDA: `["stake", user, project]`  
Key fields: `amount`, `shares`, `stake_timestamp`, `is_claimed`

**`WhitelistedWallet`** — one per (hackathon, wallet) pair  
PDA: `["whitelist", hackathon, wallet]`  
Presence = allowed to stake. Absence = `AccountNotInitialized` on stake attempt.

**Escrow** — PDA-owned SPL token account  
PDA: `["escrow", hackathon]`

---

## Frontend

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · Anchor client · Supabase

### Pages

| Route | Description |
|---|---|
| `/` | Landing — hackathon list, project explorer, stake UI |
| `/hackathon/[id]` | Hackathon detail — project cards, staking, leaderboard, claim |
| `/admin` | Admin panel — protocol admins can create hackathons; protocol admins and assigned hackathon admins can manage submissions, staker access, deposits, and results |
| `/master` | Deployer panel — view upgrade authority, transfer or permanently revoke |
| `/dev` | Builder portal — submit projects, manage deposits, self-stake, and claim refunds |

### API Routes

| Route | Method | Description |
|---|---|---|
| `/api/whitelist-request` | POST | Create a wallet-signed request for staking access. Deduplicates pending/approved requests per wallet. |
| `/api/github-stats?url=` | GET | GitHub repo stats (last commit, 7-day commits). 1-hour Supabase cache. Graceful fallback on GitHub rate-limit. |
| `/api/project-submission` | POST | Create or refresh a builder-submitted project review request, including the project's social metadata. Requires a wallet signature on `hackbet:register:<projectPubkey>`. |
| `/api/admin/project-submissions` | GET / POST | Admin review queue for project submissions. Uses per-request signed admin headers. |
| `/api/admin/whitelist-requests` | GET / POST | Admin review queue for staking-access requests. Uses per-request signed admin headers. |

### Key Components

**`StakeModal`** — Opens on project click. Shows current stake, live-decaying multiplier, and stake/unstake actions. Checks whitelist status on mount and shows a "Not whitelisted" notice if the connected wallet has no `WhitelistedWallet` PDA.

**`ClaimButton`** — Shown on resolved hackathons. Calls `claim` for the connected wallet.

**`Navbar`** — Wallet adapter (Phantom, Backpack, etc.), dark mode toggle.

### Hooks

| Hook | Data source | Description |
|---|---|---|
| `useHackathons` | On-chain | All `HackathonState` PDAs |
| `useProjects(hackathon)` | On-chain | All `ProjectAccount` PDAs for a hackathon |
| `useUserStake(user, project)` | On-chain | Single `UserStake` PDA |
| `useWhitelistStatus(hackathon, wallet)` | On-chain | Whether wallet has a `WhitelistedWallet` PDA |
| `useHackathonMeta(pubkey)` | Supabase | Off-chain name, icon, and link metadata |
| `useIsProtocolAdmin` | On-chain / constants | Whether connected wallet is the super-admin or has a `ProtocolAdminEntry` PDA |
| `useTheme` | localStorage | Dark / light mode |

### Off-Chain Data (Supabase)

| Table | Contents |
|---|---|
| `hackathon_metadata` | `official_link`, `icon_url` per hackathon pubkey |
| `project_metadata` | `twitter_handle`, `telegram`, `discord`, `github_url` per project pubkey |
| `project_submissions` | Builder registration / review state, keyed by project and wallet |
| `whitelist_requests` | Staker access requests per hackathon and wallet |
| `github_stats` | Cached GitHub commit stats (1-hour TTL) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (Vercel)                   │
│  Next.js 16 App Router · React 19 · Tailwind CSS v4      │
│                                                          │
│  /       /hackathon/[id]     /admin        /master       │
│  Stake   Project detail      Admin ops     Deploy ops    │
└───────────────────────┬─────────────────────────────────┘
                        │ Anchor client + wallet adapter
┌───────────────────────▼─────────────────────────────────┐
│           Solana Program (Anchor 0.31.0)                  │
│                                                          │
│  HackathonState PDA   ProjectAccount PDAs                │
│  UserStake PDAs       WhitelistedWallet PDAs             │
│  Escrow token account (PDA-owned)                        │
└───────────────────────┬─────────────────────────────────┘
                        │ SPL token transfer
┌───────────────────────▼─────────────────────────────────┐
│           Devnet USDC Escrow                              │
│  Mint: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  Supabase (off-chain)                    │
│  hackathon_metadata · project_metadata · github_stats    │
└─────────────────────────────────────────────────────────┘
```

---

## Running Locally

### Prerequisites
- Node.js 18+ · Rust (stable) · Solana CLI 2.x · Anchor CLI 0.31.x · Yarn

### Smart Contract

```bash
cd hackathon-betting
anchor build
# Tests (uses bankrun — no validator needed)
anchor build -- --features testing
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
# 82/82 passing
```

To deploy a fresh instance:
```bash
solana program deploy target/deploy/hackathon_betting.so \
  --program-id target/deploy/hackathon_betting-keypair.json
```
Then update `PROGRAM_ID` in `frontend/lib/constants.ts`.

### Frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in RPC_URL and Supabase keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_RPC_URL` | Solana RPC endpoint (defaults to devnet public RPC) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (safe to expose client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side API routes only) |
| `GITHUB_TOKEN` | Optional — increases GitHub API rate limit for `/api/github-stats` |

For X / Twitter sign-in, enable the X (OAuth 2.0) provider in Supabase Authentication -> Providers and use the callback URL shown there. The frontend prefers the current `x` provider and falls back to legacy `twitter` for older Supabase setups.

---

## Admin Panel Walkthrough

### Creating a Hackathon
1. Connect a protocol admin wallet (`5mxHcM…`) to create hackathons, or the wallet stored as `hackathon.admin` to manage an existing event
2. Go to `/admin` → **Create Hackathon**
3. Fill in: name, results date, tier count, builder deposit, protocol fee bps, and fee recipient
4. Configure tier percentages (must sum to 100) and expected project counts per tier
5. Submit — creates `HackathonState` PDA + escrow token account on-chain. Submission approval is currently always on in the admin flow.

### Whitelisting Stakers
1. Expand a hackathon card → **Staker access**
2. Paste a wallet address, click **Grant access** — creates the `WhitelistedWallet` PDA for that hackathon
3. Protocol admins can also use the global staker access panel to grant access across every current hackathon and review pending requests

### Resolving Results
After `results_timestamp`:
1. Expand the hackathon card → **Resolve projects**
2. Enter ranks (1 = winner), click **Set ranks** — one `resolve` transaction per project
3. Click **Finalize resolve** → confirm the irreversible prompt
4. Stakers can now call `claim`

---

## Security Properties

- **Admin gate:** Protocol admins can create hackathons and manage any event. The wallet stored as `hackathon.admin` can manage that specific hackathon's whitelist, submissions, deposit controls, and resolution.
- **Whitelist gate:** Only wallets with a `WhitelistedWallet` PDA for the hackathon can stake.
- **Payout denominator integrity:** `finalize_resolve` snapshots `tier_c_totals` on-chain. Claim reads stored values — caller cannot inflate payouts by omitting competitor accounts.
- **Finalization is irreversible:** `finalize_resolve` sets `is_resolved = true`. No further ranking changes or unstakes are possible after this point.
- **CEI pattern:** All state flags (`is_claimed`, `deposit_refunded`) are set after token transfers complete.
- **No f64 on-chain:** All math uses integer arithmetic. Sqrt uses Newton's method in integer domain.
- **Upgrade authority:** The program's BPF upgrade authority can be revoked via `/master`, permanently ossifying the bytecode.

---

## Roadmap

- [ ] Mainnet USDC migration (update `PROGRAM_ID`, `USDC_MINT`, `RPC_URL` in `frontend/lib/constants.ts`)
- [ ] On-chain milestone tracking (builder progress posts)
- [ ] Twitter/X handle verification for builder profiles
- [ ] Merkle-tree project approval (off-chain computation, on-chain inclusion proof)
- [ ] Address Lookup Tables for hackathons with >35 projects

---

## License

MIT
