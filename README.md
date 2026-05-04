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

**Tiers matter.** The organizer sets prize splits (e.g. 55% to 1st place, 30% to 2nd, 15% to 3rd). If a tier has no winner, its share gets redistributed to tiers that do.

**Crowd size is compressed.** A project with $10,000 staked doesn't earn 10× more than one with $1,000. The formula uses square roots — $10,000 → weight of 100, $1,000 → weight of ~32. That's about 3×, not 10×. Early backers of underrated projects are protected from being drowned out by whale money.

**You earn proportional to your conviction.** Within a project, your payout is your share of the total shares on that project. Stake more, stake earlier → more shares → larger slice.

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
