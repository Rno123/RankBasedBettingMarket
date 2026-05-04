# HackBet API & Smart Contract Reference

**Program ID (devnet):** `5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd`
**Network:** Solana (devnet → mainnet)
**Protocol Admin:** `5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP`
**Deployer:** `Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD`
**USDC Mint (devnet):** `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`

---

## Smart Contract Instructions

### 4.1 `initialize_hackathon`

| Field | Detail |
|-------|--------|
| **Auth** | Protocol admin (hardcoded or delegated via ProtocolAdminEntry PDA) |
| **PDAs created** | `HackathonState` at `[hackathon, admin, name]`, Escrow ATA at `[escrow, hackathon]` |
| **Params** | `name: String` (≤50 bytes), `results_timestamp: i64`, `tier_pcts: Vec<u8>` (sum=100, len 1–8), `tier_expected_counts: Vec<u8>` (len must match), `fee_recipient: Pubkey`, `protocol_fee_bps: u16` (≤3000), `deposit_amount: u64` (0 = no deposit), `requires_approval: bool`, `open_staking: bool` |
| **Constraints** | `results_timestamp > now + 86400`, `protocol_fee_bps <= 3000` |
| **Client** | `program.methods.initializeHackathon(name, resultsTimestamp, tierPcts, tierExpectedCounts, feeRecipient, protocolFeeBps, depositAmount, requiresApproval, openStaking).accounts({ admin, hackathon, escrow, usdcMint, tokenProgram, systemProgram }).remainingAccounts([protocolAdminPda])` |

### 4.2 `register_project`

| Field | Detail |
|-------|--------|
| **Auth** | If `requires_approval = true`: hackathon admin or protocol admin. If `false`: caller must equal `builder` |
| **PDAs created** | `ProjectAccount` at `[project, hackathon, sha256(github_url)]` |
| **Params** | `github_url: String` (≤200 chars), `url_hash: [u8; 32]` (must equal SHA-256 of url) |
| **Account constraints** | `project.hackathon == hackathon.key()` |
| **Client** | `program.methods.registerProject(githubUrl, urlHash).accounts({ caller, hackathon, builder, project, systemProgram })` |

### 4.3 `stake`

| Field | Detail |
|-------|--------|
| **Auth** | Any signer (whitelist-gated when `open_staking = false`) |
| **PDAs created** | `UserStake` at `[stake, user, project]` (init_if_needed) |
| **Params** | `amount: u64` (>0, existing + amount ≤ MAX_STAKE_PER_WALLET) |
| **Account constraints** | `user_token_account.mint == hackathon.usdc_mint`, `escrow` is PDA, `now < cutoff_timestamp` |
| **Remaining accounts** | When `open_staking = false`: `[0]` must be `WhitelistedWallet` PDA at `[whitelist, hackathon, user]` |
| **Transfers** | `amount` USDC from user ATA → escrow |
| **Client** | `program.methods.stake(new BN(amount)).accounts({ user, hackathon, project, userStake, userTokenAccount, escrow, tokenProgram, systemProgram }).remainingAccounts(whitelistEntry ? [{ pubkey: whitelistEntry, isWritable: false, isSigner: false }] : [])` |

### 4.4 `self_stake`

| Field | Detail |
|-------|--------|
| **Auth** | Builder (caller must equal `project.builder_wallet`) |
| **Params** | `amount: u64` (≥ `deposit_amount`, cumulative ≤ `MAX_SELF_STAKE`) |
| **Account constraints** | `builder_token_account.mint == hackathon.usdc_mint`, deposit must be paid |
| **Client** | `program.methods.selfStake(new BN(amount)).accounts({ builder, hackathon, project, userStake, builderTokenAccount, escrow, tokenProgram, systemProgram })` |

### 4.5 `submit_project`

| Field | Detail |
|-------|--------|
| **Auth** | Builder (`project.builder_wallet == signer`) |
| **Effects** | Sets `builder_declared = true`, `declared_at = now` |
| **Constraints** | `now < results_timestamp`, `!builder_declared` |
| **Client** | `program.methods.submitProject().accounts({ builder, hackathon, project })` |

### 4.6 `unstake`

| Field | Detail |
|-------|--------|
| **Auth** | Staker (UserStake PDA verifies ownership) |
| **Effects** | Returns 97% of stake to user, 1.5% to fee_recipient, 1.5% stays in pool. Zeroes `amount` and `shares`. |
| **Constraints** | `now < cutoff_timestamp`, `!is_resolved`, `stake_amount > 0`, valid `fee_recipient_token_account` |
| **Client** | `program.methods.unstake().accounts({ user, hackathon, project, userStake, userTokenAccount, feeRecipientTokenAccount, escrow, tokenProgram, systemProgram })` |

### 4.7 `resolve`

| Field | Detail |
|-------|--------|
| **Auth** | Hackathon admin or protocol admin |
| **Effects** | Sets `project.rank = rank`. Increments `hackathon.ranked_count` on first ranking |
| **Params** | `rank: u8` (≥1) |
| **Constraints** | `now >= results_timestamp`, `!is_resolved` |
| **Client** | `program.methods.resolve(rank).accounts({ admin, hackathon, project }).remainingAccounts([adminPda])` |

### 4.8 `finalize_resolve`

| Field | Detail |
|-------|--------|
| **Auth** | Hackathon admin or protocol admin |
| **Effects** | Computes `effective_tier_pcts` (proportional cascade), snapshots `tier_c_totals`, sets `is_resolved = true` |
| **Remaining accounts** | All ProjectAccount PDAs for this hackathon (completeness verified against `ranked_count`) |
| **Constraints** | `now >= results_timestamp`, `!is_resolved`, `ranked_found == ranked_count` |
| **Client** | `program.methods.finalizeResolve().accounts({ admin, hackathon }).remainingAccounts(allProjectPdas.map(p => ({ pubkey: p, isWritable: false, isSigner: false })))` |

### 4.9 `claim`

| Field | Detail |
|-------|--------|
| **Auth** | Staker (UserStake PDA verifies ownership) |
| **Effects** | Computes tier-weighted sqrt-crowding payout, deducts protocol fee, transfers to user |
| **Constraints** | `is_resolved`, `project_rank > 0`, `!is_claimed`, `stake_amount > 0` |
| **Client** | `program.methods.claim().accounts({ user, hackathon, project, userStake, userTokenAccount, feeRecipientTokenAccount, escrow, tokenProgram, systemProgram })` |

### 4.10 `enable_refund`

| Field | Detail |
|-------|--------|
| **Auth** | Hackathon admin or protocol admin |
| **Effects** | Sets `project.is_refund_enabled = true` (irreversible) |
| **Constraints** | `!is_resolved` |
| **Client** | `program.methods.enableRefund().accounts({ admin, hackathon, project }).remainingAccounts([adminPda])` |

### 4.11 `refund`

| Field | Detail |
|-------|--------|
| **Auth** | Staker (UserStake PDA verifies ownership) |
| **Effects** | Returns full stake amount (no penalty), decrements pool/staked/shares |
| **Constraints** | `!is_resolved`, `is_refund_enabled`, `!is_claimed`, `amount > 0` |
| **Client** | `program.methods.refund().accounts({ user, hackathon, project, userStake, userTokenAccount, escrow, tokenProgram, systemProgram })` |

### 4.12 `pay_deposit`

| Field | Detail |
|-------|--------|
| **Auth** | Builder (`project.builder_wallet == signer`) |
| **Effects** | Transfers `hackathon.deposit_amount` USDC to escrow. Sets `deposit_amount_paid`. Unlocks crowd staking. |
| **Constraints** | `now < cutoff_timestamp`, `deposit_amount_paid == 0`, `deposit_amount > 0` |
| **Client** | `program.methods.payDeposit().accounts({ builder, hackathon, project, builderTokenAccount, escrow, tokenProgram, systemProgram })` |

### 4.13 `approve_submissions`

| Field | Detail |
|-------|--------|
| **Auth** | Hackathon admin or protocol admin |
| **Effects** | Sets `submitted = true` for each project in `remaining_accounts` that belongs to this hackathon, was self-declared, and not yet approved |
| **Remaining accounts** | Writable ProjectAccount PDAs to approve |
| **Client** | `program.methods.approveSubmissions().accounts({ admin, hackathon }).remainingAccounts(projectPdas.map(p => ({ pubkey: p, isWritable: true, isSigner: false })))` |

### 4.14 `claim_deposit_refund`

| Field | Detail |
|-------|--------|
| **Auth** | Builder (`project.builder_wallet == signer`) |
| **Effects** | Returns full deposit to builder's ATA |
| **Constraints** | `builder_declared && submitted`, `now >= results_timestamp`, `now <= results_timestamp + 14 days`, `!deposit_forfeited`, `!deposit_refunded` |
| **Client** | `program.methods.claimDepositRefund().accounts({ builder, hackathon, project, builderTokenAccount, escrow, tokenProgram, systemProgram })` |

### 4.15 `forfeit_deposit`

| Field | Detail |
|-------|--------|
| **Auth** | Hackathon admin or protocol admin |
| **Effects** | Splits deposit: 50% to fee_recipient, 50% added to total_pool. Sets `deposit_forfeited = true`. |
| **Constraints** | `now >= results_timestamp + 14 days`, `!submitted`, `deposit_amount_paid > 0`, `!deposit_refunded`, `!deposit_forfeited` |
| **Client** | `program.methods.forfeitDeposit().accounts({ admin, hackathon, project, feeRecipientTokenAccount, escrow, tokenProgram }).remainingAccounts([adminPda])` |

### 4.16 `transfer_upgrade_authority`

| Field | Detail |
|-------|--------|
| **Auth** | Current BPF upgrade authority + new authority (both must sign) |
| **Client** | `program.methods.transferUpgradeAuthority().accounts({ currentAuthority, programData, newAuthority })` |

### 4.17 `revoke_upgrade_authority`

| Field | Detail |
|-------|--------|
| **Auth** | Current BPF upgrade authority |
| **Effects** | Permanently removes upgrade authority (IRREVERSIBLE) |
| **Client** | `program.methods.revokeUpgradeAuthority().accounts({ currentAuthority, programData })` |

### 4.18 `add_protocol_admin`

| Field | Detail |
|-------|--------|
| **Auth** | PROTOCOL_ADMIN (hardcoded pubkey) |
| **Effects** | Creates `ProtocolAdminEntry` PDA delegating hackathon-creation and whitelisting rights |
| **Client** | `program.methods.addProtocolAdmin().accounts({ authority, newAdmin, adminEntry, systemProgram })` |

### 4.19 `remove_protocol_admin`

| Field | Detail |
|-------|--------|
| **Auth** | PROTOCOL_ADMIN |
| **Effects** | Closes `ProtocolAdminEntry` PDA, returns rent to authority |
| **Client** | `program.methods.removeProtocolAdmin().accounts({ authority, adminWallet, adminEntry })` |

### 4.20 `whitelist_wallet`

| Field | Detail |
|-------|--------|
| **Auth** | Hackathon admin or protocol admin |
| **Effects** | Creates `WhitelistedWallet` PDA for per-hackathon staking access |
| **Client** | `program.methods.whitelistWallet().accounts({ admin, hackathon, wallet, whitelistEntry, systemProgram }).remainingAccounts([adminPda])` |

### Migration Instructions (4.21–4.25)

`migrate_hackathon_v1`, `migrate_hackathon_v2`, `migrate_hackathon_v3`, `migrate_project_v1`, `migrate_project_v2` — one-time layout migrations. Callable by any signer (byte-size gated). Not needed for new deploys.

---

## PDA Seeds Reference

| Account | Seeds | Notes |
|---------|-------|-------|
| `HackathonState` | `["hackathon", admin, name]` | Name is a variable-length UTF-8 string (≤50 bytes) |
| Escrow (ATA) | `["escrow", hackathon]` | Token account, authority = hackathon PDA |
| `ProjectAccount` | `["project", hackathon, sha256(github_url)]` | 32-byte hash, not raw URL |
| `UserStake` | `["stake", user, project]` | One per (user, project) pair |
| `WhitelistedWallet` | `["whitelist", hackathon, wallet]` | Per-hackathon whitelist entry |
| `ProtocolAdminEntry` | `["protocol_admin", wallet]` | Delegated admin rights |

---

## HTTP API Routes

### `POST /api/project-submission`

Creates or updates a builder-submitted project review request.

| Field | Detail |
|-------|--------|
| **Auth** | Ed25519 signature of `"hackbet:register:{project_pubkey}"` by `wallet_address` |
| **Body** | `{ projectPubkey, hackathonPubkey, githubUrl, walletAddress, projectName, signature, authEmail?, discord?, telegram?, twitterHandle? }` |
| **Validation** | Project name ≤120 chars. `projectPubkey` must equal derived PDA. `requires_approval` resolved from on-chain. |
| **Response** | `{ data: submission_record }` (201/200) |

### `POST /api/whitelist-request`

Submits a staking-access request for a wallet.

| Field | Detail |
|-------|--------|
| **Auth** | Ed25519 signature of `"hackbet:whitelist-request:{hackathon_pubkey}"` by `wallet_address` |
| **Body** | `{ hackathon_pubkey, wallet_address, email, signature, notes? }` |
| **Validation** | Email regex. One pending/approved request per wallet globally. |
| **Response** | `{ success: true }` (201) or `{ error, status }` (409 duplicate) |

### `GET /api/github-stats?url=<github_url>`

Fetches GitHub repo commit stats. Cached 1 hour in Supabase; falls back to stale on rate-limit.

| Field | Detail |
|-------|--------|
| **Response** | `{ data: { github_url, default_branch, last_commit_at, commits_7d, fetched_at } }` |

### `GET /api/admin/project-submissions`

Lists project submissions managed by the authenticated admin.

| Field | Detail |
|-------|--------|
| **Auth** | Admin session cookie OR signed headers (`x-admin-wallet-address`, `x-admin-issued-at`, `x-admin-signature`) |
| **Response** | `{ data: SubmissionRecord[] }` filtered to admin's managed hackathons |

### `POST /api/admin/project-submissions`

Approves/rejects a project submission. On approval, verifies on-chain ownership and syncs metadata to Supabase.

| Field | Detail |
|-------|--------|
| **Auth** | Admin session cookie OR signed headers |
| **Body** | `{ submission_id, status: "approved" | "rejected" }` |
| **Response** | `{ success: true, reviewed_at }` |

### `GET /api/admin/whitelist-requests?hackathon_pubkey=<optional>`

Lists whitelist requests. Protocol admin sees all; hackathon admins see only their hackathons.

| Field | Detail |
|-------|--------|
| **Auth** | Admin session cookie OR signed headers |
| **Response** | `{ data: WhitelistRequestRecord[] }` |

### `POST /api/admin/whitelist-requests`

Approves/rejects a whitelist request. Only protocol admin (super-admin) can review.

| Field | Detail |
|-------|--------|
| **Auth** | Admin session cookie OR signed headers, wallet must be `PROTOCOL_ADMIN` |
| **Body** | `{ request_id, status: "approved" | "rejected" }` |
| **Response** | `{ success: true }` |

### `GET /api/admin/hackathon-metadata?pubkey=<hackathon>`

| Field | Detail |
|-------|--------|
| **Auth** | Admin session cookie OR signed headers |
| **Response** | `{ icon_url, official_link, name }` |

### `POST /api/admin/session`

Creates an admin session cookie (HMAC-signed, httpOnly, SameSite strict).

| Field | Detail |
|-------|--------|
| **Auth** | Signed headers (`x-admin-wallet-address`, `x-admin-issued-at`, `x-admin-signature`) |
| **Body** | `{}` |
| **Response** | `{ expiresAt }` with Set-Cookie header |

### `DELETE /api/admin/session`

Clears the admin session cookie.

---

## Token Account Derivation

All ATAs use standard SPL Associated Token Account derivation:

```
ATA = getAssociatedTokenAddressSync(mint, owner)
```

Key ATAs in the system:
- **User ATA**: `getAssociatedTokenAddressSync(usdcMint, userPubkey)` — user's USDC wallet
- **Fee Recipient ATA**: `getAssociatedTokenAddressSync(usdcMint, feeRecipient)` — receives protocol fees
- **Builder ATA**: `getAssociatedTokenAddressSync(usdcMint, builderPubkey)` — builder's USDC wallet
- **Escrow**: PDA at `["escrow", hackathon]` — holds all staked USDC

---

## Error Codes

| Code | Name | Message |
|------|------|---------|
| 6000 | CutoffPassed | Cutoff has passed — staking, self-staking, and unstaking are no longer allowed |
| 6001 | StakingClosed | Staking closed — results timestamp has passed |
| 6002 | NotResolved | Hackathon is not yet resolved |
| 6003 | AlreadyResolved | Hackathon is already resolved |
| 6004 | AlreadyClaimed | Payout already claimed |
| 6005 | StakeCapExceeded | Stake exceeds per-wallet cap |
| 6006 | UrlTooLong | github_url exceeds 200-character limit |
| 6007 | InvalidRank | Rank must be >= 1 |
| 6008 | ZeroAmount | Amount must be greater than zero |
| 6009 | Overflow | Arithmetic overflow |
| 6010 | ResultsNotYet | Results timestamp has not arrived yet |
| 6011 | InvalidTimestamp | Results timestamp must be in the future |
| 6012 | InvalidUrlHash | url_hash must equal SHA-256(github_url) |
| 6013 | InvalidTierConfig | tier_pcts must sum to 100, count 1-8, lengths must match |
| 6014 | RefundNotEnabled | Refund is not enabled for this project |
| 6015 | AllTiersEmpty | No ranked project found in any tier — cannot finalize |
| 6016 | NameTooLong | Hackathon name exceeds 50-character limit |
| 6017 | InvalidFeeRecipient | fee_recipient_token_account does not match hackathon.fee_recipient |
| 6018 | DepositNotPaid | Builder deposit has not been paid |
| 6019 | DepositAlreadyPaid | Builder deposit has already been paid |
| 6020 | NotBuilder | Caller is not the registered builder for this project |
| 6021 | AlreadySubmitted | Project has already been marked as submitted |
| 6022 | NotSubmitted | Project has not been approved as submitted by the organizer |
| 6023 | DepositAlreadyRefunded | Builder deposit has already been refunded |
| 6024 | DepositAlreadyForfeited | Builder deposit has already been forfeited |
| 6025 | SelfStakeBelowMinimum | Self-stake amount is below the required minimum |
| 6026 | SelfStakeExceedsMaximum | Self-stake would exceed the $250 maximum |
| 6027 | Unauthorized | Caller is not the protocol admin |
| 6028 | NotWhitelisted | Wallet is not whitelisted to stake in this hackathon |
| 6029 | NotDeclared | Builder has not declared submission via submit_project |
| 6030 | AlreadyMigrated | Hackathon has already been migrated to the current layout |
| 6031 | InvalidFee | protocol_fee_bps exceeds maximum of 3000 (30%) |
| 6032 | IncompleteProjectList | finalize_resolve received fewer ranked projects than resolve() assigned ranks to |
| 6033 | RefundBlockedAfterResolution | Refund cannot be enabled for a ranked project after the hackathon is resolved |
| 6034 | DuplicateProjectAccount | finalize_resolve received the same project account more than once |
| 6035 | ForfeitTooEarly | Builder deposits can only be forfeited after the post-results grace period |
| 6036 | SubmissionClosed | Submission window has closed |
| 6037 | DepositClaimTooEarly | Deposit refund window has not opened yet |
| 6038 | DepositClaimExpired | Deposit refund window has expired |
