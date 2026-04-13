# RankBasedBettingMarket — Contract Interaction Diagram

This document maps every on-chain instruction to the accounts it reads or writes,
shows the token flow through the escrow, and illustrates the temporal sequencing
of the protocol lifecycle.

---

## Protocol Lifecycle (State Machine)

```
                         Admin calls
                    initialize_hackathon
                            │
                            ▼
                    ┌───────────────┐
                    │  INITIALIZED  │  HackathonState created
                    │               │  Escrow token acct created
                    └───────┬───────┘
                            │
                    Anyone calls stake()
                    (before results_timestamp)
                            │
                            ▼
                    ┌───────────────┐
                    │    STAKING    │  UserStake PDAs accumulate
                    │    OPEN       │  total_pool grows
                    └───────┬───────┘
                            │
                    Optional: user calls unstake()
                    (before cutoff_timestamp = results_timestamp - 86400)
                            │
                   cutoff_timestamp passes
                            │
                            ▼
                    ┌───────────────┐
                    │    UNSTAKE    │  unstake() now blocked
                    │    CLOSED     │  stake() still open
                    └───────┬───────┘
                            │
                   results_timestamp passes
                            │
                            ▼
                    ┌───────────────┐
                    │   RESULTS     │  stake() now blocked
                    │   TIME        │  resolve() now allowed
                    └───────┬───────┘
                            │
                    Admin calls resolve()
                    once per project
                            │
                    Admin calls finalize_resolve()
                            │
                            ▼
                    ┌───────────────┐
                    │   RESOLVED    │  is_resolved = true
                    │               │  rest_project_count set
                    └───────┬───────┘
                            │
                    Users call claim()
                    one call per UserStake
                            │
                            ▼
                    ┌───────────────┐
                    │   CLAIMED     │  is_claimed = true per user
                    │               │  Escrow drains to users
                    └───────────────┘
```

---

## Instruction → Account Map

### `initialize_hackathon(results_timestamp)`

```
Signers:   [admin]

WRITES:
  hackathon (PDA: "hackathon" + admin)   → HackathonState (new)
  escrow    (PDA: "escrow" + hackathon)  → TokenAccount   (new, owned by hackathon PDA)

READS:
  usdc_mint      → verify mint address
  system_program → create accounts
  token_program  → init token account
```

---

### `register_project(github_url, url_hash)`

```
Signers:   [payer]

WRITES:
  project (PDA: "project" + hackathon + sha256(github_url)) → ProjectAccount (new)

READS:
  hackathon      → verify exists
  system_program → create account

On-chain check: sha256(github_url) == url_hash
```

---

### `stake(amount)`

```
Signers:   [user]

READS:
  hackathon        → total_pool (add to), cutoff_timestamp, results_timestamp
  project          → total_staked (add to), has_one: hackathon

WRITES:
  hackathon        → total_pool += amount
  project          → total_staked += amount
  user_stake (PDA: "stake" + user + project) → amount += amount (init_if_needed)

TOKEN TRANSFER:
  user_token_account  →[CPI]→  escrow
  (authority: user signer)
```

---

### `unstake()`

```
Signers:   [user]

GUARD:     hackathon.is_resolved == false   (AlreadyResolved if not)
           now < cutoff_timestamp           (CutoffPassed if not)

READS:
  hackathon  → cutoff_timestamp, total_pool, bump
  project    → total_staked
  user_stake → amount, stake_timestamp

WRITES:
  hackathon  → total_pool -= return_amount  (penalty stays)
  project    → total_staked -= stake_amount
  user_stake → amount = 0

PENALTY FORMULA (integer, no f64):
  t_elapsed    = now - stake_timestamp
  t_total      = cutoff_timestamp - stake_timestamp
  penalty_bps  = 3000 × t_elapsed / t_total     (max 3000 = 30%)
  return_amount = stake × (10000 - penalty_bps) / 10000

TOKEN TRANSFER:
  escrow  →[CPI, signed by hackathon PDA]→  user_token_account
```

---

### `resolve(rank)`

```
Signers:   [admin]

GUARD:     now >= hackathon.results_timestamp  (ResultsNotYet if not)
           hackathon.is_resolved == false       (AlreadyResolved if not)
           has_one: admin

WRITES:
  project → rank = rank

READS:
  hackathon → results_timestamp, admin, is_resolved
```

---

### `finalize_resolve()`

```
Signers:   [admin]

GUARD:     now >= hackathon.results_timestamp  (ResultsNotYet if not)
           hackathon.is_resolved == false       (AlreadyResolved if not)
           has_one: admin

remaining_accounts: all ProjectAccounts for this hackathon (passed by client)

READS (remaining_accounts loop):
  each ProjectAccount → rank
  counts projects with rank >= 4 → rest_count

WRITES:
  hackathon → rest_project_count = rest_count
  hackathon → is_resolved = true
```

---

### `claim()`

```
Signers:   [user]

GUARD:     hackathon.is_resolved == true   (NotResolved if not)
           project.rank > 0               (NotResolved if not)
           user_stake.is_claimed == false  (AlreadyClaimed if not)

remaining_accounts: all ProjectAccounts for this hackathon (passed by client)

READS:
  hackathon  → is_resolved, total_pool, rest_project_count, bump
  project    → rank, total_staked
  user_stake → amount

READS (remaining_accounts loop — R_total computation):
  each ProjectAccount (rank > 0) → rank, total_staked
  r_scaled(rank, isqrt(total_staked), rest_project_count) accumulated into r_total

PAYOUT FORMULA (u128 intermediate, no f64):
  r_claim  = r_scaled(project.rank, isqrt(project.total_staked), rpc)
  payout   = (stake × r_claim × total_pool) / (project.total_staked × r_total)
                                    ↑ u128 multiply to prevent overflow

TOKEN TRANSFER (CEI — transfer FIRST, then set flag):
  escrow  →[CPI, signed by hackathon PDA]→  user_token_account

WRITES (after transfer succeeds):
  user_stake → is_claimed = true
```

---

## Account Relationship Diagram

```
                    ┌──────────────────────────────────────────┐
                    │           HackathonState PDA             │
                    │  seed: ["hackathon", admin_pubkey]        │
                    │                                           │
                    │  admin            : Pubkey               │
                    │  usdc_mint        : Pubkey               │
                    │  results_timestamp: i64                  │
                    │  cutoff_timestamp : i64                  │
                    │  total_pool       : u64   ←── grows on   │
                    │  is_resolved      : bool      stake,     │
                    │  judge_weights    : [u8;4]    shrinks on │
                    │  rest_project_count: u16      unstake    │
                    │  bump / escrow_bump: u8                  │
                    └──────┬──────────────────┬────────────────┘
                           │ has_one          │ owns
                           │                 ▼
              ┌────────────┴──────┐   ┌─────────────────────┐
              │  ProjectAccount   │   │   Escrow TokenAcct  │
              │  (one per project)│   │   seed: ["escrow",   │
              │                   │   │         hackathon]  │
              │  seed: ["project",│   │                      │
              │   hackathon,      │   │  mint: usdc_mint     │
              │   sha256(url)]    │   │  authority: hackathon│
              │                   │   │  amount: total_pool  │
              │  hackathon: Pubkey│   │  (approx)            │
              │  github_url: Str  │   └──────────┬───────────┘
              │  total_staked: u64│              │ CPI transfers
              │  rank: u8 (0=unset│              │ (escrow→user on
              │  is_registered    │              │  unstake/claim)
              │  bump: u8         │              │
              └─────────┬─────────┘              │
                        │ has_one                │
                        │                        │
              ┌─────────┴─────────┐   ┌──────────┴───────────┐
              │    UserStake PDA  │   │  User Token Account   │
              │  (one per user    │   │  (user's USDC wallet) │
              │   per project)    │   │                        │
              │                   │   │  mint: usdc_mint       │
              │  seed: ["stake",  │   │  authority: user       │
              │   user, project]  │   └──────────────────────┘
              │                   │
              │  user    : Pubkey │
              │  project : Pubkey │
              │  amount  : u64    │
              │  stake_timestamp  │
              │  is_claimed: bool │
              │  bump: u8         │
              └───────────────────┘
```

---

## Token Flow

```
STAKE:
  User Wallet ──[token::transfer, signed by user]──► Escrow

UNSTAKE (before cutoff, before resolved):
  Escrow ──[token::transfer, signed by hackathon PDA]──► User Wallet
  Amount = stake × (1 - penalty_rate)
  Penalty stays in Escrow → benefits remaining claimers

CLAIM (after resolved):
  Escrow ──[token::transfer, signed by hackathon PDA]──► User Wallet
  Amount = (stake × r_claim × total_pool) / (S_i × r_total)
```

---

## TypeScript Test File → Instruction Mapping

The test file `tests/hackathon-betting.ts` is organized into 12 describe blocks.
Here is how they map to instructions:

```
Section 1:  initialize_hackathon
  └─ happy path, rejects past timestamp (FIX-4)

Section 2:  register_project
  └─ accepts real GitHub URLs > 32 chars (FIX-5)
  └─ rejects url > 200 chars
  └─ rejects mismatched url_hash

Section 3:  stake
  └─ happy path, per-wallet cap, staking-closed guard

Section 4:  unstake
  └─ penalty math, cutoff guard, post-resolve block (FIX-3)

Section 5:  resolve + finalize_resolve
  └─ time-window guard (FIX-2), rank guard, is_resolved flag

Section 6:  TC1 — single winner takes all (rank 1)
Section 7:  TC2 — single loser takes all (rank 4+, sole participant)
Section 8:  TC3a — 5 projects equal stakes, symmetric payout
            TC3b — 5 projects asymmetric stakes, dust ≤ pool (FIX-10)
Section 9:  TC4 — Sybil resistance (20 wallets vs 1 whale, FIX-11)
Section 10: TC5 — per-dollar advantage for lightly-backed rank-1
Section 11: error paths (claim)
  └─ AlreadyClaimed, NotResolved for rank-0 project (FIX-12)
Section 12: CU audit (5 / 10 / 20 / 50 projects)
  └─ FIX-8: rest_project_count=0 sub-case
```

---

## Helper Functions in Test File

```typescript
// PDA derivation
hackathonPda(admin)           → HackathonState address
escrowPda(hackathon)          → Escrow token account address
projectPda(hackathon, url)    → ProjectAccount address  ← hashes URL internally
stakePda(user, project)       → UserStake address

// Off-chain math mirrors (must stay in sync with lib.rs)
isqrt(n: bigint)              → integer square root
rScaled(rank, ci, rpc)        → scaled payout weight
expectedPayout(...)           → reference payout for assertion

// Scenario setup helpers
newHackathon(ctx, program)    → creates hackathon + escrow
addProject(ctx, program,      → register_project + return PDA
  fix, url)
doStake(ctx, program, fix,    → token setup + stake
  user, project, amount)
setClock(ctx, ts)             → advance Bankrun clock to timestamp
measureClaimCU(n)             → CU audit sub-routine
```

---

## Instruction Dependency Graph

```
initialize_hackathon
        │
        ├──► register_project   (requires: hackathon exists)
        │         │
        │         └──► stake    (requires: project registered)
        │                  │
        │                  └──► unstake   (requires: user_stake exists,
        │                                  before cutoff, before resolved)
        │
        ├──► resolve            (requires: results_timestamp passed)
        │
        └──► finalize_resolve   (requires: all resolve() called,
                  │              results_timestamp passed)
                  │
                  └──► claim    (requires: is_resolved = true,
                                 project.rank > 0,
                                 !user_stake.is_claimed)
```

Read the instructions in this order when studying the code:
1. `initialize_hackathon` — sets up the world
2. `register_project` — adds a competitor
3. `stake` / `unstake` — user activity before cutoff
4. `resolve` — admin inputs results (call N times)
5. `finalize_resolve` — closes resolution, enables claims
6. `claim` — user collects payout
