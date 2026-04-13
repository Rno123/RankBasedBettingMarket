# RankBasedBettingMarket — Post-Fix Deployment Context
## Updated context for Step 7: Devnet Deploy (after configurable tiers redesign)

> **This document supersedes all earlier deployment context files.**
> It reflects the current build: **48 tests, branch `claude/review-protocol-fixes-mJFGU`**,
> with configurable winner tiers and proportional cascade (Option B).

---

## What Has Been Built (Steps 1–6 + Security Fixes + Configurable Tiers Complete)

A fully implemented, audited, and tested Solana/Anchor hackathon betting protocol.
All code lives in `/home/user/RankBasedBettingMarket/hackathon-betting/`.
Branch: `claude/review-protocol-fixes-mJFGU`

---

## Program Details

- **Program ID (localnet/test):** `81k4nRYTKkAJmd5Fm9uKktYR82xLUNq4qAiYbuL7RP1o`
  - This will change on devnet deploy — must update `declare_id!` and IDL
- **Anchor version:** 0.31.0
- **Solana CLI target:** devnet
- **Language:** Rust (Anchor), TypeScript (tests)
- **Test framework:** Bankrun (`solana-bankrun@0.4.0`, `anchor-bankrun@0.5.0`)
- **Token:** devnet USDC (SPL Token)

---

## Repo / File Map

```
hackathon-betting/
├── programs/hackathon-betting/src/lib.rs   ← full on-chain program
├── tests/hackathon-betting.ts              ← 48 Bankrun tests (all passing)
├── target/
│   ├── idl/hackathon_betting.json          ← IDL (must regenerate after deploy)
│   ├── types/hackathon_betting.ts          ← generated types
│   └── deploy/hackathon_betting.so         ← compiled binary
├── Anchor.toml                             ← cluster = devnet after deploy
└── Cargo.toml
```

---

## Instructions Implemented

| # | Instruction            | Description |
|---|------------------------|-------------|
| 1 | `initialize_hackathon` | Admin creates HackathonState PDA + USDC escrow. Configures winner tiers (`tier_pcts`, `tier_expected_counts`). Rejects `results_timestamp` in the past. |
| 2 | `register_project`     | Creates ProjectAccount PDA. Accepts GitHub URLs up to 200 chars. PDA seed = SHA-256(url). Requires `url_hash = SHA-256(github_url)` argument. |
| 3 | `stake`                | User deposits USDC to escrow, creates/updates UserStake PDA. Blocked after `results_timestamp`. |
| 4 | `unstake`              | Linear decay penalty (max 30%), returns remainder, penalty stays in pool. Blocked after `cutoff_timestamp` and after `is_resolved = true`. |
| 5 | `resolve`              | Admin sets rank on one ProjectAccount per call. Blocked before `results_timestamp`. |
| 6 | `finalize_resolve`     | Computes effective tier percentages with proportional cascade (Option B), writes `effective_tier_pcts`, sets `is_resolved = true`. Blocked before `results_timestamp`. Requires at least one ranked project. |
| 7 | `claim`                | Two-stage payout: tier pool share (from `effective_tier_pcts`) × within-tier sqrt crowding. CEI order: transfer before `is_claimed`. Rejects rank-0 projects. |
| 8 | `enable_refund`        | Admin marks a project as refund-eligible (exceptional use only — judging errors, cancellations). |
| 9 | `refund`               | User recovers full original stake on a refund-enabled project. No penalty. CEI order. |

---

## Account Structures

```rust
HackathonState {
    admin: Pubkey,                          // 32
    usdc_mint: Pubkey,                      // 32
    results_timestamp: i64,                 // 8
    cutoff_timestamp: i64,                  // 8  = results_timestamp - 86400
    total_pool: u64,                        // 8
    is_resolved: bool,                      // 1
    tier_count: u8,                         // 1  — number of configured tiers (1–8)
    tier_pcts: [u8; 8],                     // 8  — configured pool % per tier, sum=100
    tier_expected_counts: [u8; 8],          // 8  — for UI display only
    effective_tier_pcts: [u16; 8],          // 16 — bps computed at finalize_resolve
    bump: u8,                               // 1
    escrow_bump: u8,                        // 1
    // SPACE = 132
}

ProjectAccount {
    hackathon: Pubkey,                      // 32
    github_url: String,                     // 4 + 200 max
    total_staked: u64,                      // 8
    rank: u8,                               // 1  (0 = unranked)
    is_registered: bool,                    // 1
    is_refund_enabled: bool,                // 1
    bump: u8,                               // 1
    // SPACE = 256
}

UserStake {
    user: Pubkey,                           // 32
    project: Pubkey,                        // 32
    amount: u64,                            // 8
    stake_timestamp: i64,                   // 8
    is_claimed: bool,                       // 1
    bump: u8,                               // 1
    // SPACE = 90
}
```

---

## PDA Seeds

| Account             | Seeds |
|---------------------|-------|
| HackathonState      | `["hackathon", admin_pubkey]` |
| Escrow (token acct) | `["escrow", hackathon_pubkey]` |
| ProjectAccount      | `["project", hackathon_pubkey, sha256(github_url)]` |
| UserStake           | `["stake", user_pubkey, project_pubkey]` |

> **Note:** The ProjectAccount seed uses the 32-byte SHA-256 digest of the URL,
> not the raw URL bytes (Solana rejects seeds >32 bytes).  Clients must hash first:
>
> ```typescript
> import { createHash } from "crypto";
> const urlHash = createHash("sha256").update(url).digest(); // 32-byte Buffer
> const [projectPda] = PublicKey.findProgramAddressSync(
>   [Buffer.from("project"), hackathon.toBuffer(), urlHash], PROGRAM_ID);
> ```

---

## Instruction Signatures

```rust
// initialize_hackathon — configurable tiers
pub fn initialize_hackathon(
    ctx: Context<InitializeHackathon>,
    results_timestamp: i64,
    tier_pcts: Vec<u8>,            // pool % per tier, must sum to 100, len 1–8
    tier_expected_counts: Vec<u8>, // expected winners per tier (UI only), same len
) -> Result<()>

// register_project — url_hash required for on-chain verification
pub fn register_project(
    ctx: Context<RegisterProject>,
    github_url: String,
    url_hash: [u8; 32],            // must equal SHA-256(github_url)
) -> Result<()>

// stake / unstake / resolve / claim — signatures unchanged from v1
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()>
pub fn unstake(ctx: Context<Unstake>) -> Result<()>
pub fn resolve(ctx: Context<Resolve>, rank: u8) -> Result<()>
pub fn finalize_resolve(ctx: Context<FinalizeResolve>) -> Result<()>
pub fn claim(ctx: Context<Claim>) -> Result<()>

// new in this release
pub fn enable_refund(ctx: Context<EnableRefund>) -> Result<()>
pub fn refund(ctx: Context<Refund>) -> Result<()>
```

> **Client note:** `tier_pcts` and `tier_expected_counts` are `bytes` in the IDL.
> Pass them as `Buffer.from([...])` in TypeScript, not as plain number arrays.

---

## Error Codes (full list)

| Error               | Code | Description |
|---------------------|------|-------------|
| `CutoffPassed`      | 6000 | Unstaking after the 24-hour cutoff window |
| `StakingClosed`     | 6001 | Staking after results_timestamp |
| `NotResolved`       | 6002 | Hackathon not yet resolved (or project rank = 0) |
| `AlreadyResolved`   | 6003 | Operation not allowed after finalize_resolve |
| `AlreadyClaimed`    | 6004 | Payout already claimed |
| `StakeCapExceeded`  | 6005 | Over 1,000,000,000 units per wallet per project |
| `UrlTooLong`        | 6006 | github_url exceeds 200 characters |
| `InvalidRank`       | 6007 | Rank must be ≥ 1 |
| `ZeroAmount`        | 6008 | Amount must be > 0 |
| `Overflow`          | 6009 | Arithmetic overflow |
| `ResultsNotYet`     | 6010 | results_timestamp has not arrived (resolve/finalize too early) |
| `InvalidTimestamp`  | 6011 | results_timestamp must be in the future (initialize_hackathon) |
| `InvalidUrlHash`    | 6012 | url_hash ≠ SHA-256(github_url) |
| `InvalidTierConfig` | 6013 | tier_pcts doesn't sum to 100, count 0 or >8, or lengths mismatch |
| `RefundNotEnabled`  | 6014 | refund() called on project without enable_refund |
| `AllTiersEmpty`     | 6015 | finalize_resolve: no ranked project found in any tier |

---

## Payout Formula (on-chain, integer math only — no f64)

### Stage 1 — Tier pool allocation (computed at `finalize_resolve`)

```
tier_pcts[i]   = configured % for tier i (set at init, sum = 100)

Cascade rule (Option B):
  If tier i has no ranked project in remaining_accounts → its % redistributes
  proportionally to all occupied tiers.

  total_non_empty_bps = sum of tier_pcts[j]*100 for occupied tiers j
  effective_bps[j]    = floor(tier_pcts[j] * 1_000_000 / total_non_empty_bps)
  last occupied tier  absorbs rounding dust so sum = exactly 10_000 bps

effective_tier_pcts[] stored as u16 basis points in HackathonState.
```

### Stage 2 — Within-tier distribution (computed at `claim`)

```
tier       = rank_to_tier_idx(project.rank, tier_count)
             = min(rank-1, tier_count-1)   // ranks > tier_count → last (rest) tier

P_t        = effective_tier_pcts[tier]     (basis points, 0–10000)
S_i        = project.total_staked
C_i        = isqrt(S_i)                   // sqrt crowding adjustment
C_total_t  = Σ isqrt(S_j) for all projects j in tier t
             (accumulated from remaining_accounts in claim)

payout = stake × C_i × P_t × total_pool
         ────────────────────────────────
         S_i × C_total_t × 10_000

All intermediate arithmetic in u128. Transfer executes before is_claimed (CEI).
```

### Example: 3 tiers [55%, 30%, 15%], tier-2 (rest) empty

```
total_non_empty_bps = 5500 + 3000 = 8500
effective_bps[0] = floor(55 * 1_000_000 / 8500) = 6470
effective_bps[1] = 10_000 - 6470               = 3530  (last occupied, absorbs dust)
effective_bps[2] = 0  (empty tier)
```

---

## Mechanism Constants

```
MAX_TIERS                        = 8
TIER_BPS_TOTAL                   = 10_000
MAX_STAKE_PER_WALLET_PER_PROJECT = 1_000_000_000  (USDC smallest units)
MAX_PENALTY_BPS                  = 3_000           (30%)
BPS_DENOM                        = 10_000
SELL_CUTOFF_BEFORE_RESULTS       = 86_400          (24 hours)
```

> `JUDGE_WEIGHTS` is no longer a compile-time constant. Tier percentages are
> configured per hackathon via `initialize_hackathon(tier_pcts)`.

---

## Test Results

**48 tests, 0 failing**

### Core payout test cases
| # | Scenario | Key assertion |
|---|----------|---------------|
| TC1 | All funds on rank-1 winner, single project | Payout = full pool |
| TC2 | All funds on rank-4+ (rest tier) project, single project | Payout = full pool (sole participant) |
| TC3a | 5 projects ranks 1–5, equal stakes, tiers [55,30,15] | Sum of payouts = pool (zero dust) |
| TC3b | 5 projects ranks 1–5, asymmetric stakes | Sum of payouts ≤ pool |
| TC4 | Sybil: 20 wallets × 1000 vs 1 whale × 20000, ranks 1&2 | Group total ≈ whale payout (±20 units) |
| TC5 | Lightly-backed rank-1 vs crowded rank-2 | Rank-1 per-dollar return > rank-2 |
| Cascade | tier-0 (grand winner) empty → 55% redistributes to lower tiers | effectivePcts sum = 10000, payouts match cascaded formula |

### Security / error-path tests
- FIX-1 (CEI): `is_claimed` set only after successful transfer (both `claim` and `refund`)
- FIX-2: `resolve` and `finalize_resolve` rejected before `results_timestamp`
- FIX-3: `unstake` rejected after `is_resolved = true`
- FIX-4: `initialize_hackathon` rejected with past timestamp
- FIX-5: Real GitHub URLs (>32 chars) accepted; URL > 200 chars rejected
- FIX-6: Overflow-safe arithmetic (`checked_mul` throughout)
- FIX-7: `claim` on unranked project (rank=0) → `NotResolved`
- FIX-8: All projects in top 3 tiers (no rest tier) — effective pcts unchanged, payouts match formula
- FIX-10: Asymmetric-stake dust test (sum ≤ pool)
- FIX-11: Sybil group payout end-to-end assertion
- FIX-12: Claim on rank-0 project after finalize → `NotResolved`
- Refund: happy path (full stake returned), `RefundNotEnabled`, `AlreadyClaimed`

---

## Step 6 CU Audit — VERDICT

| Projects | Compute Units |
|----------|--------------|
| 5        | 19,493       |
| 10       | 23,023       |
| 20       | 30,349       |
| 50       | tx size exceeded (legacy packet limit) |

**No snapshot optimization needed.** 30,349 CU at 20 projects is well under the
200,000 CU threshold.  The two-stage formula is slightly leaner than the previous
`r_scaled` implementation.

At N ≈ 35+, account keys alone exceed the legacy transaction packet limit (1,232 bytes).
Clients at that scale must use **Address Lookup Tables (ALTs)** — see Known Constraints.

---

## Step 7: Devnet Deploy — What To Expect

### Pre-deploy checklist
- [ ] `anchor build` — confirm clean build
- [ ] Confirm `[programs.devnet]` in `Anchor.toml` has the right program ID
  (or use `anchor keys list` after first deploy to get real ID)
- [ ] Wallet with SOL for deploy (~2–3 SOL for rent + tx fees)
- [ ] `solana config set --url devnet`
- [ ] `solana airdrop 2` (devnet faucet; may need to retry)
- [ ] Devnet USDC mint address (use Circle's devnet USDC or deploy a mock mint)

### Deploy command
```bash
anchor build
anchor deploy --provider.cluster devnet
```

### After deploy
1. Copy the new program ID from deploy output
2. Update `declare_id!("NEW_ID")` in `lib.rs`
3. Update `[programs.devnet]` in `Anchor.toml`
4. `anchor build` again to regenerate IDL with new program ID
5. Update `PROGRAM_ID` constant in `tests/hackathon-betting.ts`
6. Re-run tests: `yarn ts-mocha -p tsconfig.json -t 300000 'tests/**/*.ts'` — confirm 48 pass
7. Publish IDL on-chain: `anchor idl init --filepath target/idl/hackathon_betting.json <PROGRAM_ID>`

### Known likely issues
1. **Airdrop rate limits** — devnet faucet is unreliable; retry with `solana airdrop` from CLI
2. **Program ID mismatch** — if `declare_id!` doesn't match deployed ID, all instructions
   fail with `DeclaredProgramIdMismatch`
3. **Devnet USDC** — need a real SPL mint on devnet. Options:
   - Use a known devnet USDC mint
   - Deploy your own mock SPL mint for testing
4. **RPC rate limits** — public devnet RPC throttles; consider Helius/QuickNode free tier
5. **Account not found errors** — `initialize_hackathon` creates the escrow ATA; confirm it
   was created before first stake
6. **Blockhash expiry on slow deploys** — `--with-compute-unit-price` may help if txs drop

### Useful commands
```bash
solana config get                                                          # verify cluster/wallet
solana balance                                                             # check SOL
anchor keys list                                                           # show program keypair pubkey
anchor deploy --provider.cluster devnet                                    # deploy
anchor idl init --filepath target/idl/hackathon_betting.json <PROGRAM_ID> # publish IDL
solana confirm -v <TX_SIG>                                                 # inspect transaction
```

---

## Known Design Decisions / Gotchas

1. **Configurable tiers replace hardcoded weights.** `tier_pcts` (e.g. `[55, 30, 15]`) is
   set at hackathon creation and stored in `HackathonState`. The frontend collects tier
   names, percentages, and expected counts from the admin before calling `initialize_hackathon`.

2. **Proportional cascade (Option B).** If a tier has no ranked project at resolution time,
   its configured percentage redistributes proportionally across all occupied tiers.
   Example: grand winner tier (55%) empty → its share cascades to sub-winner and rest tiers.
   Cascade is computed by `finalize_resolve` and stored as `effective_tier_pcts` (basis points).

3. **`tier_pcts` and `tier_expected_counts` must be passed as `Buffer` in TypeScript.**
   The IDL encodes these as `bytes` (Anchor's `Vec<u8>`), which requires `Buffer.from([...])`
   — a plain JavaScript number array will cause a `Blob.encode` error at runtime.

4. **`finalize_resolve` requires at least one ranked project** (`AllTiersEmpty` if not).
   If all projects were left at rank 0 (resolve was never called), finalize will revert.
   Use `enable_refund` + `refund` as the exceptional recovery path in that case.

5. **`enable_refund` / `refund` are exceptional paths.** They exist for judging errors or
   hackathon cancellations. `enable_refund` is admin-only and sets a per-project flag.
   Once enabled it cannot be revoked. `refund` returns the user's full original stake with
   no penalty, using CEI ordering (transfer before `is_claimed`).

6. **`register_project` requires `url_hash` argument.** The instruction accepts both
   `github_url: String` and `url_hash: [u8; 32]`. The program verifies on-chain that
   `SHA-256(github_url) == url_hash`. Client must hash the URL before calling.

7. **`total_pool` is never decremented in `claim`.** T is fixed at resolution. Integer
   division dust stays in escrow (irrecoverable in MVP). A future `sweep_dust` admin
   instruction can drain the remainder once all UserStakes are claimed.

8. **`hackathon` account is NOT writable in `claim`** — only `user_stake` and `escrow`
   are mutated.

9. **`resolve` and `finalize_resolve` are both time-gated** — both fail with `ResultsNotYet`
   if called before `results_timestamp`. This prevents insider-trading (admin locking results
   while staking is still open).

10. **`unstake` is blocked after `finalize_resolve`** — after `is_resolved = true`,
    `total_pool` is locked. Attempting to unstake after resolution reverts with `AlreadyResolved`.

---

## Known Constraints

### ALT requirement at N ≈ 35 projects
Legacy Solana transactions cap at 1,232 bytes. At ~35 projects, account keys alone
(35 × 32 bytes) leave no room for instruction data. Clients calling `claim` or
`finalize_resolve` with >~35 `remaining_accounts` must construct an **Address Lookup Table (ALT)**:

```typescript
// Pseudocode — ALT construction
const [lookupTableIx, lookupTableAddress] =
  AddressLookupTableProgram.createLookupTable({ authority, payer, recentSlot });
const extendIx = AddressLookupTableProgram.extendLookupTable({
  addresses: allProjectPubkeys,
  lookupTable: lookupTableAddress,
  authority, payer,
});
// Then use VersionedTransaction with MessageV0 + ALT for the claim call.
```

### Anchor.toml program ID
Currently both `[programs.localnet]` and `[programs.devnet]` share the localnet
program ID. First `anchor deploy` will generate a new on-chain address.
Update `declare_id!`, `Anchor.toml`, and the `PROGRAM_ID` constant in tests
immediately after the first deploy output is known.
