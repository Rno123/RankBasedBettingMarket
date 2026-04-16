use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");

// ── Protocol constants ─────────────────────────────────────────────────────

/// Seconds before results_timestamp after which unstaking is forbidden.
pub const SELL_CUTOFF_SECS: i64 = 86_400;
/// Max penalty on early unstake in basis points (30%).
pub const MAX_PENALTY_BPS: u64 = 3_000;
/// Hard cap on stake per wallet per project.
pub const MAX_STAKE_PER_WALLET: u64 = 1_000_000_000;
/// Maximum length of a hackathon name in bytes.
pub const NAME_MAX_LEN: usize = 50;
/// Basis-point denominator for all fixed-point math.
pub const BPS_DENOM: u64 = 10_000;
/// Maximum number of configurable winner tiers.
pub const MAX_TIERS: usize = 8;
/// Only this wallet may call initialize_hackathon.
/// Update before redeploy to transfer admin rights to a new key.
pub const PROTOCOL_ADMIN: &str = "5mxHcMPWZwspnvnDurm9kaqBkNsPjot549f8QhTkcMfP";
/// Effective tier percentages are stored in basis points (sum = 10_000).
pub const TIER_BPS_TOTAL: u32 = 10_000;

// ── Errors ─────────────────────────────────────────────────────────────────

#[error_code]
pub enum BettingError {
    #[msg("Cutoff has passed — unstaking is no longer allowed")]
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
    #[msg("Only the protocol admin may call this instruction")]
    Unauthorized,
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
    ) -> Result<()> {
        let admin_key = PROTOCOL_ADMIN.parse::<Pubkey>()
            .expect("PROTOCOL_ADMIN is a valid pubkey");
        require!(
            ctx.accounts.admin.key() == admin_key,
            BettingError::Unauthorized
        );
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
        p.rank = 0;
        p.is_registered = true;
        p.is_refund_enabled = false;
        p.registered_by = ctx.accounts.payer.key();
        p.bump = ctx.bumps.project;
        Ok(())
    }

    // ── 4.3  stake ────────────────────────────────────────────────────────

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, BettingError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.results_timestamp,
            BettingError::StakingClosed,
        );

        let user_stake = &mut ctx.accounts.user_stake;
        require!(!user_stake.is_claimed, BettingError::AlreadyClaimed);

        let new_amount = user_stake
            .amount
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;
        require!(new_amount <= MAX_STAKE_PER_WALLET, BettingError::StakeCapExceeded);

        if user_stake.user == Pubkey::default() {
            user_stake.user = ctx.accounts.user.key();
            user_stake.project = ctx.accounts.project.key();
            user_stake.stake_timestamp = now;
            user_stake.is_claimed = false;
            user_stake.bump = ctx.bumps.user_stake;
        }
        user_stake.amount = new_amount;

        ctx.accounts.project.total_staked = ctx.accounts
            .project
            .total_staked
            .checked_add(amount)
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

    // ── 4.4  unstake ──────────────────────────────────────────────────────

    /// Linear decay penalty:
    ///   penalty_bps = MAX_PENALTY_BPS × (t_now − t_stake) / (t_cutoff − t_stake)
    ///   return_amount = stake × (BPS_DENOM − penalty_bps) / BPS_DENOM
    /// Penalty stays in the pool; only return_amount leaves the escrow.
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ctx.accounts.hackathon.cutoff_timestamp,
            BettingError::CutoffPassed,
        );

        let stake_amount = ctx.accounts.user_stake.amount;
        let stake_timestamp = ctx.accounts.user_stake.stake_timestamp;
        let cutoff_timestamp = ctx.accounts.hackathon.cutoff_timestamp;
        let admin_key = ctx.accounts.hackathon.admin;
        let hname = ctx.accounts.hackathon.name.clone();
        let hbump = ctx.accounts.hackathon.bump;

        let t_elapsed = now
            .checked_sub(stake_timestamp)
            .ok_or(BettingError::Overflow)?
            .max(0) as u64;
        let t_total = cutoff_timestamp
            .checked_sub(stake_timestamp)
            .ok_or(BettingError::Overflow)?
            .max(1) as u64;

        let penalty_bps = MAX_PENALTY_BPS
            .checked_mul(t_elapsed)
            .ok_or(BettingError::Overflow)?
            .checked_div(t_total)
            .unwrap_or(MAX_PENALTY_BPS)
            .min(MAX_PENALTY_BPS);

        let return_amount = stake_amount
            .checked_mul(BPS_DENOM - penalty_bps)
            .ok_or(BettingError::Overflow)?
            .checked_div(BPS_DENOM)
            .unwrap_or(0);

        ctx.accounts.user_stake.amount = 0;
        ctx.accounts.project.total_staked = ctx.accounts
            .project
            .total_staked
            .checked_sub(stake_amount)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.hackathon.total_pool = ctx.accounts
            .hackathon
            .total_pool
            .checked_sub(return_amount)
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
    /// Stage 2 — within-tier distribution by sqrt crowding:
    ///   C_i       = isqrt(project.total_staked)
    ///   C_total_t = Σ isqrt(S_j) for all projects j in the same tier
    ///
    /// User payout:
    ///   payout = stake × C_i × P_t × total_pool / (S_i × C_total_t × 10_000)
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
        let project_total_staked = ctx.accounts.project.total_staked;
        let project_rank = ctx.accounts.project.rank;
        let stake_amount = ctx.accounts.user_stake.amount;

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

        // payout = stake × C_i × P_t × pool / (S_i × C_total_t × 10_000)
        let payout: u64 = {
            let num = (stake_amount as u128)
                .checked_mul(c_i)
                .and_then(|n| n.checked_mul(p_t))
                .and_then(|n| n.checked_mul(total_pool as u128))
                .ok_or(BettingError::Overflow)?;
            let den = (project_total_staked as u128)
                .checked_mul(c_total_t as u128)
                .and_then(|d| d.checked_mul(10_000u128))
                .ok_or(BettingError::Overflow)?;
            require!(den > 0, BettingError::Overflow);
            (num / den) as u64
        };

        // CEI: transfer BEFORE marking claimed.
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
            payout,
        )?;
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
}

// ── Account structs ────────────────────────────────────────────────────────

#[account]
pub struct HackathonState {
    pub admin: Pubkey,                          // 32
    pub usdc_mint: Pubkey,                      // 32
    pub name: String,                           // 4 + NAME_MAX_LEN
    pub results_timestamp: i64,                 // 8
    pub cutoff_timestamp: i64,                  // 8
    pub total_pool: u64,                        // 8
    pub is_resolved: bool,                      // 1
    pub tier_count: u8,                         // 1
    pub tier_pcts: [u8; MAX_TIERS],             // 8  — configured at init, sum=100
    pub tier_expected_counts: [u8; MAX_TIERS],  // 8  — for UI/display only
    pub effective_tier_pcts: [u16; MAX_TIERS],  // 16 — computed at finalize_resolve (bps)
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
        + 8   // total_pool
        + 1   // is_resolved
        + 1   // tier_count
        + 8   // tier_pcts
        + 8   // tier_expected_counts
        + 16  // effective_tier_pcts
        + 1   // bump
        + 1;  // escrow_bump
}

#[account]
pub struct ProjectAccount {
    pub hackathon: Pubkey,
    pub github_url: String,         // ≤ MAX_URL bytes
    pub total_staked: u64,
    pub rank: u8,                   // 0 = unranked
    pub is_registered: bool,
    pub is_refund_enabled: bool,    // admin can enable for exceptional refunds
    pub registered_by: Pubkey,      // wallet that called register_project
    pub bump: u8,
}

impl ProjectAccount {
    pub const MAX_URL: usize = 200;
    pub const SPACE: usize = 8
        + 32                       // hackathon
        + 4 + Self::MAX_URL        // github_url (4-byte length prefix + data)
        + 8                        // total_staked
        + 1                        // rank
        + 1                        // is_registered
        + 1                        // is_refund_enabled
        + 32                       // registered_by
        + 1;                       // bump
}

#[account]
pub struct UserStake {
    pub user: Pubkey,
    pub project: Pubkey,
    pub amount: u64,
    pub stake_timestamp: i64,
    pub is_claimed: bool,
    pub bump: u8,
}

impl UserStake {
    pub const SPACE: usize = 8
        + 32  // user
        + 32  // project
        + 8   // amount
        + 8   // stake_timestamp
        + 1   // is_claimed
        + 1;  // bump
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
