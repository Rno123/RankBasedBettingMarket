# HackBet Frontend — Claude Code Context

## Stack
Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · `@coral-xyz/anchor` 0.31.x · Supabase

Read `node_modules/next/dist/docs/` before using any Next.js API — this version may differ from training data.

## Constants to know
- `PROGRAM_ID`: `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd` (devnet)
- `PROTOCOL_ADMIN`: `5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP` — only this wallet can initialize hackathons or whitelist stakers
- `DEPLOYER`: `Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD` — BPF upgrade authority; can access Admin + Master panels
- `USDC_MINT` (devnet): `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`

All constants live in `lib/constants.ts`. When switching to mainnet, update `PROGRAM_ID`, `RPC_URL`, and `USDC_MINT` there.

## Pages
| Route | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Landing — hackathon list, project explorer, stake UI |
| `/hackathon/[id]` | `app/hackathon/[id]/page.tsx` | Hackathon detail — project cards, leaderboard, claim |
| `/admin` | `app/admin/page.tsx` | Admin panel (PROTOCOL_ADMIN or DEPLOYER only) |
| `/master` | `app/master/page.tsx` | Upgrade authority panel (DEPLOYER only) |
| `/dev` | `app/dev/page.tsx` | Dev utilities |

## API Routes
| Route | Method | Description |
|---|---|---|
| `/api/github-stats?url=` | GET | Fetches GitHub repo stats (last commit, 7-day commits). Cached 1 hour in Supabase `github_stats`. Falls back to stale cache on GitHub rate-limit. |
| `/api/project-metadata` | POST | Upsert project social metadata (Twitter, Telegram, Discord). Requires wallet signature on `hackbet:register:<projectPubkey>`. First-claimer ownership model. |

## Hooks
All hooks are in `hooks/`:
- `useHackathons` — fetches all `HackathonState` PDAs on-chain
- `useProjects(hackathon)` — fetches all `ProjectAccount` PDAs for a hackathon
- `useUserStake(user, project)` — fetches single `UserStake` PDA
- `useWhitelistStatus(hackathon, wallet)` — checks `WhitelistedWallet` PDA existence
- `useHackathonMeta(pubkey)` — Supabase off-chain name/icon metadata
- `useIsProtocolAdmin` — returns whether connected wallet is PROTOCOL_ADMIN or DEPLOYER
- `useTheme` — dark/light mode toggle (persisted in localStorage)

## Off-chain (Supabase)
Three tables: `hackathon_metadata` (name/icon), `project_metadata` (socials), `github_stats` (commit cache).
Supabase client lives in `lib/supabase.ts`. Server-side routes use `getSupabaseAdmin()` (requires `SUPABASE_SERVICE_ROLE_KEY`).

## IDL
Two copies exist: `lib/hackathon_betting.json` (canonical) and `lib/idl.json` (alias). After any on-chain rebuild, replace both with the new `target/idl/hackathon_betting.json`.

## PDA derivation
All PDA helpers are in `lib/pda.ts`. Use these instead of re-deriving inline.

## Program interaction
`lib/program.ts` exports `getProgram(connection, wallet)` — the Anchor `Program` instance. Always use this rather than constructing Program directly.

## Rules
- No `f64` in on-chain math — all amounts in smallest USDC units (6 decimals = 1 USDC = 1_000_000)
- Token display: always divide by `10 ** TOKEN_DECIMALS` before showing to users
- When adding a new page that calls admin instructions, gate it with `useIsProtocolAdmin`
