# How to use
## HackBet is an on-chain conviction signal market for hackathons. Builders submit projects to existing hackathons, stakers back who they think will win, and after judging, the crowd's prediction is permanently visible on-chain alongside the official results.

### How it works

1 Hackathon created on-chain
Hackathons are initialized with a name, results date, prize tiers, and a builder deposit amount.

2 Builders register, stakers back
Builders must submit their GitHub repo URL — this creates an on-chain project PDA. Whitelisted stakers browse projects and lock in USDC. Earlier stakers earn a higher share multiplier (1.5× at project registration → 1.0× at cutoff).

3 Staking locks 24h before results
Once the cutoff passes, no new stakes or unstakes are accepted. The pool is frozen.

4 Results published → claims open
The admin sets judge rankings on-chain and finalizes. Stakers who backed winners claim payouts. Builders who've submitted claim their deposits.
