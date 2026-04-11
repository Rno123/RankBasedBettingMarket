use anchor_lang::prelude::*;

declare_id!("81k4nRYTKkAJmd5Fm9uKktYR82xLUNq4qAiYbuL7RP1o");

// ── Protocol constants ─────────────────────────────────────────────────────

/// Seconds before results_timestamp after which unstaking is forbidden.
pub const SELL_CUTOFF_SECS: i64 = 86_400;
/// Maximum penalty on early unstake (30 % of stake at the cutoff moment).
pub const MAX_PENALTY_BPS: u64 = 3_000;
/// Minimum fraction returned on unstake, in basis points (70 %).
pub const SELL_FLOOR_BPS: u64 = 7_000;
/// Hard cap on stake per wallet per project (1 USDC-lamport unit = 1e-6 USDC).
pub const MAX_STAKE_PER_WALLET: u64 = 1_000_000_000;
/// Judge weights [rank-1, rank-2, rank-3, rest-tier-total].
/// The rest-tier total (5) is divided equally across all rest-rank projects.
pub const JUDGE_WEIGHTS: [u8; 4] = [55, 30, 10, 5];
/// Basis-points denominator used throughout fixed-point math.
pub const BPS_DENOM: u64 = 10_000;

// ── Error codes ────────────────────────────────────────────────────────────

#[error_code]
pub enum BettingError {
    #[msg("Cutoff has passed — unstaking is no longer allowed")]
    CutoffPassed,
    #[msg("Hackathon is not yet resolved")]
    NotResolved,
    #[msg("Hackathon already resolved")]
    AlreadyResolved,
    #[msg("Payout already claimed")]
    AlreadyClaimed,
    #[msg("Stake exceeds per-wallet cap")]
    StakeCapExceeded,
    #[msg("github_url exceeds 200-character limit")]
    UrlTooLong,
    #[msg("Invalid rank — must be ≥ 1")]
    InvalidRank,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("No rest-rank projects registered — cannot compute rest weight")]
    NoRestProjects,
}

// ── Program instructions ───────────────────────────────────────────────────

#[program]
pub mod hackathon_betting {
    use super::*;

    /// 4.1 — Admin creates the hackathon PDA.
    pub fn initialize_hackathon(
        ctx: Context<InitializeHackathon>,
        results_timestamp: i64,
    ) -> Result<()> {
        let _ = (ctx, results_timestamp);
        // Implemented in Step 4.1
        Ok(())
    }

    /// 4.2 — Anyone registers a project by its GitHub URL.
    pub fn register_project(
        ctx: Context<RegisterProject>,
        github_url: String,
    ) -> Result<()> {
        let _ = (ctx, github_url);
        // Implemented in Step 4.2
        Ok(())
    }

    /// 4.3 — User deposits USDC into the escrow and records their stake.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let _ = (ctx, amount);
        // Implemented in Step 4.3
        Ok(())
    }

    /// 4.4 — User withdraws before the cutoff with a linear-decay penalty.
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let _ = ctx;
        // Implemented in Step 4.4
        Ok(())
    }

    /// 4.5 — Admin sets the rank for one project.
    ///
    /// Call once per project.  After all ranks are set, call
    /// `finalize_resolve` to mark the hackathon as resolved and record
    /// `rest_project_count` (needed by `claim` for rest-tier weight splitting).
    pub fn resolve(ctx: Context<Resolve>, rank: u8) -> Result<()> {
        let _ = (ctx, rank);
        // Implemented in Step 4.5
        Ok(())
    }

    /// 4.5b — Admin finalises resolution: counts rest-rank projects, stores
    /// `rest_project_count`, and sets `is_resolved = true`.
    ///
    /// Remaining accounts: all registered ProjectAccounts for this hackathon.
    pub fn finalize_resolve(ctx: Context<FinalizeResolve>) -> Result<()> {
        let _ = ctx;
        // Implemented in Step 4.5
        Ok(())
    }

    /// 4.6 — User claims their payout after resolution.
    ///
    /// Remaining accounts: all registered ProjectAccounts (needed to compute
    /// R_total for the payout formula without snapshotting it at resolve time).
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let _ = ctx;
        // Implemented in Step 4.6
        Ok(())
    }
}

// ── Account structs ────────────────────────────────────────────────────────

#[account]
pub struct HackathonState {
    /// Authority that may call resolve / finalize_resolve.
    pub admin: Pubkey,
    /// Unix timestamp at which judge results are published.
    pub results_timestamp: i64,
    /// results_timestamp − SELL_CUTOFF_SECS; unstaking forbidden after this.
    pub cutoff_timestamp: i64,
    /// Running sum of all stakes ever deposited (including forfeited penalties).
    pub total_pool: u64,
    /// Set to true by finalize_resolve; gates claim.
    pub is_resolved: bool,
    /// [55, 30, 10, 5] — the "5" is the rest-tier TOTAL, split by rest_project_count.
    pub judge_weights: [u8; 4],
    /// Number of projects ranked 4+, written by finalize_resolve.
    /// Stored so claim can compute J_rest = 5 / rest_project_count in O(1).
    pub rest_project_count: u16,
    pub bump: u8,
}

impl HackathonState {
    pub const SPACE: usize = 8   // Anchor discriminator
        + 32  // admin
        + 8   // results_timestamp
        + 8   // cutoff_timestamp
        + 8   // total_pool
        + 1   // is_resolved
        + 4   // judge_weights [u8; 4]
        + 2   // rest_project_count
        + 1;  // bump
}

#[account]
pub struct ProjectAccount {
    /// Back-reference to the parent hackathon.
    pub hackathon: Pubkey,
    /// Canonical identifier — also used as PDA seed.
    pub github_url: String, // ≤ MAX_URL bytes
    /// Sum of all active stakes on this project.
    pub total_staked: u64,
    /// Judge rank (1-based). 0 = not yet ranked.
    pub rank: u8,
    pub is_registered: bool,
    pub bump: u8,
}

impl ProjectAccount {
    pub const MAX_URL: usize = 200;
    pub const SPACE: usize = 8          // discriminator
        + 32                            // hackathon
        + 4 + Self::MAX_URL             // github_url (4-byte length prefix + data)
        + 8                             // total_staked
        + 1                             // rank
        + 1                             // is_registered
        + 1;                            // bump
}

#[account]
pub struct UserStake {
    pub user: Pubkey,
    pub project: Pubkey,
    /// Current staked amount (decreases on unstake).
    pub amount: u64,
    /// Clock::get() at the time of the original stake, used for penalty calc.
    pub stake_timestamp: i64,
    pub is_claimed: bool,
    pub bump: u8,
}

impl UserStake {
    pub const SPACE: usize = 8  // discriminator
        + 32  // user
        + 32  // project
        + 8   // amount
        + 8   // stake_timestamp
        + 1   // is_claimed
        + 1;  // bump
}

// ── Instruction contexts ───────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeHackathon<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = HackathonState::SPACE,
        seeds = [b"hackathon", admin.key().as_ref()],
        bump,
    )]
    pub hackathon: Account<'info, HackathonState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(github_url: String)]
pub struct RegisterProject<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        init,
        payer = payer,
        space = ProjectAccount::SPACE,
        seeds = [b"project", hackathon.key().as_ref(), github_url.as_bytes()],
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
    #[account(
        mut,
        has_one = hackathon,
    )]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::SPACE,
        seeds = [b"stake", user.key().as_ref(), project.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, UserStake>,
    // USDC token accounts added in Step 4.3
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub hackathon: Account<'info, HackathonState>,
    #[account(
        mut,
        has_one = hackathon,
    )]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref(), project.key().as_ref()],
        bump = user_stake.bump,
        has_one = user,
        has_one = project,
    )]
    pub user_stake: Account<'info, UserStake>,
    // USDC token accounts added in Step 4.4
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
    #[account(
        mut,
        has_one = hackathon,
    )]
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
    // All ProjectAccounts passed as remaining_accounts for rest_project_count
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = hackathon.is_resolved @ BettingError::NotResolved,
    )]
    pub hackathon: Account<'info, HackathonState>,
    #[account(has_one = hackathon)]
    pub project: Account<'info, ProjectAccount>,
    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref(), project.key().as_ref()],
        bump = user_stake.bump,
        has_one = user,
        has_one = project,
        constraint = !user_stake.is_claimed @ BettingError::AlreadyClaimed,
    )]
    pub user_stake: Account<'info, UserStake>,
    // USDC escrow + user token accounts and remaining_accounts added in Step 4.6
    pub system_program: Program<'info, System>,
}
