# HackBet Frontend — Claude Code Context

## Stack
Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · `@coral-xyz/anchor` 0.31.x · Supabase

Read `node_modules/next/dist/docs/` before using any Next.js API — this version may differ from training data.

## Constants to know
- `PROGRAM_ID`: `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd` (mainnet)
- `PROTOCOL_ADMIN` / `DEPLOYER`: `Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD` — same wallet; BPF upgrade authority, super-admin, can access Admin + Master panels
- `USDC_MINT` (mainnet): `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

All constants live in `lib/constants.ts`.

## Pages
| Route | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Landing — hackathon list, project explorer, stake UI |
| `/hackathon/[id]` | `app/hackathon/[id]/page.tsx` | Hackathon detail — project cards, leaderboard, claim |
| `/admin` | `app/admin/page.tsx` | Organizer panel — Create, Manage, Resolve tabs (protocol admin or assigned hackathon admin) |
| `/admin/guide` | `app/admin/guide/page.tsx` | Admin how-to guide (static, admin-gated) |
| `/admin/advanced` | `app/admin/advanced/page.tsx` | Advanced deposit overrides + whitelist + submissions (off-chain wallet whitelist gate via `advanced_panel_access` Supabase table) |
| `/master` | `app/master/page.tsx` | Upgrade authority panel (DEPLOYER only) |
| `/dev` | `app/dev/page.tsx` | Builder portal |

## API Routes
| Route | Method | Description |
|---|---|---|
| `/api/whitelist-request` | POST | Creates a wallet-signed request for staking access. |
| `/api/github-stats?url=` | GET | Fetches GitHub repo stats (last commit, 7-day commits). Cached 1 hour in Supabase `github_stats`. Falls back to stale cache on GitHub rate-limit. |
| `/api/project-submission` | POST | Creates or refreshes a builder-submitted project review request, including social metadata for later approval sync. |
| `/api/admin/project-submissions` | GET / POST | Admin review queue for project submissions. |
| `/api/admin/whitelist-requests` | GET / POST | Admin review queue for staking-access requests. |
| `/api/admin/advanced-access` | GET / POST / DELETE | Advanced panel wallet whitelist. GET is public; POST/DELETE require super-admin session signature. Backed by Supabase `advanced_panel_access` table. |

## Hooks
All hooks are in `hooks/`:
- `useHackathons` — fetches all `HackathonState` PDAs on-chain
- `useProjects(hackathon)` — fetches all `ProjectAccount` PDAs for a hackathon
- `useUserStake(user, project)` — fetches single `UserStake` PDA
- `useWhitelistStatus(hackathon, wallet)` — checks `WhitelistedWallet` PDA existence
- `useHackathonMeta(pubkey)` — Supabase off-chain name/icon metadata
- `useIsProtocolAdmin` — returns whether connected wallet is the super-admin or has a `ProtocolAdminEntry` PDA
- `useTheme` — dark/light mode toggle (persisted in localStorage)

## Off-chain (Supabase)
Six tables: `hackathon_metadata` (name/icon/link), `project_metadata` (socials), `github_stats` (commit cache), `project_submissions` (builder review queue), `whitelist_requests` (staking access requests), and `advanced_panel_access` (wallets allowed to use `/admin/advanced`).
Supabase client lives in `lib/supabase.ts`. Server-side routes use `getSupabaseAdmin()` (requires `SUPABASE_SERVICE_ROLE_KEY`).
`advanced_panel_access` has public SELECT, service-role-only INSERT/DELETE. The GET `/api/admin/advanced-access` is public; mutations require a super-admin signed session.

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
