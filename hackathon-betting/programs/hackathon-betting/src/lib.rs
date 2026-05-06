use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");

// ── Protocol constants ─────────────────────────────────────────────────────

/// Seconds before irl_hackathon_deadline_timestamp after which unstaking is forbidden.
pub const SELL_CUTOFF_SECS: i64 = 86_400;
/// Window after irl_hackathon_deadline_timestamp during which approved builders may claim their deposit back;
/// after this window, unclaimed/undeclared deposits become forfeitable by the admin.
pub const DEPOSIT_CLAIM_WINDOW_SECS: i64 = 14 * 86_400;
/// Fixed unstake penalty in basis points (3%).
pub const UNSTAKE_PENALTY_BPS: u64 = 300;
/// Portion of the unstake penalty routed to fee_recipient (1.5%).
pub const UNSTAKE_PROTOCOL_BPS: u64 = 150;
/// Shares multiplier at t=0 in basis points (1.5×).
pub const EARLY_MULTIPLIER_BPS: u64 = 15_000;
/// Shares multiplier at cutoff in basis points (1.0×).
pub const BASE_MULTIPLIER_BPS: u64 = 10_000;
/// Hard cap on stake per wallet per project ($250, 6 decimals).
pub const MAX_STAKE_PER_WALLET: u64 = 250_000_000;
/// Maximum length of a hackathon name in bytes.
pub const NAME_MAX_LEN: usize = 50;
/// Basis-point denominator for all fixed-point math.
pub const BPS_DENOM: u64 = 10_000;
/// Maximum number of configurable winner tiers.
pub const MAX_TIERS: usize = 8;
/// Effective tier percentages are stored in basis points (sum = 10_000).
pub const TIER_BPS_TOTAL: u32 = 10_000;
/// Protocol fee on claim payouts in basis points (1.5%).
pub const DEFAULT_PROTOCOL_FEE_BPS: u16 = 150;
/// Default builder commitment deposit in USDC lamports ($10, 6 decimals).
pub const DEFAULT_DEPOSIT_AMOUNT: u64 = 10_000_000;
/// Maximum cumulative self-stake a builder may place on their own project ($250, 6 decimals).
pub const MAX_SELF_STAKE: u64 = 250_000_000;

/// Protocol-level admin: the only wallet allowed to call initialize_hackathon.
/// In `testing` builds this is swapped to the local test payer so bankrun tests
/// can call initialize_hackathon and whitelist_wallet without the real admin key.
pub const PROTOCOL_ADMIN: Pubkey = anchor_lang::solana_program::pubkey!("Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD");

// ── Errors ─────────────────────────────────────────────────────────────────

#[error_code]
pub enum BettingError {
    #[msg("Cutoff has passed — staking, self-staking, and unstaking are no longer allowed")]
    CutoffPassed,
    #[msg("Staking closed — results timestamp has passed")]
    StakingClosed,
    #[msg("Hackathon is not yet resolved")]
    NotResolved,
    #[msg("Hackathon is already resolved")]
    AlreadyResolved,
    #[msg("Payout already claimed")]
    AlreadyClaimed,
    #[msg("Stake exceeds per-wallet cap")]
    StakeCapExceeded,
    #[msg("github_url exceeds 200-character limit")]
    UrlTooLong,
    #[msg("Rank must be >= 1")]
    InvalidRank,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Results timestamp has not arrived yet")]
    ResultsNotYet,
    #[msg("Results timestamp must be in the future")]
    InvalidTimestamp,
    #[msg("url_hash must equal SHA-256(github_url)")]
    InvalidUrlHash,
    #[msg("tier_pcts must sum to 100, count 1-8, lengths must match")]
    InvalidTierConfig,
    #[msg("Refund is not enabled for this project")]
    RefundNotEnabled,
    #[msg("No ranked project found in any tier — cannot finalize")]
    AllTiersEmpty,
    #[msg("Hackathon name exceeds 50-character limit")]
    NameTooLong,
    #[msg("fee_recipient_token_account does not match hackathon.fee_recipient")]
    InvalidFeeRecipient,
    #[msg("Builder deposit has not been paid — pay_deposit before staking is allowed")]
    DepositNotPaid,
    #[msg("Builder deposit has already been paid")]
    DepositAlreadyPaid,
    #[msg("Caller is not the registered builder for this project")]
    NotBuilder,
    #[msg("Project has already been marked as submitted")]
    AlreadySubmitted,
    #[msg("Project has not been approved as submitted by the organizer")]
    NotSubmitted,
    #[msg("Builder deposit has already been refunded")]
    DepositAlreadyRefunded,
    #[msg("Builder deposit has already been forfeited")]
    DepositAlreadyForfeited,
    #[msg("Self-stake amount is below the required minimum (hackathon deposit_amount)")]
    SelfStakeBelowMinimum,
    #[msg("Self-stake would exceed the $2 000 maximum")]
    SelfStakeExceedsMaximum,
    #[msg("Caller is not the protocol admin")]
    Unauthorized,
    #[msg("Wallet is not whitelisted to stake in this hackathon")]
    NotWhitelisted,
    #[msg("Builder has not declared submission via submit_project")]
    NotDeclared,
    #[msg("Hackathon has already been migrated to the current layout")]
    AlreadyMigrated,
    #[msg("protocol_fee_bps exceeds maximum of 3000 (30%)")]
    InvalidFee,
    #[msg("finalize_resolve received fewer ranked projects than resolve() has assigned ranks to")]
    IncompleteProjectList,
    #[msg("Refund cannot be enabled for a ranked project after the hackathon is resolved")]
    RefundBlockedAfterResolution,
    #[msg("finalize_resolve received the same project account more than once")]
    DuplicateProjectAccount,
    #[msg("Builder deposits can only be forfeited after the post-results grace period")]
    ForfeitTooEarly,
    #[msg("Submission window has closed — builder declarations must happen before results")]
    SubmissionClosed,
    #[msg("Deposit refund window has not opened yet — irl_hackathon_deadline_timestamp not yet reached")]
    DepositClaimTooEarly,
    #[msg("Deposit refund window has expired — must claim within 14 days of irl_hackathon_deadline_timestamp")]
    DepositClaimExpired,
}

// ── Pure helpers ───────────────────────────────────────────────────────────


/// Map a rank (1-based) to a zero-based tier index.
/// rank 1 → 0, rank 2 → 1, ..., rank > tier_count → tier_count-1 (rest tier).
fn rank_to_tier_idx(rank: u8, tier_count: u8) -> usize {
    (rank as usize)
        .saturating_sub(1)
        .min((tier_count as usize).saturating_sub(1))
}

/// Time-weighted shares: multiplier decays linearly from 1.5× at t=start to 1× at t=cutoff.
/// Returns the share units earned for `amount` staked at `now`.
fn compute_shares(amount: u64, now: i64, start: i64, cutoff: i64) -> Result<u64> {
    let window = cutoff.saturating_sub(start).max(1) as u64;
    let elapsed = (now.saturating_sub(start).max(0) as u64).min(window);
    let multiplier_bps = EARLY_MULTIPLIER_BPS
        .saturating_sub((EARLY_MULTIPLIER_BPS - BASE_MULTIPLIER_BPS) * elapsed / window);
    amount
        .checked_mul(multiplier_bps)
        .and_then(|v| v.checked_div(10_000))
        .ok_or(error!(BettingError::Overflow))
}

fn protocol_admin_auth_offset(
    signer: &Pubkey,
    remaining_accounts: &[AccountInfo],
) -> Result<usize> {
    if *signer == PROTOCOL_ADMIN {
        return Ok(0);
    }

    let Some(admin_entry_info) = remaining_accounts.first() else {
        return err!(BettingError::Unauthorized);
    };

    let (expected_pda, _) =
        Pubkey::find_program_address(&[b"protocol_admin", signer.as_ref()], &crate::ID);
    require!(
        admin_entry_info.key() == expected_pda,
        BettingError::Unauthorized,
    );
    require!(admin_entry_info.owner == &crate::ID, BettingError::Unauthorized);

    let entry = {
        let data = admin_entry_info.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        ProtocolAdminEntry::try_deserialize(&mut slice)?
    };
    require!(entry.wallet == *signer, BettingError::Unauthorized);

    Ok(1)
}

fn hackathon_admin_auth_offset(
    signer: &Pubkey,
    hackathon_admin: &Pubkey,
    remaining_accounts: &[AccountInfo],
) -> Result<usize> {
    if *signer == *hackathon_admin {
        Ok(0)
    } else {
        protocol_admin_auth_offset(signer, remaining_accounts)
    }
}

// ── Program ────────────────────────────────────────────────────────────────

#[program]
pub mod hackathon_betting {
    use super::*;

    // ── 4.1  initialize_hackathon ──────────────────────────────────────────

    /// Creates a HackathonState PDA and its USDC escrow token account.
    ///
    /// `tier_pcts` defines the pool allocation per winner tier (must sum to 100).
    /// `tier_expected_counts` defines expected project counts per tier. Used in
    /// payout math — for named tiers (count > 0), each project draws
    /// tier_pct / expected_count; for rest tiers (count == 0), splits what
    /// remains after named tiers draw.
    pub fn initialize_hackathon(
        ctx: Context<InitializeHackathon>,
        name: String,
        irl_hackathon_deadline_timestamp: i64,
        tier_pcts: Vec<u8>,
        tier_expected_counts: Vec<u8>,
        fee_recipient: Pubkey,
        protocol_fee_bps: u16,
        deposit_amount: u64,
        requires_approval: bool,
        open_staking: bool,
    ) -> Result<()> {
        protocol_admin_auth_offset(&ctx.accounts.admin.key(), ctx.remaining_accounts)?;
        require!(name.len() <= NAME_MAX_LEN, BettingError::NameTooLong);

        let now = Clock::get()?.unix_timestamp;
        // Require irl_hackathon_deadline_timestamp far enough in the future that the cutoff window is open.
        require!(
            irl_hackathon_deadline_timestamp > now.saturating_add(SELL_CUTOFF_SECS),
            BettingError::InvalidTimestamp,
        );

        let n = tier_pcts.len();
        let pct_sum: u32 = tier_pcts.iter().map(|&v| v as u32).sum();
        require!(
            n >= 1
                && n <= MAX_TIERS
                && n == tier_expected_counts.len()
                && pct_sum == 100,
            BettingError::InvalidTierConfig,
        );
        require!(protocol_fee_bps <= 3_000, BettingError::InvalidFee);

        let mut t_pcts = [0u8; MAX_TIERS];
        let mut t_counts = [0u8; MAX_TIERS];
        for i in 0..n {
            t_pcts[i] = tier_pcts[i];
            t_counts[i] = tier_expected_counts[i];
        }

        let h = &mut ctx.accounts.hackathon;
        h.admin = ctx.accounts.admin.key();
        h.usdc_mint = ctx.accounts.usdc_mint.key();
        h.name = name;
        h.start_timestamp = now;
        h.irl_hackathon_deadline_timestamp = irl_hackathon_deadline_timestamp;
        h.cutoff_timestamp = irl_hackathon_deadline_timestamp
            .checked_sub(SELL_CUTOFF_SECS)
            .ok_or(BettingError::Overflow)?;
        h.total_pool = 0;
        h.is_resolved = false;
        h.tier_count = n as u8;
        h.tier_pcts = t_pcts;
        h.tier_expected_counts = t_counts;
        h.effective_tier_pcts = [0u16; MAX_TIERS];
        h.tier_c_totals = [0u64; MAX_TIERS];
        h.fee_recipient = fee_recipient;
        h.protocol_fee_bps = protocol_fee_bps;
        h.deposit_amount = deposit_amount;
        h.requires_approval = requires_approval;
        h.bump = ctx.bumps.hackathon;
        h.escrow_bump = ctx.bumps.escrow;
        h.ranked_count = 0;
        h.open_staking = open_staking;
        Ok(())
    }

    // ── 4.2  register_project ─────────────────────────────────────────────

    pub fn register_project(
        ctx: Context<RegisterProject>,
        github_url: String,
        url_hash: [u8; 32],
    ) -> Result<()> {
        if ctx.accounts.hackathon.requires_approval {
            hackathon_admin_auth_offset(
                &ctx.accounts.caller.key(),
                &ctx.accounts.hackathon.admin,
                ctx.remaining_accounts,
            )?;
        } else {
            require!(
                ctx.accounts.caller.key() == ctx.accounts.builder.key(),
                BettingError::Unauthorized,
            );
        }
        require!(github_url.len() <= ProjectAccount::MAX_URL, BettingError::UrlTooLong);
        let expected = anchor_lang::solana_program::hash::hash(github_url.as_bytes()).to_bytes();
        require!(url_hash == expected, BettingError::InvalidUrlHash);
        let p = &mut ctx.accounts.project;
        p.hackathon = ctx.accounts.hackathon.key();
        p.github_url = github_url;
        p.total_staked = 0;
        p.total_shares = 0;
        p.rank = 0;
        p.is_registered = true;
        p.is_refund_enabled = false;
        p.builder_wallet = ctx.accounts.builder.key();
        p.deposit_amount_paid = 0;
        p.submitted = false;
        p.deposit_refunded = false;
        p.deposit_forfeited = false;
        p.builder_staked = 0;
        p.builder_declared = false;
        p.declared_at = 0;
        p.bump = ctx.bumps.project;
        Ok(())
    }

    // ── 4.3  stake ────────────────────────────────────────────────────────

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, BettingError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.cutoff_timestamp,
            BettingError::CutoffPassed,
        );

        // When open_staking is false, caller must pass the whitelist PDA as remaining_accounts[0].
        if !ctx.accounts.hackathon.open_staking {
            require!(!ctx.remaining_accounts.is_empty(), BettingError::NotWhitelisted);
            let entry_info = &ctx.remaining_accounts[0];
            let (expected_pda, _bump) = Pubkey::find_program_address(
                &[
                    b"whitelist",
                    ctx.accounts.hackathon.to_account_info().key.as_ref(),
                    ctx.accounts.user.key.as_ref(),
                ],
                ctx.program_id,
            );
            require!(entry_info.key() == expected_pda, BettingError::NotWhitelisted);
            require!(entry_info.owner == ctx.program_id, BettingError::NotWhitelisted);
        }

        // If hackathon requires a deposit, builder must have paid before anyone can back their project.
        if ctx.accounts.hackathon.deposit_amount > 0 {
            require!(
                ctx.accounts.project.deposit_amount_paid > 0,
                BettingError::DepositNotPaid,
            );
        }

        let user_stake = &mut ctx.accounts.user_stake;
        require!(!user_stake.is_claimed, BettingError::AlreadyClaimed);

        let new_amount = user_stake
            .amount
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;
        require!(new_amount <= MAX_STAKE_PER_WALLET, BettingError::StakeCapExceeded);

        let new_shares = compute_shares(
            amount,
            now,
            ctx.accounts.hackathon.start_timestamp,
            ctx.accounts.hackathon.cutoff_timestamp,
        )?;

        if user_stake.user == Pubkey::default() {
            user_stake.user = ctx.accounts.user.key();
            user_stake.project = ctx.accounts.project.key();
            user_stake.stake_timestamp = now;
            user_stake.is_claimed = false;
            user_stake.bump = ctx.bumps.user_stake;
        }
        user_stake.amount = new_amount;
        user_stake.shares = user_stake.shares
            .checked_add(new_shares)
            .ok_or(BettingError::Overflow)?;

        ctx.accounts.project.total_staked = ctx.accounts
            .project
            .total_staked
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.project.total_shares = ctx.accounts
            .project
            .total_shares
            .checked_add(new_shares)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.hackathon.total_pool = ctx.accounts
            .hackathon
            .total_pool
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    // ── 4.4  self_stake ───────────────────────────────────────────────────

    /// Builder places their own funds behind their project.
    /// Minimum: hackathon.deposit_amount (e.g. $10).
    /// Maximum cumulative: MAX_SELF_STAKE ($2 000) — prevents whale builders
    /// from drowning out the crowd signal with their own stake.
    /// Uses the same UserStake PDA and escrow as regular stake so the builder
    /// participates in payout claims identically to any backer.
    pub fn self_stake(ctx: Context<SelfStake>, amount: u64) -> Result<()> {
        require!(amount > 0, BettingError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.cutoff_timestamp,
            BettingError::CutoffPassed,
        );

        // Deposit must be paid before builder can self-stake (only when deposit is required).
        if ctx.accounts.hackathon.deposit_amount > 0 {
            require!(
                ctx.accounts.project.deposit_amount_paid > 0,
                BettingError::DepositNotPaid,
            );
        }

        // Minimum per-tx: must be at least the deposit amount (e.g. $10).
        require!(
            amount >= ctx.accounts.hackathon.deposit_amount,
            BettingError::SelfStakeBelowMinimum,
        );

        // Cumulative cap: builder_staked + amount ≤ MAX_SELF_STAKE.
        let new_builder_staked = ctx.accounts.project.builder_staked
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;
        require!(new_builder_staked <= MAX_SELF_STAKE, BettingError::SelfStakeExceedsMaximum);

        let user_stake = &mut ctx.accounts.user_stake;
        require!(!user_stake.is_claimed, BettingError::AlreadyClaimed);

        let new_amount = user_stake
            .amount
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;

        if user_stake.user == Pubkey::default() {
            user_stake.user      = ctx.accounts.builder.key();
            user_stake.project   = ctx.accounts.project.key();
            user_stake.stake_timestamp = now;
            user_stake.is_claimed = false;
            user_stake.bump      = ctx.bumps.user_stake;
        }
        user_stake.amount = new_amount;
        let new_shares = compute_shares(
            amount,
            now,
            ctx.accounts.hackathon.start_timestamp,
            ctx.accounts.hackathon.cutoff_timestamp,
        )?;
        user_stake.shares = user_stake.shares
            .checked_add(new_shares)
            .ok_or(BettingError::Overflow)?;

        ctx.accounts.project.total_staked = ctx.accounts.project.total_staked
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.project.total_shares = ctx.accounts.project.total_shares
            .checked_add(new_shares)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.project.builder_staked = new_builder_staked;
        ctx.accounts.hackathon.total_pool = ctx.accounts.hackathon.total_pool
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.builder_token_account.to_account_info(),
                    to:        ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.builder.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    // ── 4.5  submit_project ───────────────────────────────────────────────

    /// Builder declares on-chain that they have submitted their project.
    /// Must be called before irl_hackathon_deadline_timestamp. Staking still locks at cutoff,
    /// but builders keep the full build window to declare completion.
    /// Sets builder_declared = true and records the timestamp.
    /// This records the builder-side declaration. Deposit refunds still require
    /// organizer approval via approve_submissions unless an explicit refund
    /// override is enabled.
    pub fn submit_project(ctx: Context<SubmitProject>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.irl_hackathon_deadline_timestamp,
            BettingError::SubmissionClosed,
        );
        if ctx.accounts.hackathon.deposit_amount > 0 {
            require!(
                ctx.accounts.project.deposit_amount_paid > 0,
                BettingError::DepositNotPaid,
            );
        }
        require!(
            !ctx.accounts.project.builder_declared,
            BettingError::AlreadySubmitted,
        );

        ctx.accounts.project.builder_declared = true;
        ctx.accounts.project.declared_at = now;
        Ok(())
    }

    // ── 4.6  unstake ──────────────────────────────────────────────────────

    /// Fixed 3% exit penalty: 1.5% to fee_recipient, 1.5% stays in pool.
    ///   return_amount = stake × (10_000 − UNSTAKE_PENALTY_BPS) / 10_000  (97%)
    ///   protocol_fee  = stake × UNSTAKE_PROTOCOL_BPS / 10_000             (1.5%)
    ///   pool_fee      = penalty − protocol_fee                             (1.5%, stays in escrow)
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.cutoff_timestamp,
            BettingError::CutoffPassed,
        );

        require!(!ctx.accounts.user_stake.is_claimed, BettingError::AlreadyClaimed);
        let stake_amount = ctx.accounts.user_stake.amount;
        let user_shares = ctx.accounts.user_stake.shares;
        require!(stake_amount > 0, BettingError::ZeroAmount);

        let admin_key = ctx.accounts.hackathon.admin;
        let hname = ctx.accounts.hackathon.name.clone();
        let hbump = ctx.accounts.hackathon.bump;

        let penalty = stake_amount
            .checked_mul(UNSTAKE_PENALTY_BPS)
            .ok_or(BettingError::Overflow)?
            / BPS_DENOM;
        let protocol_fee = stake_amount
            .checked_mul(UNSTAKE_PROTOCOL_BPS)
            .ok_or(BettingError::Overflow)?
            / BPS_DENOM;
        let return_amount = stake_amount
            .checked_sub(penalty)
            .ok_or(BettingError::Overflow)?;

        ctx.accounts.user_stake.amount = 0;
        ctx.accounts.user_stake.shares = 0;
        ctx.accounts.project.total_staked = ctx.accounts.project.total_staked
            .checked_sub(stake_amount)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.project.total_shares = ctx.accounts.project.total_shares
            .checked_sub(user_shares)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.hackathon.total_pool = ctx.accounts.hackathon.total_pool
            .checked_sub(return_amount)
            .and_then(|v| v.checked_sub(protocol_fee))
            .ok_or(BettingError::Overflow)?;

        let bump_arr = [hbump];
        let seeds: &[&[u8]] = &[b"hackathon", admin_key.as_ref(), hname.as_bytes(), &bump_arr];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.hackathon.to_account_info(),
                },
                &[seeds],
            ),
            return_amount,
        )?;

        if protocol_fee > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.fee_recipient_token_account.to_account_info(),
                        authority: ctx.accounts.hackathon.to_account_info(),
                    },
                    &[seeds],
                ),
                protocol_fee,
            )?;
        }

        Ok(())
    }

    // ── 4.5  resolve ──────────────────────────────────────────────────────

    /// Sets the rank on a single ProjectAccount. Call once per project.
    /// After all ranks are set, call finalize_resolve.
    pub fn resolve(ctx: Context<Resolve>, rank: u8) -> Result<()> {
        hackathon_admin_auth_offset(
            &ctx.accounts.admin.key(),
            &ctx.accounts.hackathon.admin,
            ctx.remaining_accounts,
        )?;
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.hackathon.irl_hackathon_deadline_timestamp,
            BettingError::ResultsNotYet,
        );
        require!(rank >= 1, BettingError::InvalidRank);
        require!(
            rank <= ctx.accounts.hackathon.tier_count,
            BettingError::InvalidRank,
        );
        // ranked_count tracks every project that has been assigned a rank,
        // regardless of deposit or stake status. finalize_resolve uses this
        // for a completeness check (all ranked projects must be supplied).
        // Payout eligibility filtering happens inside finalize_resolve.
        if ctx.accounts.project.rank == 0 {
            ctx.accounts.hackathon.ranked_count = ctx.accounts.hackathon.ranked_count
                .checked_add(1)
                .ok_or(BettingError::Overflow)?;
        }
        ctx.accounts.project.rank = rank;
        Ok(())
    }

    // ── 4.5b  finalize_resolve ────────────────────────────────────────────

    /// Computes effective tier percentages with per-project payout math,
    /// stores them as basis points in `effective_tier_pcts`, then sets
    /// `is_resolved = true`.
    ///
    /// **Per-project math:** For tiers with `tier_expected_counts[t] > 0`, the
    /// configured `tier_pcts[t]` is divided by the expected count to produce a
    /// per-project share. The tier draws `per_project × actual_count`. Unused
    /// allocation from under-filled tiers cascades proportionally to occupied
    /// tiers. Tiers with expected count 0 are "rest" tiers that split whatever
    /// pool % remains after all named tiers draw.
    ///
    /// **Oversubscription guard:** If a named tier (expected > 0) has more
    /// payout-eligible projects than its expected count, finalization reverts
    /// with `InvalidTierConfig`.
    ///
    /// Display-only projects (no deposit, or zero shares after refund) are
    /// excluded from tier counts entirely. If no payout-eligible projects exist,
    /// finalization reverts with `AllTiersEmpty` to prevent permanently locking
    /// the prize pool.
    ///
    /// remaining_accounts: all registered ProjectAccounts for this hackathon.
    pub fn finalize_resolve(ctx: Context<FinalizeResolve>) -> Result<()> {
        let auth_offset = hackathon_admin_auth_offset(
            &ctx.accounts.admin.key(),
            &ctx.accounts.hackathon.admin,
            ctx.remaining_accounts,
        )?;
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.hackathon.irl_hackathon_deadline_timestamp,
            BettingError::ResultsNotYet,
        );

        let hackathon_key = ctx.accounts.hackathon.key();
        let tier_count = ctx.accounts.hackathon.tier_count as usize;
        let tier_pcts = ctx.accounts.hackathon.tier_pcts;

        // Determine which tiers are represented by at least one ranked project.
        // Also count ranked projects found and verify against hackathon.ranked_count
        // to prevent an admin from omitting projects and skewing tier allocations or
        // tier_c_totals denominators (completeness check).
        let mut tier_has_projects = [false; MAX_TIERS];
        let mut tier_c_totals_new = [0u64; MAX_TIERS];
        // ranked_found_all: every rank > 0 project; compared against ranked_count
        // for completeness (prevents admin from omitting projects).
        let mut ranked_found_all: u32 = 0;
        let mut seen_projects: Vec<Pubkey> = Vec::new();
        let deposit_required = ctx.accounts.hackathon.deposit_amount > 0;
        for acc in ctx.remaining_accounts[auth_offset..].iter() {
            if acc.owner != &crate::ID {
                continue;
            }
            let data = acc.try_borrow_data()?;
            let project = match ProjectAccount::try_deserialize(&mut data.as_ref()) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if project.hackathon != hackathon_key {
                continue;
            }
            require!(
                !seen_projects.iter().any(|key| key == acc.key),
                BettingError::DuplicateProjectAccount,
            );
            seen_projects.push(acc.key());
            if project.rank == 0 {
                continue;
            }
            // Every ranked project counts toward the completeness check, regardless
            // of deposit or stake status (ensures admin cannot omit any ranked project).
            ranked_found_all = ranked_found_all.checked_add(1).ok_or(BettingError::Overflow)?;
            // Payout eligibility: must have a deposit (when required) and nonzero
            // shares. Projects without a deposit or with zero shares are ranked for
            // display only and must not affect tier denominators or cascade math.
            // Note: shares can drop to zero via refund() after ranking — those
            // projects are display-only even though they were once stake-bearing.
            let deposit_paid = project.deposit_amount_paid > 0;
            if (deposit_required && !deposit_paid) || project.total_shares == 0 {
                continue;
            }
            let tier = rank_to_tier_idx(project.rank, tier_count as u8);
            // Count payout-eligible ranked projects per tier — equal split denominator.
            tier_c_totals_new[tier] = tier_c_totals_new[tier]
                .checked_add(1)
                .ok_or(BettingError::Overflow)?;
        }
        require!(
            ranked_found_all == ctx.accounts.hackathon.ranked_count,
            BettingError::IncompleteProjectList,
        );

        // A tier is only "occupied" if it has payout-eligible ranked projects.
        for i in 0..tier_count {
            tier_has_projects[i] = tier_c_totals_new[i] > 0;
        }

        // ── Per-project payout math (Option B) ──────────────────────────────
        // For named tiers (expected > 0): per-project share = tier_pct / expected.
        // Tier draws per_project × actual. Excess from under-filled tiers cascades.
        // For rest tiers (expected == 0): split whatever pool % remains.
        // Oversubscription (actual > expected) on any named tier reverts.
        let tier_expected = ctx.accounts.hackathon.tier_expected_counts;
        let mut effective = [0u16; MAX_TIERS];
        let mut drawn_bps: u32 = 0;
        let mut rest_total_pct_bps: u32 = 0;

        // First pass: named tiers draw per-project shares.
        for i in 0..tier_count {
            if !tier_has_projects[i] { continue; }
            let exp = tier_expected[i];
            if exp > 0 {
                require!(
                    tier_c_totals_new[i] <= exp as u64,
                    BettingError::InvalidTierConfig,
                );
                let pct_bps = (tier_pcts[i] as u32)
                    .checked_mul(100)
                    .ok_or(BettingError::Overflow)?;
                require!(
                    pct_bps >= exp as u32,
                    BettingError::InvalidTierConfig,
                );
                let per_proj = pct_bps
                    .checked_div(exp as u32)
                    .unwrap_or(0);
                // per_proj >= 1 guaranteed by the require above.
                let draw = per_proj
                    .checked_mul(tier_c_totals_new[i] as u32)
                    .ok_or(BettingError::Overflow)?;
                effective[i] = draw as u16;
                drawn_bps = drawn_bps
                    .checked_add(draw)
                    .ok_or(BettingError::Overflow)?;
            } else {
                rest_total_pct_bps = rest_total_pct_bps
                    .checked_add((tier_pcts[i] as u32).checked_mul(100).ok_or(BettingError::Overflow)?)
                    .ok_or(BettingError::Overflow)?;
            }
        }

        // Rest tiers split whatever pool % remains.
        let remaining = TIER_BPS_TOTAL.saturating_sub(drawn_bps);
        let has_rest_with_projects = (0..tier_count).any(|i| tier_has_projects[i] && tier_expected[i] == 0);
        if has_rest_with_projects && remaining > 0 {
            let mut rest_allocated: u32 = 0;
            let mut last_rest: usize = 0;
            for i in 0..tier_count {
                if tier_has_projects[i] && tier_expected[i] == 0 {
                    last_rest = i;
                }
            }
            for i in 0..tier_count {
                if !tier_has_projects[i] || tier_expected[i] > 0 { continue; }
                let weight = (tier_pcts[i] as u32).checked_mul(100).ok_or(BettingError::Overflow)?;
                if i == last_rest {
                    effective[i] = remaining.saturating_sub(rest_allocated) as u16;
                } else {
                    let share = (remaining as u64)
                        .checked_mul(weight as u64)
                        .ok_or(BettingError::Overflow)?
                        .checked_div(rest_total_pct_bps as u64)
                        .unwrap_or(0) as u16;
                    effective[i] = share;
                    rest_allocated = rest_allocated
                        .checked_add(share as u32)
                        .ok_or(BettingError::Overflow)?;
                }
            }
        } else if remaining > 0 && drawn_bps > 0 {
            // No rest tiers with projects: cascade excess to occupied named tiers
            // proportionally to what each tier's projects actually drew (per-project).
            let mut cascade_allocated: u32 = 0;
            let mut last_occupied: usize = 0;
            for i in 0..tier_count {
                if tier_has_projects[i] && tier_expected[i] > 0 {
                    last_occupied = i;
                }
            }
            for i in 0..tier_count {
                if !tier_has_projects[i] || tier_expected[i] == 0 { continue; }
                let weight = effective[i] as u32;
                let additional = if i == last_occupied {
                    remaining.saturating_sub(cascade_allocated)
                } else {
                    let v = (remaining as u64)
                        .checked_mul(weight as u64)
                        .ok_or(BettingError::Overflow)?
                        .checked_div(drawn_bps as u64)
                        .unwrap_or(0) as u32;
                    cascade_allocated = cascade_allocated
                        .checked_add(v)
                        .ok_or(BettingError::Overflow)?;
                    v
                };
                effective[i] = effective[i]
                    .checked_add(additional as u16)
                    .ok_or(BettingError::Overflow)?;
            }
        }

        // If no tier received any allocation, there are zero payout-eligible
        // projects. Revert rather than lock the pool permanently.
        let any_allocated = (0..tier_count).any(|i| effective[i] > 0);
        require!(any_allocated, BettingError::AllTiersEmpty);

        let h = &mut ctx.accounts.hackathon;
        h.effective_tier_pcts = effective;
        h.tier_c_totals = tier_c_totals_new;
        h.is_resolved = true;
        Ok(())
    }

    // ── 4.6  claim ────────────────────────────────────────────────────────

    /// Computes and transfers the user's payout using a two-stage tier formula.
    ///
    /// Stage 1 — tier allocation (from effective_tier_pcts set at finalize_resolve):
    ///   P_t = effective_tier_pcts[tier_of(project.rank)]  (basis points)
    ///
    /// Stage 2 — within-tier equal split:
    ///   Every ranked project in a tier gets 1/N of the tier pool,
    ///   where N = tier_c_totals[tier] (snapshotted at finalize_resolve).
    ///
    /// User payout (shares-weighted within project):
    ///   payout = shares × P_t × total_pool / (total_shares × N × 10_000)
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let total_pool = ctx.accounts.hackathon.total_pool;
        let admin_key = ctx.accounts.hackathon.admin;
        let hname = ctx.accounts.hackathon.name.clone();
        let hbump = ctx.accounts.hackathon.bump;
        let eff_pcts = ctx.accounts.hackathon.effective_tier_pcts;
        let tier_count = ctx.accounts.hackathon.tier_count;
        let protocol_fee_bps = ctx.accounts.hackathon.protocol_fee_bps;
        let project_total_shares = ctx.accounts.project.total_shares;
        let project_rank = ctx.accounts.project.rank;
        let stake_amount = ctx.accounts.user_stake.amount;
        let user_shares = ctx.accounts.user_stake.shares;

        require!(stake_amount > 0, BettingError::ZeroAmount);
        require!(project_rank > 0, BettingError::NotResolved);

        let tier = rank_to_tier_idx(project_rank, tier_count);
        let p_t = eff_pcts[tier] as u128;

        // Equal split within tier: every ranked project gets 1/N of the tier pool.
        // N is stored in tier_c_totals (snapshotted at finalize_resolve).
        let c_total_t = ctx.accounts.hackathon.tier_c_totals[tier];
        require!(c_total_t > 0, BettingError::Overflow);

        // payout = shares × P_t × pool / (total_shares × c_total_t × 10_000)
        // c_total_t = number of ranked projects in this tier (equal split, no sqrt).
        let payout: u64 = {
            let num = (user_shares as u128)
                .checked_mul(p_t)
                .and_then(|n| n.checked_mul(total_pool as u128))
                .ok_or(BettingError::Overflow)?;
            let den = (project_total_shares as u128)
                .checked_mul(c_total_t as u128)
                .and_then(|d| d.checked_mul(10_000u128))
                .ok_or(BettingError::Overflow)?;
            require!(den > 0, BettingError::Overflow);
            (num / den) as u64
        };

        // Split payout: protocol fee to fee_recipient, remainder to user.
        let protocol_fee_bps = protocol_fee_bps as u128;
        let fee_amount = ((payout as u128)
            .checked_mul(protocol_fee_bps)
            .ok_or(BettingError::Overflow)?
            / 10_000u128) as u64;
        let user_receives = payout
            .checked_sub(fee_amount)
            .ok_or(BettingError::Overflow)?;

        let bump_arr = [hbump];
        let seeds: &[&[u8]] = &[b"hackathon", admin_key.as_ref(), hname.as_bytes(), &bump_arr];

        // CEI: mark claimed BEFORE token transfers to follow Checks-Effects-Interactions.
        ctx.accounts.user_stake.is_claimed = true;

        if user_receives > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: ctx.accounts.hackathon.to_account_info(),
                    },
                    &[seeds],
                ),
                user_receives,
            )?;
        }

        if fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.fee_recipient_token_account.to_account_info(),
                        authority: ctx.accounts.hackathon.to_account_info(),
                    },
                    &[seeds],
                ),
                fee_amount,
            )?;
        }

        Ok(())
    }

    // ── 4.7  enable_refund ────────────────────────────────────────────────

    /// Admin marks a project as refund-eligible.  Once set, stakers on this
    /// project may call `refund` to recover their original stake amount.
    ///
    /// Intended for exceptional cases: judging errors, hackathon cancellations,
    /// or explicit admin override. Must be called before resolution; after
    /// resolution all stakes are settled (won or forfeited) and cannot be undone.
    /// Once enabled, cannot be revoked.
    ///
    /// No time-based gate beyond !is_resolved. The admin already controls rankings
    /// and could manipulate those directly — adding a time window on refunds would
    /// block legitimate recourse (wrong results, no-project-placed scenarios) without
    /// meaningfully changing the trust model.
    pub fn enable_refund(ctx: Context<EnableRefund>) -> Result<()> {
        hackathon_admin_auth_offset(
            &ctx.accounts.admin.key(),
            &ctx.accounts.hackathon.admin,
            ctx.remaining_accounts,
        )?;
        require!(
            !ctx.accounts.hackathon.is_resolved,
            BettingError::RefundBlockedAfterResolution,
        );
        ctx.accounts.project.is_refund_enabled = true;
        Ok(())
    }

    // ── 4.8  refund ───────────────────────────────────────────────────────

    /// Returns the user's original stake to them on a refund-enabled project.
    /// No penalty is applied — this is an admin-authorised exceptional path.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        // Enforced at the account layer too; this require! provides a clear error message.
        require!(
            !ctx.accounts.hackathon.is_resolved,
            BettingError::RefundBlockedAfterResolution,
        );
        require!(
            ctx.accounts.project.is_refund_enabled,
            BettingError::RefundNotEnabled,
        );
        require!(!ctx.accounts.user_stake.is_claimed, BettingError::AlreadyClaimed);
        let refund_amount = ctx.accounts.user_stake.amount;
        let user_shares   = ctx.accounts.user_stake.shares;
        require!(refund_amount > 0, BettingError::ZeroAmount);

        let admin_key = ctx.accounts.hackathon.admin;
        let hname = ctx.accounts.hackathon.name.clone();
        let hbump = ctx.accounts.hackathon.bump;

        // CEI: update all state BEFORE token transfer (C-02 fix — was missing pool/staked decrements).
        ctx.accounts.user_stake.is_claimed = true;
        ctx.accounts.project.total_staked = ctx.accounts.project.total_staked
            .checked_sub(refund_amount)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.project.total_shares = ctx.accounts.project.total_shares
            .checked_sub(user_shares)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.hackathon.total_pool = ctx.accounts.hackathon.total_pool
            .checked_sub(refund_amount)
            .ok_or(BettingError::Overflow)?;

        let bump_arr = [hbump];
        let seeds: &[&[u8]] = &[b"hackathon", admin_key.as_ref(), hname.as_bytes(), &bump_arr];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.hackathon.to_account_info(),
                },
                &[seeds],
            ),
            refund_amount,
        )?;
        Ok(())
    }

    // ── 4.9  pay_deposit ──────────────────────────────────────────────────

    /// Builder pays the hackathon's required commitment deposit into escrow.
    /// Idempotent — reverts if already paid. Does not add to total_pool;
    /// deposits are tracked separately so payout math is unaffected.
    /// Once paid, external backers may stake on this project.
    pub fn pay_deposit(ctx: Context<PayDeposit>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.cutoff_timestamp,
            BettingError::CutoffPassed,
        );
        require!(
            ctx.accounts.project.builder_wallet == ctx.accounts.builder.key(),
            BettingError::NotBuilder,
        );
        require!(
            ctx.accounts.project.deposit_amount_paid == 0,
            BettingError::DepositAlreadyPaid,
        );

        let deposit = ctx.accounts.hackathon.deposit_amount;
        require!(deposit > 0, BettingError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.builder_token_account.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.builder.to_account_info(),
                },
            ),
            deposit,
        )?;

        ctx.accounts.project.deposit_amount_paid = deposit;
        Ok(())
    }

    // ── 4.10  approve_submissions ─────────────────────────────────────────

    /// Organizer (hackathon admin) marks a batch of projects as submitted.
    /// Projects are passed as writable remaining_accounts (ProjectAccount PDAs).
    /// Sets submitted = true for each project that belongs to this hackathon.
    /// This is a flag-and-claim model: calling this does NOT transfer funds.
    /// Builders call claim_deposit_refund separately to pull their deposit back.
    pub fn approve_submissions(ctx: Context<ApproveSubmissions>) -> Result<()> {
        let auth_offset = hackathon_admin_auth_offset(
            &ctx.accounts.admin.key(),
            &ctx.accounts.hackathon.admin,
            ctx.remaining_accounts,
        )?;
        let hackathon_key = ctx.accounts.hackathon.key();

        for acc in ctx.remaining_accounts[auth_offset..].iter() {
            if acc.owner != &crate::ID || !acc.is_writable {
                continue;
            }

            // Read project data
            let mut project = {
                let data = acc.try_borrow_data()?;
                let mut slice: &[u8] = &data;
                match ProjectAccount::try_deserialize(&mut slice) {
                    Ok(p) => p,
                    Err(_) => continue,
                }
            };

            // Only approve projects that belong to this hackathon, have
            // self-declared via submit_project, and aren't already approved.
            if project.hackathon != hackathon_key
                || !project.builder_declared
                || project.submitted
            {
                continue;
            }

            project.submitted = true;

            // Write back
            let mut data = acc.try_borrow_mut_data()?;
            let dst: &mut [u8] = &mut data;
            let mut writer = std::io::Cursor::new(dst);
            project.try_serialize(&mut writer)?;
        }

        Ok(())
    }

    // ── 4.11  claim_deposit_refund ────────────────────────────────────────

    /// Builder reclaims their commitment deposit after the organizer has
    /// approved their submission via approve_submissions.
    pub fn claim_deposit_refund(ctx: Context<ClaimDepositRefund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.project.builder_wallet == ctx.accounts.builder.key(),
            BettingError::NotBuilder,
        );
        require!(
            ctx.accounts.project.builder_declared,
            BettingError::NotDeclared,
        );
        require!(ctx.accounts.project.submitted, BettingError::NotSubmitted);
        require!(
            now >= ctx.accounts.hackathon.irl_hackathon_deadline_timestamp,
            BettingError::DepositClaimTooEarly,
        );
        require!(
            now <= ctx.accounts.hackathon.irl_hackathon_deadline_timestamp
                .saturating_add(DEPOSIT_CLAIM_WINDOW_SECS),
            BettingError::DepositClaimExpired,
        );
        require!(
            !ctx.accounts.project.deposit_forfeited,
            BettingError::DepositAlreadyForfeited,
        );
        require!(
            !ctx.accounts.project.deposit_refunded,
            BettingError::DepositAlreadyRefunded,
        );

        let refund_amount = ctx.accounts.project.deposit_amount_paid;
        require!(refund_amount > 0, BettingError::ZeroAmount);

        let admin_key  = ctx.accounts.hackathon.admin;
        let hname      = ctx.accounts.hackathon.name.clone();
        let hbump      = ctx.accounts.hackathon.bump;
        let bump_arr   = [hbump];
        let seeds: &[&[u8]] = &[b"hackathon", admin_key.as_ref(), hname.as_bytes(), &bump_arr];

        // CEI: mark refunded BEFORE token transfer.
        ctx.accounts.project.deposit_refunded = true;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.builder_token_account.to_account_info(),
                    authority: ctx.accounts.hackathon.to_account_info(),
                },
                &[seeds],
            ),
            refund_amount,
        )?;
        Ok(())
    }

    // ── 4.12  transfer_upgrade_authority ─────────────────────────────────

    /// Transfers the program's BPF loader upgrade authority to a new account.
    /// Both the current authority and the new authority must sign
    /// (BPF loader's SetAuthorityChecked), preventing accidental transfers to
    /// a wrong address. Use this to hand deploy rights to a partner (e.g.
    /// Solana Foundation) while both parties confirm on-chain.
    pub fn transfer_upgrade_authority(
        ctx: Context<TransferUpgradeAuthority>,
    ) -> Result<()> {
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::bpf_loader_upgradeable::set_upgrade_authority_checked(
                ctx.accounts.program_data.key,
                ctx.accounts.current_authority.key,
                ctx.accounts.new_authority.key,
            ),
            &[
                ctx.accounts.program_data.to_account_info(),
                ctx.accounts.current_authority.to_account_info(),
                ctx.accounts.new_authority.to_account_info(),
            ],
        )?;
        Ok(())
    }

    // ── 4.13  revoke_upgrade_authority ────────────────────────────────────

    /// Permanently removes the upgrade authority, making this program immutable.
    /// IRREVERSIBLE — no further code changes are possible after this call.
    /// Use this as a final trust signal once the protocol is stable and audited.
    pub fn revoke_upgrade_authority(ctx: Context<RevokeUpgradeAuthority>) -> Result<()> {
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::bpf_loader_upgradeable::set_upgrade_authority(
                ctx.accounts.program_data.key,
                ctx.accounts.current_authority.key,
                None,
            ),
            &[
                ctx.accounts.program_data.to_account_info(),
                ctx.accounts.current_authority.to_account_info(),
            ],
        )?;
        Ok(())
    }

    // ── 4.14  forfeit_deposit ─────────────────────────────────────────────

    /// Admin confiscates the deposit of a builder who registered but did not
    /// actually submit. The full deposit is transferred to the fee_recipient
    /// as protocol revenue.
    pub fn forfeit_deposit(ctx: Context<ForfeitDeposit>) -> Result<()> {
        hackathon_admin_auth_offset(
            &ctx.accounts.admin.key(),
            &ctx.accounts.hackathon.admin,
            ctx.remaining_accounts,
        )?;
        require!(
            ctx.accounts.hackathon.is_resolved,
            BettingError::NotResolved,
        );
        let now = Clock::get()?.unix_timestamp;
        let forfeitable_at = ctx.accounts.hackathon.irl_hackathon_deadline_timestamp
            .checked_add(DEPOSIT_CLAIM_WINDOW_SECS)
            .ok_or(BettingError::Overflow)?;
        require!(now >= forfeitable_at, BettingError::ForfeitTooEarly);
        require!(
            ctx.accounts.project.deposit_amount_paid > 0,
            BettingError::DepositNotPaid,
        );
        require!(
            !ctx.accounts.project.deposit_refunded,
            BettingError::DepositAlreadyRefunded,
        );
        require!(
            !ctx.accounts.project.submitted,
            BettingError::AlreadySubmitted,
        );
        require!(
            !ctx.accounts.project.deposit_forfeited,
            BettingError::DepositAlreadyForfeited,
        );

        let amount = ctx.accounts.project.deposit_amount_paid;

        // Transfer entire forfeited deposit to fee_recipient.
        let admin_key = ctx.accounts.hackathon.admin;
        let hname     = ctx.accounts.hackathon.name.clone();
        let hbump     = ctx.accounts.hackathon.bump;
        let bump_arr  = [hbump];
        let seeds: &[&[u8]] = &[b"hackathon", admin_key.as_ref(), hname.as_bytes(), &bump_arr];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.escrow.to_account_info(),
                    to:        ctx.accounts.fee_recipient_token_account.to_account_info(),
                    authority: ctx.accounts.hackathon.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        ctx.accounts.project.deposit_forfeited = true;
        Ok(())
    }

    // ── 4.15  add_protocol_admin ──────────────────────────────────────────

    /// PROTOCOL_ADMIN delegates hackathon-creation and wallet-whitelisting
    /// rights to another wallet by minting a ProtocolAdminEntry PDA for it.
    /// The new admin can then call initialize_hackathon and whitelist_wallet
    /// once the contract is updated to check for this PDA.
    pub fn add_protocol_admin(ctx: Context<AddProtocolAdmin>) -> Result<()> {
        let entry = &mut ctx.accounts.admin_entry;
        entry.wallet = ctx.accounts.new_admin.key();
        entry.bump = ctx.bumps.admin_entry;
        Ok(())
    }

    // ── 4.16  remove_protocol_admin ───────────────────────────────────────

    /// Revokes a previously granted protocol admin entry, closing the PDA
    /// and returning its rent lamports to PROTOCOL_ADMIN.
    pub fn remove_protocol_admin(_ctx: Context<RemoveProtocolAdmin>) -> Result<()> {
        Ok(())
    }

    // ── 4.17  whitelist_wallet ────────────────────────────────────────────

    /// Admin creates a per-hackathon whitelist entry for a wallet, allowing it
    /// to call `stake`. Only whitelisted wallets may stake; builders who call
    /// `self_stake` are exempt from this check (they are already gated by
    /// project ownership and the deposit requirement).
    pub fn whitelist_wallet(ctx: Context<WhitelistWallet>) -> Result<()> {
        hackathon_admin_auth_offset(
            &ctx.accounts.admin.key(),
            &ctx.accounts.hackathon.admin,
            ctx.remaining_accounts,
        )?;
        let entry = &mut ctx.accounts.whitelist_entry;
        entry.hackathon = ctx.accounts.hackathon.key();
        entry.wallet = ctx.accounts.wallet.key();
        entry.bump = ctx.bumps.whitelist_entry;
        Ok(())
    }

    // ── 4.18  migrate_hackathon_v1 ────────────────────────────────────────
    //
    // One-time migration for HackathonState accounts created before the
    // deposit/fee/start_timestamp fields were added (old SPACE = 186 bytes).
    // Reallocates the account to HackathonState::SPACE (301 bytes) and fills
    // in default values for the new fields (including tier_c_totals = [0; 8]).
    //
    // Old layout (borsh, 186 bytes):
    //   disc(8) | admin(32) | usdc_mint(32) | name(4+len) |
    //   results_ts(8) | cutoff_ts(8) | total_pool(8) |
    //   is_resolved(1) | tier_count(1) | tier_pcts([u8;8]) |
    //   tier_expected([u8;8]) | effective_tier_pcts([u16;8]) |
    //   bump(1) | escrow_bump(1)
    //
    // New layout adds: start_ts(8) after cutoff_ts, then fee_recipient(32),
    //   protocol_fee_bps(2), deposit_amount(8), requires_approval(1) after
    //   effective_tier_pcts, before bump/escrow_bump.
    // ── 4.19  migrate_project_v1 ──────────────────────────────────────────
    //
    // One-time migration for ProjectAccount created before total_shares and
    // builder-deposit fields were added (old SPACE = 256 bytes → new 324).
    //
    // Old layout (borsh, 256 bytes):
    //   disc(8) | hackathon(32) | github_url(4+200) | total_staked(8) |
    //   rank(1) | is_registered(1) | is_refund_enabled(1) | bump(1)
    //
    // New layout inserts total_shares(8) after total_staked, then appends
    //   builder_wallet(32), deposit_amount_paid(8), submitted(1),
    //   deposit_refunded(1), deposit_forfeited(1), builder_staked(8),
    //   builder_declared(1), declared_at(8) before the final bump.
    // ── 4.20  migrate_project_v2 ──────────────────────────────────────────
    //
    // Migrates ProjectAccount from intermediate layout (288 bytes, which had
    // builder_wallet but not total_shares or deposit fields) to current 324.
    //
    // Intermediate layout (288 bytes, max url 200):
    //   disc(8) | hackathon(32) | github_url(4+200) | total_staked(8) |
    //   rank(1) | is_registered(1) | is_refund_enabled(1) |
    //   builder_wallet(32) | bump(1)
    //
    // New layout adds total_shares(8) after total_staked, then appends
    //   deposit_amount_paid(8), submitted(1), deposit_refunded(1),
    //   deposit_forfeited(1), builder_staked(8), builder_declared(1),
    //   declared_at(8) before the final bump.
    pub fn migrate_project_v2(ctx: Context<MigrateProjectV2>) -> Result<()> {
        use anchor_lang::solana_program::system_instruction;
        use anchor_lang::solana_program::program::invoke;

        let info    = ctx.accounts.project.to_account_info();
        let old_len = info.data_len();
        require!(old_len == 288, BettingError::AlreadyMigrated);

        let old: Vec<u8> = info.data.borrow().to_vec();

        let hackathon_pk = Pubkey::try_from(&old[8..40]).unwrap();

        let url_len = u32::from_le_bytes(old[40..44].try_into().unwrap()) as usize;
        require!(url_len <= ProjectAccount::MAX_URL, BettingError::UrlTooLong);
        let github_url = std::str::from_utf8(&old[44..44 + url_len])
            .map_err(|_| error!(BettingError::UrlTooLong))?
            .to_string();

        let fo = 44 + url_len;

        let total_staked      = u64::from_le_bytes(old[fo..fo+8].try_into().unwrap());
        let rank              = old[fo + 8];
        let is_registered     = old[fo + 9] != 0;
        let is_refund_enabled = old[fo + 10] != 0;
        let builder_wallet    = Pubkey::try_from(&old[fo+11..fo+43]).unwrap();
        let bump              = old[fo + 43];

        let rent             = Rent::get()?;
        let new_len          = ProjectAccount::SPACE;
        let min_lamports     = rent.minimum_balance(new_len);
        let current_lamports = info.lamports();
        if current_lamports < min_lamports {
            let shortfall = min_lamports - current_lamports;
            invoke(
                &system_instruction::transfer(
                    ctx.accounts.payer.key,
                    info.key,
                    shortfall,
                ),
                &[
                    ctx.accounts.payer.to_account_info(),
                    info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        info.realloc(new_len, true)?;

        let new_state = ProjectAccount {
            hackathon: hackathon_pk,
            github_url,
            total_staked,
            total_shares:        0,
            rank,
            is_registered,
            is_refund_enabled,
            builder_wallet,
            deposit_amount_paid: 0,
            submitted:           false,
            deposit_refunded:    false,
            deposit_forfeited:   false,
            builder_staked:      0,
            builder_declared:    false,
            declared_at:         0,
            bump,
        };

        let disc = ProjectAccount::DISCRIMINATOR;
        let body = borsh::to_vec(&new_state)?;
        let mut data = info.data.borrow_mut();
        data[..8].copy_from_slice(&disc);
        data[8..8 + body.len()].copy_from_slice(&body);

        Ok(())
    }

    pub fn migrate_project_v1(ctx: Context<MigrateProjectV1>) -> Result<()> {
        use anchor_lang::solana_program::system_instruction;
        use anchor_lang::solana_program::program::invoke;

        let info    = ctx.accounts.project.to_account_info();
        let old_len = info.data_len();
        require!(old_len == 256, BettingError::AlreadyMigrated);

        let old: Vec<u8> = info.data.borrow().to_vec();

        // hackathon pubkey at offset 8
        let hackathon_pk = Pubkey::try_from(&old[8..40]).unwrap();

        // Borsh variable-length github_url at offset 40
        let url_len = u32::from_le_bytes(old[40..44].try_into().unwrap()) as usize;
        require!(url_len <= ProjectAccount::MAX_URL, BettingError::UrlTooLong);
        let github_url = std::str::from_utf8(&old[44..44 + url_len])
            .map_err(|_| error!(BettingError::UrlTooLong))?
            .to_string();

        let fo = 44 + url_len; // offset of fields after url

        let total_staked    = u64::from_le_bytes(old[fo..fo+8].try_into().unwrap());
        let rank            = old[fo + 8];
        let is_registered   = old[fo + 9] != 0;
        let is_refund_enabled = old[fo + 10] != 0;
        let bump            = old[fo + 11];

        // Fund rent increase if needed
        let rent             = Rent::get()?;
        let new_len          = ProjectAccount::SPACE;
        let min_lamports     = rent.minimum_balance(new_len);
        let current_lamports = info.lamports();
        if current_lamports < min_lamports {
            let shortfall = min_lamports - current_lamports;
            invoke(
                &system_instruction::transfer(
                    ctx.accounts.payer.key,
                    info.key,
                    shortfall,
                ),
                &[
                    ctx.accounts.payer.to_account_info(),
                    info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        info.realloc(new_len, true)?;

        let new_state = ProjectAccount {
            hackathon: hackathon_pk,
            github_url,
            total_staked,
            total_shares:        0,
            rank,
            is_registered,
            is_refund_enabled,
            builder_wallet:      Pubkey::default(),
            deposit_amount_paid: 0,
            submitted:           false,
            deposit_refunded:    false,
            deposit_forfeited:   false,
            builder_staked:      0,
            builder_declared:    false,
            declared_at:         0,
            bump,
        };

        let disc = ProjectAccount::DISCRIMINATOR;
        let body = borsh::to_vec(&new_state)?;
        let mut data = info.data.borrow_mut();
        data[..8].copy_from_slice(&disc);
        data[8..8 + body.len()].copy_from_slice(&body);

        Ok(())
    }

    pub fn migrate_hackathon_v1(ctx: Context<MigrateHackathonV1>) -> Result<()> {
        use anchor_lang::solana_program::system_instruction;
        use anchor_lang::solana_program::program::invoke;

        let info    = ctx.accounts.hackathon.to_account_info();
        let old_len = info.data_len();
        require!(old_len == 186, BettingError::AlreadyMigrated);

        // ── Read all old field values from raw bytes ──────────────────────
        let old: Vec<u8> = info.data.borrow().to_vec();

        let admin_pk    = Pubkey::try_from(&old[8..40]).unwrap();
        let usdc_mint   = Pubkey::try_from(&old[40..72]).unwrap();

        // Borsh variable-length name
        let name_len    = u32::from_le_bytes(old[72..76].try_into().unwrap()) as usize;
        require!(name_len <= NAME_MAX_LEN, BettingError::NameTooLong);
        let name        = std::str::from_utf8(&old[76..76 + name_len])
            .map_err(|_| error!(BettingError::NameTooLong))?
            .to_string();

        let fo = 76 + name_len; // first byte of fields after name

        let results_ts  = i64::from_le_bytes(old[fo..fo+8].try_into().unwrap());
        let cutoff_ts   = i64::from_le_bytes(old[fo+8..fo+16].try_into().unwrap());
        let total_pool  = u64::from_le_bytes(old[fo+16..fo+24].try_into().unwrap());
        let is_resolved = old[fo+24] != 0;
        let tier_count  = old[fo+25];
        let tier_pcts: [u8; MAX_TIERS]      = old[fo+26..fo+34].try_into().unwrap();
        let tier_exp: [u8; MAX_TIERS]        = old[fo+34..fo+42].try_into().unwrap();
        let mut eff_pcts = [0u16; MAX_TIERS];
        for i in 0..MAX_TIERS {
            eff_pcts[i] = u16::from_le_bytes(old[fo+42+i*2..fo+44+i*2].try_into().unwrap());
        }
        let bump        = old[fo + 58];
        let escrow_bump = old[fo + 59];

        // ── Fund the size increase with payer lamports if needed ──────────
        let rent        = Rent::get()?;
        let new_len     = HackathonState::SPACE;
        let min_lamports = rent.minimum_balance(new_len);
        let current_lamports = info.lamports();
        if current_lamports < min_lamports {
            let shortfall = min_lamports - current_lamports;
            invoke(
                &system_instruction::transfer(
                    ctx.accounts.payer.key,
                    info.key,
                    shortfall,
                ),
                &[
                    ctx.accounts.payer.to_account_info(),
                    info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        // ── Realloc to new size ───────────────────────────────────────────
        info.realloc(new_len, true)?;

        // ── Write new HackathonState (discriminator + borsh body) ─────────
        let new_state = HackathonState {
            admin: admin_pk,
            usdc_mint,
            name,
            irl_hackathon_deadline_timestamp:   results_ts,
            cutoff_timestamp:    cutoff_ts,
            start_timestamp:     0,   // migration default; unknown original start
            total_pool,
            is_resolved,
            tier_count,
            tier_pcts,
            tier_expected_counts: tier_exp,
            effective_tier_pcts:  eff_pcts,
            tier_c_totals:        [0u64; MAX_TIERS], // filled by finalize_resolve if not yet run
            fee_recipient:        admin_pk,   // fees default to admin
            protocol_fee_bps:     0,
            deposit_amount:       0,
            requires_approval:    false,
            bump,
            escrow_bump,
            ranked_count:         0,
            open_staking:         true,
        };

        let disc = HackathonState::DISCRIMINATOR;
        let body = borsh::to_vec(&new_state)?;
        let mut data = info.data.borrow_mut();
        data[..8].copy_from_slice(&disc);
        data[8..8 + body.len()].copy_from_slice(&body);

        Ok(())
    }

    // ── 4.21  migrate_hackathon_v2 ────────────────────────────────────────
    //
    // One-time migration for HackathonState accounts at layout v1 (301 bytes,
    // lacking the ranked_count field) to the current layout (305 bytes).
    // Sets ranked_count = 0. Accounts that have already been resolved are safe
    // because finalize_resolve is idempotent-gated by is_resolved; accounts
    // with outstanding ranked-but-not-finalized projects will need the admin
    // to re-call resolve() after migration to rebuild ranked_count correctly.
    pub fn migrate_hackathon_v2(ctx: Context<MigrateHackathonV2>) -> Result<()> {
        use anchor_lang::solana_program::system_instruction;
        use anchor_lang::solana_program::program::invoke;

        let info    = ctx.accounts.hackathon.to_account_info();
        let old_len = info.data_len();
        require!(old_len == 301, BettingError::AlreadyMigrated);

        let old: Vec<u8> = info.data.borrow().to_vec();

        let admin_pk  = Pubkey::try_from(&old[8..40]).unwrap();
        let usdc_mint = Pubkey::try_from(&old[40..72]).unwrap();

        let name_len = u32::from_le_bytes(old[72..76].try_into().unwrap()) as usize;
        require!(name_len <= NAME_MAX_LEN, BettingError::NameTooLong);
        let name = std::str::from_utf8(&old[76..76 + name_len])
            .map_err(|_| error!(BettingError::NameTooLong))?
            .to_string();

        let fo = 76 + name_len;

        let results_ts  = i64::from_le_bytes(old[fo..fo+8].try_into().unwrap());
        let cutoff_ts   = i64::from_le_bytes(old[fo+8..fo+16].try_into().unwrap());
        let start_ts    = i64::from_le_bytes(old[fo+16..fo+24].try_into().unwrap());
        let total_pool  = u64::from_le_bytes(old[fo+24..fo+32].try_into().unwrap());
        let is_resolved = old[fo+32] != 0;
        let tier_count  = old[fo+33];
        let tier_pcts: [u8; MAX_TIERS]  = old[fo+34..fo+42].try_into().unwrap();
        let tier_exp: [u8; MAX_TIERS]   = old[fo+42..fo+50].try_into().unwrap();
        let mut eff_pcts = [0u16; MAX_TIERS];
        for i in 0..MAX_TIERS {
            eff_pcts[i] = u16::from_le_bytes(old[fo+50+i*2..fo+52+i*2].try_into().unwrap());
        }
        let mut c_totals = [0u64; MAX_TIERS];
        for i in 0..MAX_TIERS {
            c_totals[i] = u64::from_le_bytes(old[fo+66+i*8..fo+74+i*8].try_into().unwrap());
        }
        let fee_recipient = Pubkey::try_from(&old[fo+130..fo+162]).unwrap();
        let protocol_fee_bps = u16::from_le_bytes(old[fo+162..fo+164].try_into().unwrap());
        let deposit_amount   = u64::from_le_bytes(old[fo+164..fo+172].try_into().unwrap());
        let requires_approval = old[fo+172] != 0;
        let bump        = old[fo+173];
        let escrow_bump = old[fo+174];

        let rent = Rent::get()?;
        let new_len = HackathonState::SPACE;
        let min_lamports = rent.minimum_balance(new_len);
        let current_lamports = info.lamports();
        if current_lamports < min_lamports {
            let shortfall = min_lamports - current_lamports;
            invoke(
                &system_instruction::transfer(
                    ctx.accounts.payer.key,
                    info.key,
                    shortfall,
                ),
                &[
                    ctx.accounts.payer.to_account_info(),
                    info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        info.realloc(new_len, true)?;

        let new_state = HackathonState {
            admin: admin_pk,
            usdc_mint,
            name,
            irl_hackathon_deadline_timestamp:    results_ts,
            cutoff_timestamp:     cutoff_ts,
            start_timestamp:      start_ts,
            total_pool,
            is_resolved,
            tier_count,
            tier_pcts,
            tier_expected_counts: tier_exp,
            effective_tier_pcts:  eff_pcts,
            tier_c_totals:        c_totals,
            fee_recipient,
            protocol_fee_bps,
            deposit_amount,
            requires_approval,
            bump,
            escrow_bump,
            ranked_count: 0,
            open_staking: true,
        };

        let disc = HackathonState::DISCRIMINATOR;
        let body = borsh::to_vec(&new_state)?;
        let mut data = info.data.borrow_mut();
        data[..8].copy_from_slice(&disc);
        data[8..8 + body.len()].copy_from_slice(&body);

        Ok(())
    }

    // ── 4.22  migrate_hackathon_v3 ────────────────────────────────────────
    //
    // One-time migration for HackathonState accounts at layout v2 (305 bytes,
    // lacking open_staking) to the current layout (306 bytes).
    // Sets open_staking = true so existing hackathons default to open access.
    pub fn migrate_hackathon_v3(ctx: Context<MigrateHackathonV3>) -> Result<()> {
        use anchor_lang::solana_program::system_instruction;
        use anchor_lang::solana_program::program::invoke;

        let info    = ctx.accounts.hackathon.to_account_info();
        let old_len = info.data_len();
        require!(old_len == 305, BettingError::AlreadyMigrated);

        let old: Vec<u8> = info.data.borrow().to_vec();

        let admin_pk  = Pubkey::try_from(&old[8..40]).unwrap();
        let usdc_mint = Pubkey::try_from(&old[40..72]).unwrap();

        let name_len = u32::from_le_bytes(old[72..76].try_into().unwrap()) as usize;
        require!(name_len <= NAME_MAX_LEN, BettingError::NameTooLong);
        let name = std::str::from_utf8(&old[76..76 + name_len])
            .map_err(|_| error!(BettingError::NameTooLong))?
            .to_string();

        let fo = 76 + name_len;

        let results_ts  = i64::from_le_bytes(old[fo..fo+8].try_into().unwrap());
        let cutoff_ts   = i64::from_le_bytes(old[fo+8..fo+16].try_into().unwrap());
        let start_ts    = i64::from_le_bytes(old[fo+16..fo+24].try_into().unwrap());
        let total_pool  = u64::from_le_bytes(old[fo+24..fo+32].try_into().unwrap());
        let is_resolved = old[fo+32] != 0;
        let tier_count  = old[fo+33];
        let tier_pcts: [u8; MAX_TIERS]  = old[fo+34..fo+42].try_into().unwrap();
        let tier_exp: [u8; MAX_TIERS]   = old[fo+42..fo+50].try_into().unwrap();
        let mut eff_pcts = [0u16; MAX_TIERS];
        for i in 0..MAX_TIERS {
            eff_pcts[i] = u16::from_le_bytes(old[fo+50+i*2..fo+52+i*2].try_into().unwrap());
        }
        let mut c_totals = [0u64; MAX_TIERS];
        for i in 0..MAX_TIERS {
            c_totals[i] = u64::from_le_bytes(old[fo+66+i*8..fo+74+i*8].try_into().unwrap());
        }
        let fee_recipient = Pubkey::try_from(&old[fo+130..fo+162]).unwrap();
        let protocol_fee_bps = u16::from_le_bytes(old[fo+162..fo+164].try_into().unwrap());
        let deposit_amount   = u64::from_le_bytes(old[fo+164..fo+172].try_into().unwrap());
        let requires_approval = old[fo+172] != 0;
        let bump        = old[fo+173];
        let escrow_bump = old[fo+174];
        let ranked_count = u32::from_le_bytes(old[fo+175..fo+179].try_into().unwrap());

        let rent = Rent::get()?;
        let new_len = HackathonState::SPACE;
        let min_lamports = rent.minimum_balance(new_len);
        let current_lamports = info.lamports();
        if current_lamports < min_lamports {
            let shortfall = min_lamports - current_lamports;
            invoke(
                &system_instruction::transfer(
                    ctx.accounts.payer.key,
                    info.key,
                    shortfall,
                ),
                &[
                    ctx.accounts.payer.to_account_info(),
                    info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        info.realloc(new_len, true)?;

        let new_state = HackathonState {
            admin: admin_pk,
            usdc_mint,
            name,
            irl_hackathon_deadline_timestamp:    results_ts,
            cutoff_timestamp:     cutoff_ts,
            start_timestamp:      start_ts,
            total_pool,
            is_resolved,
            tier_count,
            tier_pcts,
            tier_expected_counts: tier_exp,
            effective_tier_pcts:  eff_pcts,
            tier_c_totals:        c_totals,
            fee_recipient,
            protocol_fee_bps,
            deposit_amount,
            requires_approval,
            bump,
            escrow_bump,
            ranked_count,
            open_staking: true,
        };

        let disc = HackathonState::DISCRIMINATOR;
        let body = borsh::to_vec(&new_state)?;
        let mut data = info.data.borrow_mut();
        data[..8].copy_from_slice(&disc);
        data[8..8 + body.len()].copy_from_slice(&body);

        Ok(())
    }
}

// ── Account structs ────────────────────────────────────────────────────────

#[account]
pub struct HackathonState {
    pub admin: Pubkey,                          // 32
    pub usdc_mint: Pubkey,                      // 32
    pub name: String,                           // 4 + NAME_MAX_LEN
    pub irl_hackathon_deadline_timestamp: i64,                 // 8
    pub cutoff_timestamp: i64,                  // 8
    pub start_timestamp: i64,                   // 8
    pub total_pool: u64,                        // 8
    pub is_resolved: bool,                      // 1
    pub tier_count: u8,                         // 1
    pub tier_pcts: [u8; MAX_TIERS],             // 8  — configured at init, sum=100
    pub tier_expected_counts: [u8; MAX_TIERS],  // 8  — expected project count per tier; used in per-project payout math
    pub effective_tier_pcts: [u16; MAX_TIERS],  // 16 — computed at finalize_resolve (bps)
    pub tier_c_totals: [u64; MAX_TIERS],        // 64 — number of payout-eligible ranked projects per tier, snapshotted at finalize_resolve
    pub fee_recipient: Pubkey,                  // 32 — wallet receiving protocol fees
    pub protocol_fee_bps: u16,                  // 2  — fee on claim payouts (e.g. 150 = 1.5%)
    pub deposit_amount: u64,                    // 8  — required builder deposit (0 = no deposit required)
    pub requires_approval: bool,                // 1  — retained for backwards compatibility; deposit refunds now require organizer approval unless refund override is enabled
    pub bump: u8,                               // 1
    pub escrow_bump: u8,                        // 1
    pub ranked_count: u32,                      // 4  — total projects assigned a rank via resolve() (all ranked, regardless of deposit/stake); completeness counter for finalize_resolve
    pub open_staking: bool,                     // 1  — when true, whitelist PDA check is skipped; access enforced off-chain
}

impl HackathonState {
    pub const SPACE: usize = 8  // discriminator
        + 32  // admin
        + 32  // usdc_mint
        + 4 + NAME_MAX_LEN  // name (4-byte length prefix + max 50 bytes)
        + 8   // irl_hackathon_deadline_timestamp
        + 8   // cutoff_timestamp
        + 8   // start_timestamp
        + 8   // total_pool
        + 1   // is_resolved
        + 1   // tier_count
        + 8   // tier_pcts
        + 8   // tier_expected_counts
        + 16  // effective_tier_pcts
        + 64  // tier_c_totals
        + 32  // fee_recipient
        + 2   // protocol_fee_bps
        + 8   // deposit_amount
        + 1   // requires_approval
        + 1   // bump
        + 1   // escrow_bump
        + 4   // ranked_count
        + 1;  // open_staking
}

#[account]
pub struct ProjectAccount {
    pub hackathon: Pubkey,
    pub github_url: String,         // ≤ MAX_URL bytes
    pub total_staked: u64,
    pub total_shares: u64,
    pub rank: u8,                   // 0 = unranked
    pub is_registered: bool,
    pub is_refund_enabled: bool,    // admin can enable for exceptional refunds
    pub builder_wallet: Pubkey,     // wallet that registered the project; gates deposit/submit/refund
    pub deposit_amount_paid: u64,   // USDC paid into escrow as commitment deposit
    pub submitted: bool,            // set by approve_submissions when organizer confirms submission
    pub deposit_refunded: bool,     // set when builder claims deposit back
    pub deposit_forfeited: bool,    // set when admin forfeits deposit of a ghost builder
    pub builder_staked: u64,        // cumulative self-stake by the builder_wallet
    pub builder_declared: bool,     // set by submit_project — builder's on-chain declaration of submission
    pub declared_at: i64,           // unix timestamp of submit_project call
    pub bump: u8,
}

impl ProjectAccount {
    pub const MAX_URL: usize = 200;
    pub const SPACE: usize = 8
        + 32                       // hackathon
        + 4 + Self::MAX_URL        // github_url (4-byte length prefix + data)
        + 8                        // total_staked
        + 8                        // total_shares
        + 1                        // rank
        + 1                        // is_registered
        + 1                        // is_refund_enabled
        + 32                       // builder_wallet
        + 8                        // deposit_amount_paid
        + 1                        // submitted
        + 1                        // deposit_refunded
        + 1                        // deposit_forfeited
        + 8                        // builder_staked
        + 1                        // builder_declared
        + 8                        // declared_at
        + 1;                       // bump
}

#[account]
pub struct UserStake {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub stake_timestamp: i64,
    pub is_claimed: bool,
    pub bump: u8,
}

impl UserStake {
    pub const SPACE: usize = 8
        + 32  // user
        + 32  // project
        + 8   // amount
        + 8   // shares
        + 8   // stake_timestamp
        + 1   // is_claimed
        + 1;  // bump
}

#[account]
pub struct WhitelistedWallet {
    pub hackathon: Pubkey,  // 32
    pub wallet: Pubkey,     // 32
    pub bump: u8,           // 1
}

impl WhitelistedWallet {
    pub const SPACE: usize = 8 + 32 + 32 + 1;
}

#[account]
pub struct ProtocolAdminEntry {
    pub wallet: Pubkey,  // 32
    pub bump: u8,        // 1
}

impl ProtocolAdminEntry {
    pub const SPACE: usize = 8 + 32 + 1;
}

// ── Instruction contexts ───────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeHackathon<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = HackathonState::SPACE,
        seeds = [b"hackathon", admin.key().as_ref(), name.as_bytes()],
        bump,
    )]
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        init,
        payer = admin,
        token::mint      = usdc_mint,
        token::authority = hackathon,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(github_url: String, url_hash: [u8; 32])]
pub struct RegisterProject<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    /// CHECK: builder wallet recorded on project. Must equal caller when requires_approval is false.
    pub builder: UncheckedAccount<'info>,
    #[account(
        init,
        payer = caller,
        space = ProjectAccount::SPACE,
        seeds = [b"project", hackathon.key().as_ref(), url_hash.as_ref()],
        bump,
    )]
    pub project: Account<'info, ProjectAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub hackathon: Account<'info, HackathonState>,
    #[account(mut, has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::SPACE,
        seeds = [b"stake", user.key().as_ref(), project.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        mut,
        token::mint      = hackathon.usdc_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SelfStake<'info> {
    #[account(mut)]
    pub builder: Signer<'info>,
    #[account(mut)]
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        mut,
        has_one = hackathon,
        constraint = project.builder_wallet == builder.key() @ BettingError::NotBuilder,
    )]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        init_if_needed,
        payer = builder,
        space = UserStake::SPACE,
        seeds = [b"stake", builder.key().as_ref(), project.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        mut,
        token::mint      = hackathon.usdc_mint,
        token::authority = builder,
    )]
    pub builder_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = !hackathon.is_resolved @ BettingError::AlreadyResolved,
    )]
    pub hackathon: Account<'info, HackathonState>,
    #[account(mut, has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        seeds   = [b"stake", user.key().as_ref(), project.key().as_ref()],
        bump    = user_stake.bump,
        has_one = user,
        has_one = project,
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        mut,
        token::mint      = hackathon.usdc_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = fee_recipient_token_account.owner == hackathon.fee_recipient @ BettingError::InvalidFeeRecipient,
        token::mint = hackathon.usdc_mint,
    )]
    pub fee_recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        constraint = !hackathon.is_resolved @ BettingError::AlreadyResolved,
    )]
    pub hackathon: Account<'info, HackathonState>,
    #[account(mut, has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
}

#[derive(Accounts)]
pub struct FinalizeResolve<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        constraint = !hackathon.is_resolved @ BettingError::AlreadyResolved,
    )]
    pub hackathon: Account<'info, HackathonState>,
    // All ProjectAccounts passed as ctx.remaining_accounts.
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(constraint = hackathon.is_resolved @ BettingError::NotResolved)]
    pub hackathon: Account<'info, HackathonState>,
    #[account(has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        seeds   = [b"stake", user.key().as_ref(), project.key().as_ref()],
        bump    = user_stake.bump,
        has_one = user,
        has_one = project,
        constraint = !user_stake.is_claimed @ BettingError::AlreadyClaimed,
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        mut,
        token::mint      = hackathon.usdc_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = fee_recipient_token_account.owner == hackathon.fee_recipient @ BettingError::InvalidFeeRecipient,
        token::mint = hackathon.usdc_mint,
    )]
    pub fee_recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnableRefund<'info> {
    pub admin: Signer<'info>,
    #[account(
        constraint = !hackathon.is_resolved @ BettingError::RefundBlockedAfterResolution,
    )]
    pub hackathon: Account<'info, HackathonState>,
    #[account(mut, has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = !hackathon.is_resolved @ BettingError::RefundBlockedAfterResolution,
    )]
    pub hackathon: Account<'info, HackathonState>,
    #[account(mut, has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        seeds   = [b"stake", user.key().as_ref(), project.key().as_ref()],
        bump    = user_stake.bump,
        has_one = user,
        has_one = project,
        constraint = !user_stake.is_claimed @ BettingError::AlreadyClaimed,
    )]
    pub user_stake: Account<'info, UserStake>,
    #[account(
        mut,
        token::mint      = hackathon.usdc_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayDeposit<'info> {
    #[account(mut)]
    pub builder: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        mut,
        has_one = hackathon,
        constraint = project.builder_wallet == builder.key() @ BettingError::NotBuilder,
    )]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        token::mint      = hackathon.usdc_mint,
        token::authority = builder,
    )]
    pub builder_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitProject<'info> {
    pub builder: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        mut,
        has_one = hackathon,
        constraint = project.builder_wallet == builder.key() @ BettingError::NotBuilder,
    )]
    pub project: Account<'info, ProjectAccount>,
}

#[derive(Accounts)]
pub struct ApproveSubmissions<'info> {
    pub admin: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    // Approved ProjectAccount PDAs passed as writable remaining_accounts.
}

#[derive(Accounts)]
pub struct ClaimDepositRefund<'info> {
    #[account(mut)]
    pub builder: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        mut,
        has_one = hackathon,
        constraint = project.builder_wallet == builder.key() @ BettingError::NotBuilder,
        constraint = !project.deposit_refunded @ BettingError::DepositAlreadyRefunded,
    )]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        token::mint      = hackathon.usdc_mint,
        token::authority = builder,
    )]
    pub builder_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ForfeitDeposit<'info> {
    pub admin: Signer<'info>,
    #[account(mut)]
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        mut,
        has_one = hackathon,
        constraint = !project.deposit_forfeited @ BettingError::DepositAlreadyForfeited,
    )]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        constraint = fee_recipient_token_account.owner == hackathon.fee_recipient @ BettingError::InvalidFeeRecipient,
        token::mint = hackathon.usdc_mint,
    )]
    pub fee_recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump  = hackathon.escrow_bump,
        token::mint      = hackathon.usdc_mint,
        token::authority = hackathon,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferUpgradeAuthority<'info> {
    /// Current upgrade authority — must sign.
    pub current_authority: Signer<'info>,
    /// CHECK: this program's ProgramData account, derived from the program ID.
    /// The BPF loader verifies that current_authority is the actual upgrade authority.
    #[account(
        mut,
        address = anchor_lang::solana_program::bpf_loader_upgradeable::get_program_data_address(&crate::ID),
    )]
    pub program_data: UncheckedAccount<'info>,
    /// CHECK: the new upgrade authority. Must also sign (BPF SetAuthorityChecked).
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RevokeUpgradeAuthority<'info> {
    /// Current upgrade authority — must sign.
    pub current_authority: Signer<'info>,
    /// CHECK: this program's ProgramData account, derived from the program ID.
    /// The BPF loader verifies that current_authority is the actual upgrade authority.
    #[account(
        mut,
        address = anchor_lang::solana_program::bpf_loader_upgradeable::get_program_data_address(&crate::ID),
    )]
    pub program_data: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WhitelistWallet<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    /// CHECK: the wallet to whitelist — we only need its pubkey for the PDA seed.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = WhitelistedWallet::SPACE,
        seeds = [b"whitelist", hackathon.key().as_ref(), wallet.key().as_ref()],
        bump,
    )]
    pub whitelist_entry: Account<'info, WhitelistedWallet>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddProtocolAdmin<'info> {
    #[account(
        mut,
        address = PROTOCOL_ADMIN @ BettingError::Unauthorized,
    )]
    pub authority: Signer<'info>,
    /// CHECK: the wallet being granted protocol admin rights.
    pub new_admin: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = ProtocolAdminEntry::SPACE,
        seeds = [b"protocol_admin", new_admin.key().as_ref()],
        bump,
    )]
    pub admin_entry: Account<'info, ProtocolAdminEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveProtocolAdmin<'info> {
    #[account(
        mut,
        address = PROTOCOL_ADMIN @ BettingError::Unauthorized,
    )]
    pub authority: Signer<'info>,
    /// CHECK: the wallet whose admin entry is being revoked.
    pub admin_wallet: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"protocol_admin", admin_wallet.key().as_ref()],
        bump = admin_entry.bump,
        close = authority,
    )]
    pub admin_entry: Account<'info, ProtocolAdminEntry>,
}

#[derive(Accounts)]
pub struct MigrateProjectV2<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: intentionally unchecked — intermediate layout, manually migrated.
    #[account(mut, owner = crate::ID @ BettingError::Unauthorized)]
    pub project: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateProjectV1<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: intentionally unchecked — old layout, manually migrated.
    #[account(mut, owner = crate::ID @ BettingError::Unauthorized)]
    pub project: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateHackathonV1<'info> {
    /// Any signer can pay for the rent increase; the instruction is safe
    /// because it only operates on accounts that are exactly 186 bytes
    /// (the old layout size) and owned by this program.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: intentionally unchecked — this account has old layout bytes
    /// that Anchor cannot deserialize with the current struct definition.
    /// The instruction reads and rewrites the bytes manually.
    #[account(mut, owner = crate::ID @ BettingError::Unauthorized)]
    pub hackathon: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateHackathonV2<'info> {
    /// Any signer can pay for the rent increase; safe because the instruction
    /// only operates on accounts that are exactly 301 bytes (v1 layout size)
    /// and owned by this program.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: intentionally unchecked — v1 layout, manually migrated to v2.
    #[account(mut, owner = crate::ID @ BettingError::Unauthorized)]
    pub hackathon: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateHackathonV3<'info> {
    /// Any signer can pay for the rent increase; safe because the instruction
    /// only operates on accounts that are exactly 305 bytes (v2 layout size)
    /// and owned by this program.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: intentionally unchecked — v2 layout, manually migrated to v3.
    #[account(mut, owner = crate::ID @ BettingError::Unauthorized)]
    pub hackathon: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
