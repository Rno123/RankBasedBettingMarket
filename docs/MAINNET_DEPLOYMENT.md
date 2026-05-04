# HackBet Mainnet Deployment Plan

**Target: Solana Mainnet-Beta**
**Date: May 2026**
**Cap: $250 USDC per wallet per project**

---

## 1. Pre-Deployment Checklist

### 1.1 Program Changes Since Devnet

- [x] Wallet cap: $2,000 → $250 (`MAX_STAKE_PER_WALLET = 250_000_000`)
- [x] Self-stake cap: $2,000 → $250 (`MAX_SELF_STAKE = 250_000_000`)
- [x] `forfeit_deposit` gate: `!submitted` only (removed `builder_declared` check)
- [x] Frontend cap labels updated to `$250 USDC`
- [x] Frontend constants match on-chain constants
- [x] TypeScript clean, Rust compiles

### 1.2 Constants to Update

In `frontend/lib/constants.ts`:

```typescript
// Change these three lines for mainnet:
export const PROGRAM_ID = new PublicKey("<MAINNET_PROGRAM_ID>");
export const RPC_URL = "https://<chainstack-or-helius-endpoint>";
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
```

In `hackathon-betting/programs/hackathon-betting/src/lib.rs`:

```rust
// Update PROGRAM_ID via anchor build (generates new keypair)
// PROTOCOL_ADMIN stays the same (multisig or hardware wallet)
declare_id!("<MAINNET_PROGRAM_ID>");

// Verify mainnet USDC mint is correct:
// EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

### 1.3 Pre-Launch Verification

- [ ] Deploy to mainnet with a test hackathon (short results window, 1 project)
- [ ] Run full smoke test: stake → unstake → restake → wait cutoff → resolve → claim
- [ ] Run deposit flow: register → pay_deposit → submit_project → approve → claim_deposit_refund
- [ ] Run forfeit flow: register → pay_deposit → wait grace period → forfeit
- [ ] Verify CU consumption matches devnet (18K flat for claim)
- [ ] Verify all error codes return correct messages
- [ ] Verify Supabase mainnet project is configured with correct RLS policies

---

## 2. RPC Infrastructure

### 2.1 Provider

Use Chainstack or Helius for mainnet RPC. Devnet `api.devnet.solana.com` rate-limits aggressively.

```
NEXT_PUBLIC_RPC_URL=https://<provider-endpoint>
```

Requirements:
- Supports `getProgramAccounts` with `memcmp` filters (used by `useProjects`, `useHackathons`, `fetchUserStakeAccountsForWallet`)
- Minimum 25 requests/second
- WebSocket support for `connection.confirmTransaction`

### 2.2 Fallback

The frontend currently uses a single RPC endpoint. Consider adding a fallback array in `getConnection()`:

```typescript
const RPCS = [process.env.NEXT_PUBLIC_RPC_URL, "https://api.mainnet-beta.solana.com"];
```

---

## 3. Program Deployment

### 3.1 Key Management

| Key | Purpose | Storage |
|-----|---------|---------|
| Program keypair | `anchor deploy` signer | Hardware wallet or air-gapped |
| PROTOCOL_ADMIN | `initialize_hackathon`, `add_protocol_admin` | Ledger / multisig |
| DEPLOYER | BPF upgrade authority | Separate from PROTOCOL_ADMIN |
| Fee recipient | Receives protocol fees | Cold wallet or multisig |

### 3.2 Deploy Steps

```bash
# 1. Build with release profile
anchor build -- --features testing  # verify tests pass locally
anchor build                        # release build

# 2. Deploy to mainnet
solana config set --url mainnet-beta
anchor deploy --program-name hackathon_betting

# 3. Note the new PROGRAM_ID and update:
#    - lib.rs declare_id!
#    - frontend/lib/constants.ts PROGRAM_ID
#    - Anchor.toml [programs.mainnet]

# 4. Rebuild with correct PROGRAM_ID and redeploy
anchor build
anchor upgrade <PROGRAM_ID> --program-name hackathon_betting
```

### 3.3 Post-Deploy

- [ ] Verify program is deployed: `solana program show <PROGRAM_ID>`
- [ ] Verify upgrade authority is DEPLOYER key
- [ ] Run smoke test with a real USDC transaction
- [ ] Consider calling `revoke_upgrade_authority` after audit and stability (IRREVERSIBLE)

---

## 4. Supabase Setup

### 4.1 Mainnet Project

Create a separate Supabase project for mainnet (do not share with devnet). Run all migrations:

```bash
# Apply migrations in order:
supabase/migrations/20260428_non_destructive_rls_and_metadata_sync.sql
supabase/migrations/20260429_fix_rls_security.sql
supabase/migrations/20260429_project_submissions_schema_reconcile.sql
supabase/migrations/20260430_project_name_capture.sql
```

### 4.2 Environment Variables

```
SUPABASE_URL=<mainnet-project-url>
SUPABASE_ANON_KEY=<mainnet-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<mainnet-service-role-key>
ADMIN_SESSION_SECRET=<random-64-char-string>
```

### 4.3 RLS Policies

Verify Row-Level Security on all tables:
- `hackathon_metadata`: public read, admin write
- `project_metadata`: public read, admin write
- `project_submissions`: public insert, admin read/write
- `whitelist_requests`: public insert, admin read/write
- `github_stats`: public read, server write

---

## 5. Frontend Deployment

### 5.1 Vercel

```bash
cd frontend
vercel --prod
```

### 5.2 Environment Variables on Vercel

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_RPC_URL` | Mainnet RPC endpoint |
| `NEXT_PUBLIC_SUPABASE_URL` | Mainnet Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Mainnet Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Mainnet Supabase service role key |
| `ADMIN_SESSION_SECRET` | Random 64-char string for cookie signing |

### 5.3 Post-Deploy Verification

- [ ] Landing page loads, hackathons list populates
- [ ] Wallet connection works (Phantom, Backpack, Solflare)
- [ ] Stake flow: user can stake USDC, transaction confirms
- [ ] Admin panel: PROTOCOL_ADMIN can create hackathons
- [ ] Whitelist flow: request → approve → stake works (open_staking=false)
- [ ] Claim flow: resolved hackathon shows claim button, payout transfers
- [ ] GitHub stats API returns data (not rate-limited)
- [ ] Mobile responsive on iOS Safari + Chrome Android

---

## 6. Launch Sequence

### 6.1 Soft Launch (Week 1)

1. Deploy program, frontend, Supabase
2. Create one small test hackathon (24h window, 1 project, $10 deposit)
3. Have 2-3 team members run through every flow
4. Monitor RPC health, Supabase errors, transaction success rate
5. Keep `open_staking = false` and whitelist testers manually

### 6.2 Public Launch (Week 2)

1. Enable `open_staking = true` on the production hackathon
2. Announce on social channels
3. Monitor: escrow balance, transaction volume, error rates
4. Have admin panel open during first 24h for whitelist support

### 6.3 Ongoing

- Monitor protocol fee accumulation in fee_recipient wallet
- Run `forfeit_deposit` on ghost builders after the 14-day grace period
- Consider calling `revoke_upgrade_authority` after 3 months of stable operation

---

## 7. Emergency Procedures

### 7.1 Critical Bug Found

1. If staking is open: call `enable_refund` on all projects, then have users `refund()`
2. If bug is in `claim`: DO NOT call `finalize_resolve` — keep `is_resolved = false` until fixed
3. If bug is in `finalize_resolve`: the program can be upgraded (BPF upgrade authority still held)
4. If upgrade authority is revoked: funds are permanently locked — audit thoroughly before revoking

### 7.2 RPC Outage

- The frontend gracefully shows errors when RPC is unavailable
- Users can still interact with the program via any Solana block explorer
- Consider maintaining a backup RPC endpoint from a different provider

### 7.3 Supabase Outage

- Core protocol functions (stake, claim, resolve) are entirely on-chain and unaffected
- Off-chain features affected: metadata display, GitHub stats, admin review queue
- Whitelist requests can be done manually by the admin via CLI if needed

---

## 8. Future Upgrades

### 8.1 Merkle-Based Submission Verification

Replace per-account `submitted` flag writes with a single Merkle root stored on `HackathonState`. Builders submit Merkle proofs to claim deposits. Reduces admin costs from O(n) to O(1).

### 8.2 Twitter Analytics Integration

Score projects by Twitter engagement (followers, impressions, velocity) and surface in the UI as a secondary signal alongside stake amounts.

### 8.3 On-Chain Milestones (Phased Payouts)

Split builder deposits across multiple milestone deadlines. Builders claim portions as they hit each milestone, with organizer verification at each stage.

---

*Plan version: 1.0 — May 2026*
