# RankBasedBettingMarket — Post-Fix Deployment Context
## Updated context for Step 7: Devnet Deploy (after protocol security fixes)

> **This document supersedes `DEPLOYMENT_CONTEXT.md`** for all sessions starting
> after the `claude/review-protocol-fixes-mJFGU` branch was merged.  The earlier
> document reflects the original build (39 tests, branch `claude/start-step-1-hGwJW`).
> This document reflects the fixed build (44 tests, branch `claude/review-protocol-fixes-mJFGU`).

---

## What Has Been Built (Steps 1–6 + Security Fixes Complete)

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
├── programs/hackathon-betting/src/lib.rs   ← full on-chain program (post-fix)
├── tests/hackathon-betting.ts              ← 44 Bankrun tests (all passing)
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
| 1 | `initialize_hackathon` | Admin creates HackathonState PDA + USDC escrow token account. Rejects `results_timestamp` in the past. |
| 2 | `register_project`     | Creates ProjectAccount PDA. Accepts real GitHub URLs up to 200 chars. PDA seed uses SHA-256 hash of URL. Requires caller to pass `url_hash = SHA-256(github_url)`. |
| 3 | `stake`                | User deposits USDC to escrow, creates/updates UserStake PDA. Blocked after `results_timestamp`. |
| 4 | `unstake`              | Linear decay penalty (max 30%), returns remainder, penalty stays in pool. Blocked after `cutoff_timestamp`. **Blocked if hackathon is already resolved.** |
| 5 | `resolve`              | Admin sets rank on one ProjectAccount per call. **Blocked before `results_timestamp`.** |
| 6 | `finalize_resolve`     | Counts rest-tier projects, writes `rest_project_count`, sets `is_resolved = true`. **Blocked before `results_timestamp`.** |
| 7 | `claim`                | Computes payout via rank-weighted sqrt formula, transfers from escrow to user. Rejects if project rank is 0 (not yet ranked). Transfer executes before `is_claimed` flag is set (CEI order). |

---

## Account Structures

```rust
HackathonState {
    admin: Pubkey,
    usdc_mint: Pubkey,
    results_timestamp: i64,
    cutoff_timestamp: i64,      // = results_timestamp - 86400
    total_pool: u64,
    is_resolved: bool,
    judge_weights: [u8; 4],     // [55, 30, 10, 5]
    rest_project_count: u16,    // written by finalize_resolve
    bump: u8,
    escrow_bump: u8,
}

ProjectAccount {
    hackathon: Pubkey,
    github_url: String,         // max 200 chars (stored in full; only hash used as PDA seed)
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

---

## PDA Seeds

| Account             | Seeds |
|---------------------|-------|
| HackathonState      | `["hackathon", admin_pubkey]` |
| Escrow (token acct) | `["escrow", hackathon_pubkey]` |
| ProjectAccount      | `["project", hackathon_pubkey, sha256(github_url)]` |
| UserStake           | `["stake", user_pubkey, project_pubkey]` |

> **Breaking change from v1:** The ProjectAccount seed was previously the raw URL bytes.
> It is now the 32-byte SHA-256 digest of the URL.  Any client code deriving this PDA
> must hash the URL first:
>
> ```typescript
> import { createHash } from "crypto";
> const urlHash = createHash("sha256").update(url).digest(); // 32-byte Buffer
> const [projectPda] = PublicKey.findProgramAddressSync(
>   [Buffer.from("project"), hackathon.toBuffer(), urlHash], PROGRAM_ID);
> ```
>
> The `register_project` instruction now takes two arguments: `github_url: String`
> and `url_hash: [u8; 32]`.  The program verifies on-chain that `SHA-256(github_url) == url_hash`.

---

## Instruction Signatures

### Changed in this release

```rust
// register_project — now takes url_hash as second argument
pub fn register_project(
    ctx: Context<RegisterProject>,
    github_url: String,
    url_hash: [u8; 32],
) -> Result<()>
```

All other instruction signatures are unchanged.

---

## Error Codes (full list)

| Error              | Code | Description |
|--------------------|------|-------------|
| `CutoffPassed`     | 6000 | Unstaking after the 24-hour cutoff window |
| `StakingClosed`    | 6001 | Staking after results_timestamp |
| `NotResolved`      | 6002 | Hackathon not yet resolved (or project rank = 0) |
| `AlreadyResolved`  | 6003 | Operation not allowed after finalize_resolve |
| `AlreadyClaimed`   | 6004 | Payout already claimed |
| `StakeCapExceeded` | 6005 | Over 1,000,000,000 units per wallet per project |
| `UrlTooLong`       | 6006 | github_url exceeds 200 characters |
| `InvalidRank`      | 6007 | Rank must be ≥ 1 |
| `ZeroAmount`       | 6008 | Amount must be > 0 |
| `Overflow`         | 6009 | Arithmetic overflow |
| `ResultsNotYet`    | 6010 | results_timestamp has not arrived (resolve/finalize too early) |
| `InvalidTimestamp` | 6011 | results_timestamp must be in the future (initialize_hackathon) |
| `InvalidUrlHash`   | 6012 | url_hash ≠ SHA-256(github_url) |

---

## Payout Formula (on-chain, integer math only — no f64)

```
S_i          = total USDC staked on project i
C_i          = isqrt(S_i)                        // crowding adjustment (Newton isqrt)
J_i          = judge weight for rank:
                 rank 1 → 55
                 rank 2 → 30
                 rank 3 → 10
                 rank 4+ → 5 / N_rest (shared, not per-project)
R_i_scaled   = J_i × C_i × rest_project_count   // scaled to avoid fractions
R_total_scaled = sum of all R_i_scaled (over resolved projects only)
payout       = (stake × R_claim × T) / (S_i × R_total_scaled)
```

Scale factor `rest_project_count` (rpc) is applied uniformly so integer division
works without floating point.  When `rpc = 0` (all projects ranked 1–3), `max(rpc, 1) = 1`
is used — tested and verified.

---

## Mechanism Constants

```
MAX_STAKE_PER_WALLET_PER_PROJECT = 1_000_000_000  (USDC smallest units)
MAX_PENALTY_BPS                  = 3_000           (30%)
BPS_DENOM                        = 10_000
SELL_CUTOFF_BEFORE_RESULTS       = 86_400          (24 hours)
JUDGE_WEIGHTS                    = [55, 30, 10, 5]
```

---

## Test Results (Step 5 + 6 + fixes)

**44 tests, 0 failing**

### Core payout test cases
| # | Scenario | Key assertion |
|---|----------|---------------|
| TC1 | All funds on rank-1 winner, single project | Payout = full pool |
| TC2 | All funds on rank-4+ loser, single project | Payout = full pool (only participant) |
| TC3a | 5 projects ranks 1–5, equal stakes | Sum of payouts = pool (symmetric, no dust) |
| TC3b | 5 projects ranks 1–5, asymmetric stakes | Sum of payouts ≤ pool (dust ≤ 5 lamports) |
| TC4 | Sybil sim: 20 wallets × 1000 vs 1 whale × 20000 | Group total payout ≈ whale payout (±20 units max) |
| TC5 | Lightly-backed rank-1 vs crowded rank-2 | Rank-1 per-dollar return > rank-2 per-dollar return |

### Security / error-path tests
- FIX-1 (CEI): `is_claimed` set only after successful transfer
- FIX-2: `resolve` rejected before `results_timestamp`
- FIX-3: `unstake` rejected after `is_resolved = true`
- FIX-4: `initialize_hackathon` rejected with past timestamp
- FIX-5: Real GitHub URLs (>32 chars) accepted; URL > 200 chars rejected
- FIX-6: `r_scaled` uses `checked_mul` (overflow propagated as error)
- FIX-7: `claim` on unranked project (rank=0) rejected with `NotResolved`
- FIX-8: `rest_project_count = 0` path (all top-3 ranks) — payouts match formula
- FIX-10: Asymmetric-stake dust test (sum ≤ pool)
- FIX-11: Sybil group payout end-to-end assertion
- FIX-12: Claim on unresolved project → `NotResolved` error

---

## Step 6 CU Audit — VERDICT (unchanged from v1)

| Projects | Compute Units |
|----------|--------------|
| 5        | 20,448       |
| 10       | 24,918       |
| 20       | 34,124       |
| 50       | tx size exceeded (legacy packet limit) |

**No R_total snapshot optimization needed.** 34,124 CU at 20 projects is well
under the 200,000 CU threshold.

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
anchor deploy --provider.cluster devnet
```

### After deploy
1. Copy the new program ID from deploy output
2. Update `declare_id!("NEW_ID")` in `lib.rs`
3. Update `[programs.devnet]` in `Anchor.toml`
4. `anchor build` again to regenerate IDL with new program ID
5. Update `PROGRAM_ID` constant in `tests/hackathon-betting.ts`
6. Re-run `anchor test` to confirm all 44 tests still pass against the new binary

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
7. **IDL deploy** — `anchor idl init` to publish IDL on-chain after program deploy

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

1. **ProjectAccount PDA seed is SHA-256(github_url), not the raw URL.**  Real GitHub
   URLs are >32 bytes; Solana hard-rejects seeds >32 bytes.  The full URL is stored
   in `ProjectAccount.github_url` for display.  Any client deriving this PDA must
   hash the URL first (see PDA Seeds section above).

2. **`register_project` requires `url_hash` argument.**  The instruction accepts both
   `github_url: String` and `url_hash: [u8; 32]`.  On-chain, the program verifies
   `SHA-256(github_url) == url_hash` before accepting the account.  This prevents
   callers from registering an account under a hash that doesn't match the stored URL.

3. **`total_pool` is never decremented in `claim`** — T is fixed at resolution.
   All claimers use the same T.  Integer division dust stays in escrow (irrecoverable
   by design in MVP).  A future `sweep_dust` admin instruction can drain the remainder
   once all UserStakes are claimed.

4. **`hackathon` account is NOT writable in `claim`** — only `user_stake` and
   `escrow` are mutated.

5. **`finalize_resolve` must be called after all `resolve` calls** — it counts
   rest-tier projects and writes `rest_project_count`.  Claiming before
   `finalize_resolve` reverts with `NotResolved`.

6. **`resolve` and `finalize_resolve` are both time-gated** — they will fail with
   `ResultsNotYet` if called before `results_timestamp`.  This closes the
   insider-trading window where an admin could lock in results while staking was
   still open.

7. **`unstake` is blocked after `finalize_resolve`** — after `is_resolved = true`,
   `total_pool` is locked.  Attempting to unstake after resolution reverts with
   `AlreadyResolved`.

---

## Known Constraints

### ALT requirement at N ≈ 35 projects
Legacy Solana transactions cap at 1,232 bytes.  At ~35 projects, account keys alone
(35 × 32 bytes) leave no room for instruction data.  Clients calling `claim` with
>~35 `remaining_accounts` must construct an **Address Lookup Table (ALT)**:

```typescript
// Pseudocode — ALT construction
const [lookupTableIx, lookupTableAddress] =
  AddressLookupTableProgram.createLookupTable({ authority, payer, recentSlot });
const extendIx = AddressLookupTableProgram.extendLookupTable({
  paddresses: allProjectPubkeys,
  lookupTable: lookupTableAddress,
  authority, payer,
});
// Then use VersionedTransaction with MessageV0 + ALT for the claim call.
```

This is a first-class client-side integration requirement at scale.

### Anchor.toml program ID
Currently both `[programs.localnet]` and `[programs.devnet]` share the localnet
program ID.  First `anchor deploy` will generate a new on-chain address.
Update `declare_id!`, `Anchor.toml`, and the `PROGRAM_ID` constant in tests
immediately after the first deploy output is known.
