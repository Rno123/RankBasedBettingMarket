use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");

// ── Protocol constants ─────────────────────────────────────────────────────

/// Seconds before results_timestamp after which unstaking is forbidden.
pub const SELL_CUTOFF_SECS: i64 = 86_400;
/// Fixed unstake penalty in basis points (3%).
pub const UNSTAKE_PENALTY_BPS: u64 = 300;
/// Portion of the unstake penalty routed to fee_recipient (1.5%).
pub const UNSTAKE_PROTOCOL_BPS: u64 = 150;
/// Shares multiplier at t=0 in basis points (1.5×).
pub const EARLY_MULTIPLIER_BPS: u64 = 15_000;
/// Shares multiplier at cutoff in basis points (1.0×).
pub const BASE_MULTIPLIER_BPS: u64 = 10_000;
/// Hard cap on stake per wallet per project ($2 000, 6 decimals).
pub const MAX_STAKE_PER_WALLET: u64 = 2_000_000_000;
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
/// Maximum cumulative self-stake a builder may place on their own project ($2 000, 6 decimals).
pub const MAX_SELF_STAKE: u64 = 2_000_000_000;

/// Protocol-level admin: the only wallet allowed to call initialize_hackathon.
pub const PROTOCOL_ADMIN: Pubkey = anchor_lang::solana_program::pubkey!("5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP");

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
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/// Integer square root — floor(sqrt(n)). Newton's method, no f64.
fn isqrt(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) >> 1;
    while y < x {
        x = y;
        y = (x + n / x) >> 1;
    }
    x
}

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

// ── Program ────────────────────────────────────────────────────────────────

#[program]
pub mod hackathon_betting {
    use super::*;

    // ── 4.1  initialize_hackathon ──────────────────────────────────────────

    /// Creates a HackathonState PDA and its USDC escrow token account.
    ///
    /// `tier_pcts` defines the pool allocation per winner tier (must sum to 100).
    /// `tier_expected_counts` is stored for UI/validation only; does not affect math.
    pub fn initialize_hackathon(
        ctx: Context<InitializeHackathon>,
        name: String,
        results_timestamp: i64,
        tier_pcts: Vec<u8>,
        tier_expected_counts: Vec<u8>,
        fee_recipient: Pubkey,
        protocol_fee_bps: u16,
        deposit_amount: u64,
        requires_approval: bool,
    ) -> Result<()> {
        require!(name.len() <= NAME_MAX_LEN, BettingError::NameTooLong);

        let now = Clock::get()?.unix_timestamp;
        require!(results_timestamp > now, BettingError::InvalidTimestamp);

        let n = tier_pcts.len();
        let pct_sum: u32 = tier_pcts.iter().map(|&v| v as u32).sum();
        require!(
            n >= 1
                && n <= MAX_TIERS
                && n == tier_expected_counts.len()
                && pct_sum == 100,
            BettingError::InvalidTierConfig,
        );

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
        h.results_timestamp = results_timestamp;
        h.cutoff_timestamp = results_timestamp
            .checked_sub(SELL_CUTOFF_SECS)
            .ok_or(BettingError::Overflow)?;
        h.total_pool = 0;
        h.is_resolved = false;
        h.tier_count = n as u8;
        h.tier_pcts = t_pcts;
        h.tier_expected_counts = t_counts;
        h.effective_tier_pcts = [0u16; MAX_TIERS];
        h.fee_recipient = fee_recipient;
        h.protocol_fee_bps = protocol_fee_bps;
        h.deposit_amount = deposit_amount;
        h.requires_approval = requires_approval;
        h.bump = ctx.bumps.hackathon;
        h.escrow_bump = ctx.bumps.escrow;
        Ok(())
    }

    // ── 4.2  register_project ─────────────────────────────────────────────

    pub fn register_project(
        ctx: Context<RegisterProject>,
        github_url: String,
        url_hash: [u8; 32],
    ) -> Result<()> {
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
        p.builder_wallet = ctx.accounts.payer.key();
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
    /// Maximum cumulative: MAX_SELF_STAKE ($5 000) — prevents whale builders
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

        // Deposit must be paid before builder can self-stake.
        require!(
            ctx.accounts.project.deposit_amount_paid > 0,
            BettingError::DepositNotPaid,
        );

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
    /// Must be called before cutoff_timestamp (after cutoff, staking is frozen
    /// anyway so a declaration has no effect for backers).
    /// Sets builder_declared = true and records the timestamp.
    /// When hackathon.requires_approval = false, this is sufficient to unlock
    /// claim_deposit_refund. When requires_approval = true, the organizer must
    /// also run approve_submissions.
    pub fn submit_project(ctx: Context<SubmitProject>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.cutoff_timestamp,
            BettingError::CutoffPassed,
        );
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
    ///   pool_fee      = penalty − protocol_fee                             (1%, stays in escrow)
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.cutoff_timestamp,
            BettingError::CutoffPassed,
        );

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
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.hackathon.results_timestamp,
            BettingError::ResultsNotYet,
        );
        require!(rank >= 1, BettingError::InvalidRank);
        ctx.accounts.project.rank = rank;
        Ok(())
    }

    // ── 4.5b  finalize_resolve ────────────────────────────────────────────

    /// Computes effective tier percentages with Option B proportional cascade,
    /// stores them as basis points in `effective_tier_pcts`, then sets
    /// `is_resolved = true`.
    ///
    /// **Cascade rule:** If a tier has no ranked project in remaining_accounts,
    /// its configured pool percentage is redistributed proportionally among all
    /// tiers that do have projects.  Zero-staked ranked projects still occupy
    /// their tier (the cascade is about tier representation, not stake size).
    ///
    /// remaining_accounts: all registered ProjectAccounts for this hackathon.
    pub fn finalize_resolve(ctx: Context<FinalizeResolve>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.hackathon.results_timestamp,
            BettingError::ResultsNotYet,
        );

        let hackathon_key = ctx.accounts.hackathon.key();
        let tier_count = ctx.accounts.hackathon.tier_count as usize;
        let tier_pcts = ctx.accounts.hackathon.tier_pcts;

        // Determine which tiers are represented by at least one ranked project.
        let mut tier_has_projects = [false; MAX_TIERS];
        for acc in ctx.remaining_accounts.iter() {
            if acc.owner != &crate::ID {
                continue;
            }
            let data = acc.try_borrow_data()?;
            let project = ProjectAccount::try_deserialize(&mut data.as_ref())?;
            if project.hackathon != hackathon_key || project.rank == 0 {
                continue;
            }
            let tier = rank_to_tier_idx(project.rank, tier_count as u8);
            tier_has_projects[tier] = true;
        }

        // Sum basis points in occupied tiers (each tier_pct × 100 gives bps).
        let mut total_non_empty_bps: u32 = 0;
        for i in 0..tier_count {
            if tier_has_projects[i] {
                total_non_empty_bps = total_non_empty_bps
                    .checked_add(tier_pcts[i] as u32 * 100)
                    .ok_or(BettingError::Overflow)?;
            }
        }
        require!(total_non_empty_bps > 0, BettingError::AllTiersEmpty);

        // Proportional cascade:
        //   effective_bps[j] = floor(tier_pcts[j] * 1_000_000 / total_non_empty_bps)
        // The last occupied tier absorbs rounding dust so the sum is exactly 10_000.
        let mut effective = [0u16; MAX_TIERS];
        let mut allocated: u32 = 0;
        let mut last_non_empty: usize = 0;
        for i in 0..tier_count {
            if tier_has_projects[i] {
                last_non_empty = i;
            }
        }
        for i in 0..tier_count {
            if !tier_has_projects[i] {
                continue;
            }
            if i == last_non_empty {
                effective[i] = TIER_BPS_TOTAL.saturating_sub(allocated) as u16;
            } else {
                let v = (tier_pcts[i] as u32)
                    .checked_mul(1_000_000)
                    .ok_or(BettingError::Overflow)?
                    .checked_div(total_non_empty_bps)
                    .unwrap_or(0);
                effective[i] = v as u16;
                allocated = allocated.checked_add(v).ok_or(BettingError::Overflow)?;
            }
        }

        let h = &mut ctx.accounts.hackathon;
        h.effective_tier_pcts = effective;
        h.is_resolved = true;
        Ok(())
    }

    // ── 4.6  claim ────────────────────────────────────────────────────────

    /// Computes and transfers the user's payout using a two-stage tier formula.
    ///
    /// Stage 1 — tier allocation (from effective_tier_pcts set at finalize_resolve):
    ///   P_t = effective_tier_pcts[tier_of(project.rank)]  (basis points)
    ///
    /// Stage 2 — within-tier distribution:
    ///   C_i       = isqrt(project.total_staked)  — sqrt crowding between projects
    ///   C_total_t = Σ isqrt(S_j) for all projects j in the same tier
    ///
    /// User payout (shares-weighted within project):
    ///   payout = shares × C_i × P_t × total_pool / (total_shares × C_total_t × 10_000)
    ///
    /// remaining_accounts: all registered ProjectAccounts for this hackathon.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let total_pool = ctx.accounts.hackathon.total_pool;
        let hackathon_key = ctx.accounts.hackathon.key();
        let admin_key = ctx.accounts.hackathon.admin;
        let hname = ctx.accounts.hackathon.name.clone();
        let hbump = ctx.accounts.hackathon.bump;
        let eff_pcts = ctx.accounts.hackathon.effective_tier_pcts;
        let tier_count = ctx.accounts.hackathon.tier_count;
        let protocol_fee_bps = ctx.accounts.hackathon.protocol_fee_bps;
        let project_total_staked = ctx.accounts.project.total_staked;
        let project_total_shares = ctx.accounts.project.total_shares;
        let project_rank = ctx.accounts.project.rank;
        let stake_amount = ctx.accounts.user_stake.amount;
        let user_shares = ctx.accounts.user_stake.shares;

        require!(stake_amount > 0, BettingError::ZeroAmount);
        require!(project_rank > 0, BettingError::NotResolved);

        let tier = rank_to_tier_idx(project_rank, tier_count);
        let p_t = eff_pcts[tier] as u128;
        let c_i = isqrt(project_total_staked) as u128;

        // Accumulate C_total_t: sum of isqrt(total_staked) for all projects in this tier.
        let mut c_total_t: u64 = 0;
        for acc in ctx.remaining_accounts.iter() {
            if acc.owner != &crate::ID {
                continue;
            }
            let data = acc.try_borrow_data()?;
            let p = ProjectAccount::try_deserialize(&mut data.as_ref())?;
            if p.hackathon != hackathon_key || p.rank == 0 {
                continue;
            }
            if rank_to_tier_idx(p.rank, tier_count) != tier {
                continue;
            }
            c_total_t = c_total_t
                .checked_add(isqrt(p.total_staked))
                .ok_or(BettingError::Overflow)?;
        }
        require!(c_total_t > 0, BettingError::Overflow);

        // payout = shares × C_i × P_t × pool / (total_shares × C_total_t × 10_000)
        let payout: u64 = {
            let num = (user_shares as u128)
                .checked_mul(c_i)
                .and_then(|n| n.checked_mul(p_t))
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

        // CEI: both transfers BEFORE marking claimed.
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

        ctx.accounts.user_stake.is_claimed = true;
        Ok(())
    }

    // ── 4.7  enable_refund ────────────────────────────────────────────────

    /// Admin marks a project as refund-eligible.  Once set, stakers on this
    /// project may call `refund` to recover their original stake amount.
    ///
    /// Intended for exceptional cases: judging errors, hackathon cancellations,
    /// or explicit admin override for projects that never received a rank.
    /// Once enabled, cannot be revoked.
    pub fn enable_refund(ctx: Context<EnableRefund>) -> Result<()> {
        ctx.accounts.project.is_refund_enabled = true;
        Ok(())
    }

    // ── 4.8  refund ───────────────────────────────────────────────────────

    /// Returns the user's original stake to them on a refund-enabled project.
    /// No penalty is applied — this is an admin-authorised exceptional path.
    /// Uses CEI order: transfer executes before is_claimed is set.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        require!(
            ctx.accounts.project.is_refund_enabled,
            BettingError::RefundNotEnabled,
        );
        require!(!ctx.accounts.user_stake.is_claimed, BettingError::AlreadyClaimed);
        let refund_amount = ctx.accounts.user_stake.amount;
        require!(refund_amount > 0, BettingError::ZeroAmount);

        let admin_key = ctx.accounts.hackathon.admin;
        let hname = ctx.accounts.hackathon.name.clone();
        let hbump = ctx.accounts.hackathon.bump;

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
        ctx.accounts.user_stake.is_claimed = true;
        Ok(())
    }

    // ── 4.9  pay_deposit ──────────────────────────────────────────────────

    /// Builder pays the hackathon's required commitment deposit into escrow.
    /// Idempotent — reverts if already paid. Does not add to total_pool;
    /// deposits are tracked separately so payout math is unaffected.
    /// Once paid, external backers may stake on this project.
    pub fn pay_deposit(ctx: Context<PayDeposit>) -> Result<()> {
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
        let hackathon_key = ctx.accounts.hackathon.key();

        for acc in ctx.remaining_accounts.iter() {
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
    /// Uses CEI: transfer executes before deposit_refunded flag is set.
    pub fn claim_deposit_refund(ctx: Context<ClaimDepositRefund>) -> Result<()> {
        require!(
            ctx.accounts.project.builder_wallet == ctx.accounts.builder.key(),
            BettingError::NotBuilder,
        );
        if ctx.accounts.hackathon.requires_approval {
            require!(ctx.accounts.project.submitted, BettingError::NotSubmitted);
        } else {
            require!(ctx.accounts.project.builder_declared, BettingError::NotDeclared);
        }
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

        ctx.accounts.project.deposit_refunded = true;
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
    /// actually submit.  50% of the deposit is added to the prize pool
    /// (stays in escrow, distributed to backers at claim time).  50% is
    /// transferred to the fee_recipient as protocol revenue.
    pub fn forfeit_deposit(ctx: Context<ForfeitDeposit>) -> Result<()> {
        require!(
            ctx.accounts.project.deposit_amount_paid > 0,
            BettingError::DepositNotPaid,
        );
        // Ghost = not approved (requires_approval mode) or not declared (open mode).
        if ctx.accounts.hackathon.requires_approval {
            require!(!ctx.accounts.project.submitted, BettingError::AlreadySubmitted);
        } else {
            require!(!ctx.accounts.project.builder_declared, BettingError::AlreadySubmitted);
        }
        require!(
            !ctx.accounts.project.deposit_forfeited,
            BettingError::DepositAlreadyForfeited,
        );

        let total = ctx.accounts.project.deposit_amount_paid;
        // Integer division: treasury_half may be 1 less on odd amounts.
        let treasury_half = total / 2;
        let pool_half     = total - treasury_half;

        // Transfer treasury half from escrow to fee_recipient.
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
            treasury_half,
        )?;

        // Pool half stays in escrow — just increase the tracked pool total.
        ctx.accounts.hackathon.total_pool = ctx.accounts.hackathon.total_pool
            .checked_add(pool_half)
            .ok_or(BettingError::Overflow)?;

        ctx.accounts.project.deposit_forfeited = true;
        Ok(())
    }

    // ── 4.15  whitelist_wallet ────────────────────────────────────────────

    /// Admin creates a per-hackathon whitelist entry for a wallet, allowing it
    /// to call `stake`. Only whitelisted wallets may stake; builders who call
    /// `self_stake` are exempt from this check (they are already gated by
    /// project ownership and the deposit requirement).
    pub fn whitelist_wallet(ctx: Context<WhitelistWallet>) -> Result<()> {
        let entry = &mut ctx.accounts.whitelist_entry;
        entry.hackathon = ctx.accounts.hackathon.key();
        entry.wallet = ctx.accounts.wallet.key();
        entry.bump = ctx.bumps.whitelist_entry;
        Ok(())
    }
}

// ── Account structs ────────────────────────────────────────────────────────

#[account]
pub struct HackathonState {
    pub admin: Pubkey,                          // 32
    pub usdc_mint: Pubkey,                      // 32
    pub name: String,                           // 4 + NAME_MAX_LEN
    pub results_timestamp: i64,                 // 8
    pub cutoff_timestamp: i64,                  // 8
    pub start_timestamp: i64,                   // 8
    pub total_pool: u64,                        // 8
    pub is_resolved: bool,                      // 1
    pub tier_count: u8,                         // 1
    pub tier_pcts: [u8; MAX_TIERS],             // 8  — configured at init, sum=100
    pub tier_expected_counts: [u8; MAX_TIERS],  // 8  — for UI/display only
    pub effective_tier_pcts: [u16; MAX_TIERS],  // 16 — computed at finalize_resolve (bps)
    pub fee_recipient: Pubkey,                  // 32 — wallet receiving protocol fees
    pub protocol_fee_bps: u16,                  // 2  — fee on claim payouts (e.g. 150 = 1.5%)
    pub deposit_amount: u64,                    // 8  — required builder deposit (0 = no deposit required)
    pub requires_approval: bool,                // 1  — if true, admin must run approve_submissions before deposit refund; if false, builder_declared suffices
    pub bump: u8,                               // 1
    pub escrow_bump: u8,                        // 1
}

impl HackathonState {
    pub const SPACE: usize = 8  // discriminator
        + 32  // admin
        + 32  // usdc_mint
        + 4 + NAME_MAX_LEN  // name (4-byte length prefix + max 50 bytes)
        + 8   // results_timestamp
        + 8   // cutoff_timestamp
        + 8   // start_timestamp
        + 8   // total_pool
        + 1   // is_resolved
        + 1   // tier_count
        + 8   // tier_pcts
        + 8   // tier_expected_counts
        + 16  // effective_tier_pcts
        + 32  // fee_recipient
        + 2   // protocol_fee_bps
        + 8   // deposit_amount
        + 1   // requires_approval
        + 1   // bump
        + 1;  // escrow_bump
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

// ── Instruction contexts ───────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeHackathon<'info> {
    #[account(
        mut,
        address = PROTOCOL_ADMIN @ BettingError::Unauthorized,
    )]
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
    pub payer: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        init,
        payer = payer,
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
    /// Whitelist entry — must exist for this hackathon + user pair.
    /// Admin creates it via whitelist_wallet before backers can stake.
    #[account(
        seeds = [b"whitelist", hackathon.key().as_ref(), user.key().as_ref()],
        bump  = whitelist_entry.bump,
    )]
    pub whitelist_entry: Account<'info, WhitelistedWallet>,
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
        has_one = admin,
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
        has_one = admin,
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
    // remaining_accounts: all ProjectAccounts for R_total computation.
}

#[derive(Accounts)]
pub struct EnableRefund<'info> {
    pub admin: Signer<'info>,
    #[account(has_one = admin)]
    pub hackathon: Account<'info, HackathonState>,
    #[account(mut, has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
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
    #[account(has_one = admin)]
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
    #[account(
        mut,
        has_one = admin,
        constraint = !hackathon.is_resolved @ BettingError::AlreadyResolved,
    )]
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
    #[account(
        mut,
        address = PROTOCOL_ADMIN @ BettingError::Unauthorized,
    )]
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
