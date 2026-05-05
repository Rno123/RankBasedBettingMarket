# HackBet

Back hackathon projects with conviction. Stake USDC on the projects you believe in. When judges announce results, backers of winning projects share the pool.

**[hackbet.vercel.app](https://hackbet.vercel.app)** · Solana Mainnet · Program `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`

---

## What is this?

Hackathons have judges. The crowd has opinions. HackBet connects the two.

Before results are announced, anyone can stake USDC on projects they think will win. When judges reveal rankings, the total pool is split among backers of winning projects — weighted by how much conviction each project attracted and how early each backer joined.

It's not a betting market with odds. It's a **conviction signal**: the crowd commits real money, and winners get rewarded for spotting quality early.

---

## How it works

### For backers

1. **Browse** active hackathons and their projects
2. **Stake** USDC (up to $250 per project) on the ones you believe in
3. **Wait** for the hackathon deadline and judge results
4. **Claim** your share of the pool if your projects placed

The earlier you stake, the more shares you earn per dollar — from **1.5× at open** down to **1.0× at cutoff** (24 hours before results). Early conviction is rewarded.

### For builders

1. **Register** your GitHub repo and project details
2. **Pay** a small commitment deposit ($10 USDC) to activate staking on your project
3. **Mark submitted** before the deadline to lock in your deposit refund
4. **Claim your deposit** back after results if you submitted your project

Builders can also **self-stake** on their own project (up to $250) to signal confidence. That stake participates in payouts just like any other backer's.

### Early exit

If you change your mind before the cutoff, you can unstake with a flat **3% penalty** — half goes to the protocol, half stays in the pool for remaining backers. After cutoff, all positions are locked.

---

## Key numbers

| What | Value |
|------|-------|
| Max stake per project | $250 USDC |
| Builder deposit | $10 USDC |
| Early multiplier | 1.5× → 1.0× (decays to cutoff) |
| Unstake penalty | 3% (flat) |
| Protocol fee on payouts | 1.5% |
| Cutoff before results | 24 hours |
| Deposit refund window | 14 days after results |

---

## The math (in plain English)

**Tiers use per-project slots.** The organizer sets prize splits and an expected project count per tier (e.g. tier 0 = "top 3 projects, 60% of pool" → each slot draws 20%). If fewer projects fill a tier than expected, the unused slots' share cascades to the other occupied tiers.

**Equal project allocation within each tier.** Every ranked project in a tier draws the same fixed bps regardless of how much was staked in it. Two projects tied in a tier both get the same slice of that tier's pool. A project backed by $100 earns the same tier allocation as one backed by $10,000 — the pool just spreads thinner among its stakers. This means finding a quality project that others overlooked is more valuable than piling into a consensus pick.

**Within a project, shares determine your cut.** Stake more, stake earlier → more shares → larger slice of your project's allocation.

**Worked example.** Tier 1 allocates 30% of a $20,000 pool and expects 2 projects. Each project draws 15% = $3,000. Project B has one backer with $100 staked; Project C has one backer with $10,000 staked. Both backers receive $3,000 pre-fee — the project backing $100 earns 30× return, the one backing $10,000 loses 70%.

---

## Tech stack

**On-chain:** Solana · Anchor 0.31 · SPL Token (USDC)  
**Frontend:** Next.js 16 · React 19 · Tailwind CSS v4  
**Off-chain:** Supabase (metadata, GitHub stats, submission queue)

---

## Architecture

```
Frontend (Vercel)
    │
    ├── Anchor client + wallet adapter
    │
    ▼
Solana Program ─── HackathonState, ProjectAccount, UserStake PDAs
    │                  Escrow token account (holds all staked USDC)
    │
    ▼
Mainnet USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)

Supabase ─── hackathon_metadata · project_metadata · github_stats
```

---

## Security

- All staked USDC is held in a PDA-controlled escrow — only the program can release it
- Payout denominators are snapshotted at finalization, preventing manipulation by claimers
- Finalization is irreversible — once results are locked, no further changes are possible
- All math uses integer arithmetic (no floating point on-chain)
- Supabase private data (emails) is behind service-role API routes, never exposed to the client

---

## Roadmap

- [ ] Merkle-tree project approval (off-chain verification, on-chain inclusion proof)
- [ ] Twitter/X analytics integration for builder profiles
- [ ] On-chain milestone tracking for phased builder payouts
- [ ] Address Lookup Tables for hackathons with 35+ projects

---

## License

MIT
