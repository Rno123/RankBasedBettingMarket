# RankBasedBettingMarket — Protocol Fixes Required
## Context for new conversation: fix all issues before devnet deploy

Steps 1–6 are complete (39 Bankrun tests passing). A technical audit surfaced the issues
below. Fix them in priority order before proceeding to Step 7 (devnet deploy).
All code is in `hackathon-betting/programs/hackathon-betting/src/lib.rs`.
Tests are in `hackathon-betting/tests/hackathon-betting.ts`.
Branch: `claude/start-step-1-hGwJW`

---

## CRITICAL — Fix first (fund-loss / exploitable)

### FIX-1: CEI violation in `claim` — `is_claimed` set before token transfer
`is_claimed = true` is written before the SPL CPI transfer fires. If the transfer
fails, the user's flag is permanently set and they can never recover their payout.

**Fix:** Move `ctx.accounts.user_stake.is_claimed = true;` to AFTER the
`token::transfer(...)` CPI call succeeds.

---

### FIX-2: `resolve` / `finalize_resolve` have no time-window guard
Both can be called at any time — including while staking is still open. An admin
can lock in results, let insiders stake on the known winner, then finalize.

**Fix:** Add to both instruction handlers:
```rust
let now = Clock::get()?.unix_timestamp;
require!(now >= hackathon.results_timestamp, BettingError::ResultsNotYet);
```
Add `ResultsNotYet` error variant.

---

### FIX-3: `unstake` allowed after `is_resolved = true`
After `finalize_resolve` sets `is_resolved = true` and locks `total_pool`, a user
can still unstake. This decrements `total_pool` and `project.total_staked`, breaking
the payout formula for all remaining claimers (T is no longer fixed).

**Fix:** Add constraint to the `Unstake` account context:
```rust
#[account(constraint = !hackathon.is_resolved @ BettingError::AlreadyResolved)]
pub hackathon: Account<'info, HackathonState>,
```

---

### FIX-4: `results_timestamp` not validated as future on init
`initialize_hackathon` accepts any `i64`. Passing a past timestamp makes the
cutoff negative and immediately bricks staking.

**Fix:** Add to `initialize_hackathon` handler:
```rust
let now = Clock::get()?.unix_timestamp;
require!(results_timestamp > now, BettingError::InvalidTimestamp);
```
Add `InvalidTimestamp` error variant.

---

## BROKEN BY DESIGN — Fix before any real usage

### FIX-5: GitHub URL PDA seed broken for real URLs (DESIGN CHANGE REQUIRED)
Solana's `findProgramAddressSync` hard-rejects seeds > 32 bytes. Every real GitHub
URL (`https://github.com/owner/repo`) is > 32 bytes. The SDK throws
`TypeError: Max seed length exceeded` before the program runs. The existing
`UrlTooLong` (200-char) error is dead code — unreachable.

**Fix:** Hash the URL for the PDA seed; store full URL in account data only.

In `lib.rs` — change the `project` PDA seed from the raw URL bytes to a
32-byte SHA-256 hash of the URL:
```rust
// New seed: ["project", hackathon, sha256(github_url)[..32]]
seeds = [b"project", hackathon.key().as_ref(), &anchor_lang::solana_program::hash::hash(github_url.as_bytes()).to_bytes()]
```
Keep `github_url` stored as a `String` field in `ProjectAccount` (already there).
Update the TypeScript client and tests to pre-hash the URL before deriving the PDA.
Raise the URL length limit from 32 to 200 bytes (as originally specced).
The `UrlTooLong` check becomes reachable and correct.

---

### FIX-6: `r_scaled()` uses `saturating_mul` — silent overflow corruption
At high stake amounts + high `rest_project_count`, `55 * C_i * rpc` can exceed
`u64::MAX`. `saturating_mul` silently caps at `u64::MAX` instead of erroring,
distributing the pool with corrupted weights.

**Fix:** Replace all `saturating_mul` calls in `r_scaled()` with `checked_mul`:
```rust
fn r_scaled(rank: u8, c_i: u64, rest_project_count: u16) -> Result<u64> {
    let rpc = rest_project_count.max(1) as u64;
    let result = match rank {
        1 => 55_u64.checked_mul(c_i).and_then(|v| v.checked_mul(rpc)),
        2 => 30_u64.checked_mul(c_i).and_then(|v| v.checked_mul(rpc)),
        3 => 10_u64.checked_mul(c_i).and_then(|v| v.checked_mul(rpc)),
        _ =>  5_u64.checked_mul(c_i),
    };
    result.ok_or(error!(BettingError::Overflow))
}
```
Propagate the `Result` through the caller.

---

### FIX-7: Rank 0 (unresolved project) silently treated as rest-tier in `claim`
The `_` match arm in `r_scaled` catches rank `0` (never resolved). An unresolved
project participates in `R_total` computation and can receive payouts at rest-tier
weight. This is undefined behavior per spec.

**Fix:** Add a guard in the `claim` handler before computing `r_claim`:
```rust
require!(ctx.accounts.project.rank > 0, BettingError::NotResolved);
```
Also add a guard in the `R_total` loop inside `claim` — skip any project with rank 0.

---

## PAYOUT MATH — Fix for correctness

### FIX-8: Add test coverage for `rest_project_count = 0` path
When all projects rank 1–3, `finalize_resolve` sets `rest_project_count = 0`.
`claim` then uses `rpc.max(1) = 1`. This is mathematically correct but completely
untested. One wrong edit (e.g. `max(0)`) silently breaks the formula.

**Fix:** Add a dedicated Bankrun test: initialize hackathon, register 3 projects,
resolve with ranks [1, 2, 3], `finalize_resolve`, verify `rest_project_count == 0`,
claim all three, verify payouts match formula at `rpc=1`.

---

### FIX-9: Dust in escrow — no sweep mechanism
Integer division in `claim` leaves at most a few lamports permanently in escrow.
For correctness at protocol wind-down, an admin-callable `sweep_dust` instruction
should exist.

**Fix (optional for MVP, required for production):** Add `sweep_dust` instruction:
admin-only, callable only after all registered UserStakes are `is_claimed = true`,
transfers remaining escrow balance to admin. Or: document explicitly that dust
is irrecoverable by design.

---

## TEST SUITE — Fix for honest coverage

### FIX-10: TC3 "zero dust" assertion is an accident of symmetric inputs
The test uses equal stakes (1000 each) so `R_total` divides evenly and dust is zero.
The assertion is presented as a design guarantee. It is not.

**Fix:** Add a second TC3 variant with asymmetric stakes (e.g. [900, 1100, 950,
1050, 1000]) and assert `sum_of_payouts <= pool` (≤, not ==). Document why exact
equality only holds for symmetric inputs.

---

### FIX-11: TC4 (Sybil) never verifies equal final payouts
TC4 checks that crowding factors are identical (`isqrt(20_000) == isqrt(20_000)`).
It does NOT assert that the on-chain payout to the 20-wallet group equals the
payout to the whale. The core Sybil-resistance claim is unverified end-to-end.

**Fix:** After both sides claim, assert:
```typescript
assert.equal(sybilGroupTotalPayout, whalePayout,
  "20-wallet split receives same payout as single whale");
```

---

### FIX-12: Missing test for claiming on unresolved project (rank = 0)
No test exercises calling `claim` when `project.rank == 0`. After FIX-7 adds the
guard, this test is needed to confirm the guard works.

**Fix:** Add error-path test: register + stake on project, skip `resolve`,
call `finalize_resolve`, attempt `claim` → expect `NotResolved`.

---

## KNOWN CONSTRAINTS (document, don't necessarily fix for MVP)

### ALT requirement at N ≈ 35 projects
Legacy Solana transactions cap at 1,232 bytes. At ~35 projects, account keys alone
(35 × 32 = 1,120 bytes) leave no room for the instruction data. Clients calling
`claim` with > ~35 remaining_accounts must construct an Address Lookup Table.
This is a first-class integration requirement, not a client footnote.

**Document in README and DEPLOYMENT_CONTEXT.md:** State the hard limit,
provide a reference ALT construction snippet in the client code.

---

### `Anchor.toml` program ID — must update after devnet deploy
Currently both `[programs.localnet]` and `[programs.devnet]` share the localnet
program ID `81k4nRYTKkAJmd5Fm9uKktYR82xLUNq4qAiYbuL7RP1o`. First `anchor deploy`
to devnet will generate a new on-chain address (unless the deploy keypair is held).
Update `declare_id!`, `Anchor.toml`, and the `PROGRAM_ID` constant in tests
immediately after the first deploy output is known.

---

## Fix Order

| Priority | Fix | File |
|----------|-----|------|
| 1 | FIX-1: CEI violation in claim | lib.rs |
| 2 | FIX-2: Time-window guard on resolve/finalize_resolve | lib.rs |
| 3 | FIX-3: Unstake blocked after is_resolved | lib.rs |
| 4 | FIX-4: Validate results_timestamp > now | lib.rs |
| 5 | FIX-5: URL hashing for PDA seed | lib.rs + tests |
| 6 | FIX-6: checked_mul in r_scaled | lib.rs |
| 7 | FIX-7: Rank 0 guard in claim | lib.rs |
| 8 | FIX-10: TC3 asymmetric dust test | tests |
| 9 | FIX-11: TC4 equal-payout assertion | tests |
| 10 | FIX-12: Rank-0 claim error test | tests |
| 11 | FIX-8: rest_project_count=0 test | tests |
| 12 | FIX-9: Dust sweep (or document) | lib.rs or docs |

Each fix must compile and pass all 39 existing tests before the next fix begins.
After all fixes: re-run CU audit, update DEPLOYMENT_CONTEXT.md, then proceed to
Step 7 devnet deploy.
