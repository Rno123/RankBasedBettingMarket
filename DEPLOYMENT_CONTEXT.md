# RankBasedBettingMarket — Deployment Context
## New conversation starting point for Step 7: Devnet Deploy

---

## What Has Been Built (Steps 1–6 Complete)

A fully implemented and tested Solana/Anchor hackathon betting protocol.
All code lives in `/home/user/RankBasedBettingMarket/hackathon-betting/`.
Branch: `claude/start-step-1-hGwJW`

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
├── tests/hackathon-betting.ts              ← 39 Bankrun tests (all passing)
├── target/
│   ├── idl/hackathon_betting.json          ← IDL (must regenerate after deploy)
│   ├── types/hackathon_betting.ts          ← generated types
│   └── deploy/hackathon_betting.so         ← compiled binary (~354 KB)
├── Anchor.toml                             ← cluster = devnet after deploy
└── Cargo.toml
```

---

## Instructions Implemented

| # | Instruction          | Description |
|---|----------------------|-------------|
| 1 | `initialize_hackathon` | Admin creates HackathonState PDA + USDC escrow token account |
| 2 | `register_project`   | Creates ProjectAccount PDA (seed: `["project", hackathon, github_url]`) |
| 3 | `stake`              | User deposits USDC to escrow, creates/updates UserStake PDA |
| 4 | `unstake`            | Linear decay penalty (max 30%), returns remainder, penalty stays in pool |
| 5 | `resolve`            | Admin sets rank on one ProjectAccount per call |
| 6 | `finalize_resolve`   | Counts rest-tier projects, sets `rest_project_count`, marks `is_resolved = true` |
| 7 | `claim`              | Computes payout via rank-weighted sqrt formula, transfers from escrow to user |

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
    github_url: String,         // max 32 bytes (Solana PDA seed limit)
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

| Account      | Seeds |
|-------------|-------|
| HackathonState | `["hackathon", admin_pubkey]` |
| Escrow (token acct) | `["escrow", hackathon_pubkey]` |
| ProjectAccount | `["project", hackathon_pubkey, github_url_bytes]` |
| UserStake | `["stake", user_pubkey, project_pubkey]` |

---

## Payout Formula (on-chain, integer math only — no f64)

```
S_i          = total USDC staked on project i
C_i          = isqrt(S_i)                        // crowding adjustment
J_i          = judge weight for rank:
                 rank 1 → 55
                 rank 2 → 30
                 rank 3 → 10
                 rank 4+ → 5 / N_rest  (shared, not per-project)
R_i_scaled   = J_i × C_i × rest_project_count   // scaled to avoid fractions
R_total_scaled = sum of all R_i_scaled
payout       = (stake × R_claim × T) / (S_i × R_total_scaled)
```

Scale factor `rest_project_count` (rpc) is applied uniformly so integer
division works without floating point.

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

## Test Results (Step 5 + 6)

**39 tests, 0 failing**

Key test cases:
1. TC1 — All funds on rank-1 winner, single project
2. TC2 — All funds on rank-4+ loser, single project
3. TC3 — 5 projects ranks 1–5, equal stakes, zero dust (pool fully distributed)
4. TC4 — Sybil sim: 20 wallets × 1000 vs 1 whale × 20000 (sqrt neutralizes splitting)
5. TC5 — Lightly-backed rank-1 vs crowded rank-2 (per-dollar return advantage confirmed)

---

## Step 6 CU Audit — VERDICT

| Projects | Compute Units |
|----------|--------------|
| 5        | 20,448       |
| 10       | 24,918       |
| 20       | **34,124**   |
| 50       | tx size exceeded (legacy packet limit) |

**No R_total snapshot optimization needed.** 34,124 CU at 20 projects is well
under the 200,000 CU threshold. The `claim` instruction's linear scan over
`remaining_accounts` is viable at expected hackathon scale.

At N ≈ 35+, the 50 account keys alone (50 × 32 = 1,600 bytes) exceed the
legacy transaction packet limit (1,232 bytes). Production clients at that
scale must use **Address Lookup Tables (ALTs)** — this is a client-side
concern, not a program change.

---

## Step 7: Devnet Deploy — What To Expect

### Pre-deploy checklist
- [ ] `anchor build` — confirm clean build
- [ ] Confirm `[programs.devnet]` in `Anchor.toml` has the right program ID
  (or use `anchor keys list` after first deploy to get real ID)
- [ ] Wallet with SOL for deploy (~2–3 SOL needed for rent + tx fees)
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

### Known likely issues
1. **Airdrop rate limits** — devnet faucet is unreliable; may need multiple attempts
   or use `solana airdrop` from CLI with retries
2. **Program ID mismatch** — if `declare_id!` doesn't match deployed ID, all
   instructions will fail with `DeclaredProgramIdMismatch`
3. **Devnet USDC** — need a real SPL mint on devnet. Options:
   - Use a known devnet USDC mint
   - Deploy your own mock SPL mint for testing
4. **RPC rate limits** — public devnet RPC throttles; may need Helius/QuickNode
   free tier URL
5. **Account not found errors** — escrow ATA must be initialized before first stake;
   `initialize_hackathon` handles this, but confirm the token account was created
6. **Blockhash expiry on slow deploys** — `--with-compute-unit-price` may help
   if transactions are dropped
7. **IDL deploy** — `anchor idl init` to publish IDL on-chain after program deploy

### Useful commands
```bash
solana config get                          # verify cluster/wallet
solana balance                             # check SOL
anchor keys list                           # show program keypair pubkey
anchor deploy --provider.cluster devnet   # deploy
anchor idl init --filepath target/idl/hackathon_betting.json <PROGRAM_ID>
solana confirm -v <TX_SIG>                 # inspect transaction
```

---

## Known Design Decisions / Gotchas

1. **GitHub URL max 32 bytes** (not 200) — Solana's `findProgramAddressSync`
   enforces a 32-byte max per seed. The program has a `UrlTooLong` error (200 chars)
   but it is unreachable because the SDK rejects first. Real production fix would
   be to hash the URL for the seed and store the full URL in the account data.

2. **`total_pool` is never decremented in `claim`** — T is fixed at resolution.
   All claimers use the same T. Integer division dust stays in escrow (never
   exceeds a few lamports).

3. **`hackathon` account is NOT writable in `claim`** — only `user_stake` and
   `escrow` are mutated.

4. **`finalize_resolve` must be called after all `resolve` calls** — it counts
   rest-tier projects and writes `rest_project_count` to HackathonState. Claiming
   before `finalize_resolve` will revert with `NotResolved`.

5. **`resolve` and `finalize_resolve` are separate instructions** — `resolve` sets
   rank on one project; `finalize_resolve` does the final tally and sets
   `is_resolved = true`. Call order matters.
