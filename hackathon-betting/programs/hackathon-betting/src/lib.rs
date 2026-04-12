use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("81k4nRYTKkAJmd5Fm9uKktYR82xLUNq4qAiYbuL7RP1o");

// ── Protocol constants ─────────────────────────────────────────────────────

/// Seconds before results_timestamp after which unstaking is forbidden.
pub const SELL_CUTOFF_SECS: i64 = 86_400;
/// Max penalty on early unstake in basis points (30 %).
pub const MAX_PENALTY_BPS: u64 = 3_000;
/// Hard cap on stake per wallet per project.
pub const MAX_STAKE_PER_WALLET: u64 = 1_000_000_000;
/// Basis-point denominator for all fixed-point math.
pub const BPS_DENOM: u64 = 10_000;
/// Judge weights [rank-1, rank-2, rank-3, rest-tier-total].
pub const JUDGE_WEIGHTS: [u8; 4] = [55, 30, 10, 5];

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
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/// Integer square root — floor(sqrt(n)).  Newton's method, no f64.
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

/// Scaled raw payout weight R_i for a project.
///
/// To keep all arithmetic in integers we multiply weights for ranks 1-3 by
/// `rest_project_count` (rpc) so the rest-tier entry (5 / rpc × C_i) lands
/// at the same denominator as a non-rest entry (J × C_i × rpc):
///
///   rank 1  →  55 × C_i × rpc
///   rank 2  →  30 × C_i × rpc
///   rank 3  →  10 × C_i × rpc
///   rank 4+ →   5 × C_i          (rpc factors cancel: (5/rpc) × C_i × rpc)
///
/// R_total_scaled = Σ r_scaled(rank_k, C_k, rpc)
/// payout = stake × R_claim × T  /  (S_i × R_total_scaled)
fn r_scaled(rank: u8, c_i: u64, rest_project_count: u16) -> Result<u64> {
    let rpc = rest_project_count.max(1) as u64;
    let result = match rank {
        1 => 55_u64.checked_mul(c_i).and_then(|v| v.checked_mul(rpc)),
        2 => 30_u64.checked_mul(c_i).and_then(|v| v.checked_mul(rpc)),
        3 => 10_u64.checked_mul(c_i).and_then(|v| v.checked_mul(rpc)),
        _ =>  5_u64.checked_mul(c_i),
    };
    result.ok_or(error!(BettingError::Overflow))
}

// ── Program ────────────────────────────────────────────────────────────────

#[program]
pub mod hackathon_betting {
    use super::*;

    // ── 4.1  initialize_hackathon ──────────────────────────────────────────

    pub fn initialize_hackathon(
        ctx: Context<InitializeHackathon>,
        results_timestamp: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(results_timestamp > now, BettingError::InvalidTimestamp);
        let h = &mut ctx.accounts.hackathon;
        h.admin              = ctx.accounts.admin.key();
        h.usdc_mint          = ctx.accounts.usdc_mint.key();
        h.results_timestamp  = results_timestamp;
        h.cutoff_timestamp   = results_timestamp
            .checked_sub(SELL_CUTOFF_SECS)
            .ok_or(BettingError::Overflow)?;
        h.total_pool         = 0;
        h.is_resolved        = false;
        h.judge_weights      = JUDGE_WEIGHTS;
        h.rest_project_count = 0;
        h.bump               = ctx.bumps.hackathon;
        h.escrow_bump        = ctx.bumps.escrow;
        Ok(())
    }

    // ── 4.2  register_project ─────────────────────────────────────────────

    pub fn register_project(
        ctx: Context<RegisterProject>,
        github_url: String,
        url_hash: [u8; 32],
    ) -> Result<()> {
        require!(github_url.len() <= ProjectAccount::MAX_URL, BettingError::UrlTooLong);
        // Enforce url_hash == SHA-256(github_url) so the PDA address is always
        // deterministically derived from the URL content.
        let expected = anchor_lang::solana_program::hash::hash(github_url.as_bytes()).to_bytes();
        require!(url_hash == expected, BettingError::InvalidUrlHash);
        let p = &mut ctx.accounts.project;
        p.hackathon     = ctx.accounts.hackathon.key();
        p.github_url    = github_url;
        p.total_staked  = 0;
        p.rank          = 0;
        p.is_registered = true;
        p.bump          = ctx.bumps.project;
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

        let new_amount = user_stake.amount
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;
        require!(new_amount <= MAX_STAKE_PER_WALLET, BettingError::StakeCapExceeded);

        // Initialise once — on first stake user field is default (all zeros).
        if user_stake.user == Pubkey::default() {
            user_stake.user            = ctx.accounts.user.key();
            user_stake.project         = ctx.accounts.project.key();
            user_stake.stake_timestamp = now;
            user_stake.is_claimed      = false;
            user_stake.bump            = ctx.bumps.user_stake;
        }
        user_stake.amount = new_amount;

        ctx.accounts.project.total_staked = ctx.accounts.project.total_staked
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;
        ctx.accounts.hackathon.total_pool = ctx.accounts.hackathon.total_pool
            .checked_add(amount)
            .ok_or(BettingError::Overflow)?;

        // Transfer USDC: user → escrow.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.user_token_account.to_account_info(),
                    to:        ctx.accounts.escrow.to_account_info(),
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

        // Capture values before mutable borrows.
        let stake_amount     = ctx.accounts.user_stake.amount;
        let stake_timestamp  = ctx.accounts.user_stake.stake_timestamp;
        let cutoff_timestamp = ctx.accounts.hackathon.cutoff_timestamp;
        let admin_key        = ctx.accounts.hackathon.admin;
        let hbump            = ctx.accounts.hackathon.bump;

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

        // Mutate state.
        ctx.accounts.user_stake.amount = 0;
        ctx.accounts.project.total_staked = ctx.accounts.project.total_staked
            .checked_sub(stake_amount)
            .ok_or(BettingError::Overflow)?;
        // Penalty stays in escrow — only deduct what we return.
        ctx.accounts.hackathon.total_pool = ctx.accounts.hackathon.total_pool
            .checked_sub(return_amount)
            .ok_or(BettingError::Overflow)?;

        // Transfer return_amount: escrow → user (hackathon PDA signs).
        let bump_arr = [hbump];
        let seeds: &[&[u8]] = &[b"hackathon", admin_key.as_ref(), &bump_arr];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.escrow.to_account_info(),
                    to:        ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.hackathon.to_account_info(),
                },
                &[seeds],
            ),
            return_amount,
        )?;
        Ok(())
    }

    // ── 4.5  resolve ──────────────────────────────────────────────────────

    /// Sets the rank on a single ProjectAccount.  Call once per project.
    /// After all ranks are set, call finalize_resolve.
    pub fn resolve(ctx: Context<Resolve>, rank: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.hackathon.results_timestamp, BettingError::ResultsNotYet);
        require!(rank >= 1, BettingError::InvalidRank);
        ctx.accounts.project.rank = rank;
        Ok(())
    }

    // ── 4.5b  finalize_resolve ────────────────────────────────────────────

    /// Counts rest-rank (≥4) projects, stores rest_project_count, sets
    /// is_resolved = true.
    ///
    /// remaining_accounts: all registered ProjectAccounts for this hackathon.
    pub fn finalize_resolve(ctx: Context<FinalizeResolve>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.hackathon.results_timestamp, BettingError::ResultsNotYet);
        let hackathon_key = ctx.accounts.hackathon.key();
        let mut rest_count: u16 = 0;
        for acc in ctx.remaining_accounts.iter() {
            if acc.owner != &crate::ID {
                continue;
            }
            let data = acc.try_borrow_data()?;
            let project = ProjectAccount::try_deserialize(&mut data.as_ref())?;
            if project.hackathon != hackathon_key {
                continue;
            }
            if project.rank >= 4 {
                rest_count = rest_count.saturating_add(1);
            }
        }
        let h = &mut ctx.accounts.hackathon;
        h.rest_project_count = rest_count;
        h.is_resolved        = true;
        Ok(())
    }

    // ── 4.6  claim ────────────────────────────────────────────────────────

    /// Computes and transfers the user's payout.
    ///
    /// NOTE — integer dust: each payout is floored by integer division, leaving
    /// at most a few lamports permanently in escrow after all claims.  This dust
    /// is irrecoverable by design for MVP.  A future `sweep_dust` admin
    /// instruction could drain the remainder once all UserStakes are claimed.
    ///
    /// remaining_accounts: all registered ProjectAccounts for this hackathon,
    /// used to compute R_total_scaled.  See Step 6 CU audit — if 20 projects
    /// exceeds 200k CU this will be replaced by a snapshot stored at resolve.
    ///
    /// Formula (integer, scaled to avoid fractional weights):
    ///   payout = stake × R_claim × T  /  (S_i × R_total_scaled)
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        // Snapshot immutable values before any mutable borrows.
        let rpc                  = ctx.accounts.hackathon.rest_project_count;
        let total_pool           = ctx.accounts.hackathon.total_pool;
        let hackathon_key        = ctx.accounts.hackathon.key();
        let admin_key            = ctx.accounts.hackathon.admin;
        let hbump                = ctx.accounts.hackathon.bump;
        let project_total_staked = ctx.accounts.project.total_staked;
        let project_rank         = ctx.accounts.project.rank;
        let stake_amount         = ctx.accounts.user_stake.amount;

        require!(stake_amount > 0, BettingError::ZeroAmount);
        require!(project_rank > 0, BettingError::NotResolved); // FIX-7: reject unresolved projects

        // Compute R_total_scaled over all project accounts.
        let mut r_total: u64 = 0;
        for acc in ctx.remaining_accounts.iter() {
            if acc.owner != &crate::ID {
                continue;
            }
            let data = acc.try_borrow_data()?;
            let p = ProjectAccount::try_deserialize(&mut data.as_ref())?;
            if p.hackathon != hackathon_key {
                continue;
            }
            if p.rank == 0 {
                continue; // FIX-7: skip projects not yet ranked
            }
            r_total = r_total
                .checked_add(r_scaled(p.rank, isqrt(p.total_staked), rpc)?) // FIX-6
                .ok_or(BettingError::Overflow)?;
        }
        require!(r_total > 0, BettingError::Overflow);

        // R_i for the project being claimed.
        let r_claim = r_scaled(project_rank, isqrt(project_total_staked), rpc)?; // FIX-6

        // payout = stake × R_claim × T / (S_i × R_total)  — use u128 to avoid overflow.
        let payout: u64 = {
            let num = (stake_amount as u128)
                .checked_mul(r_claim as u128)
                .and_then(|n| n.checked_mul(total_pool as u128))
                .ok_or(BettingError::Overflow)?;
            let den = (project_total_staked as u128)
                .checked_mul(r_total as u128)
                .ok_or(BettingError::Overflow)?;
            require!(den > 0, BettingError::Overflow);
            (num / den) as u64
        };

        // Transfer payout: escrow → user (hackathon PDA signs).
        // FIX-1: transfer BEFORE marking claimed — CEI order.
        let bump_arr = [hbump];
        let seeds: &[&[u8]] = &[b"hackathon", admin_key.as_ref(), &bump_arr];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.escrow.to_account_info(),
                    to:        ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.hackathon.to_account_info(),
                },
                &[seeds],
            ),
            payout,
        )?;
        // FIX-1: only mark claimed after successful transfer
        ctx.accounts.user_stake.is_claimed = true;
        Ok(())
    }
}

// ── Account structs ────────────────────────────────────────────────────────

#[account]
pub struct HackathonState {
    pub admin:               Pubkey,   // 32
    pub usdc_mint:           Pubkey,   // 32
    pub results_timestamp:   i64,      // 8
    pub cutoff_timestamp:    i64,      // 8
    pub total_pool:          u64,      // 8
    pub is_resolved:         bool,     // 1
    pub judge_weights:       [u8; 4],  // 4
    /// Count of projects ranked 4+; written by finalize_resolve so claim can
    /// compute J_rest = 5 / rest_project_count without a second pass.
    pub rest_project_count:  u16,      // 2
    pub bump:                u8,       // 1
    pub escrow_bump:         u8,       // 1
}

impl HackathonState {
    pub const SPACE: usize = 8   // discriminator
        + 32  // admin
        + 32  // usdc_mint
        + 8   // results_timestamp
        + 8   // cutoff_timestamp
        + 8   // total_pool
        + 1   // is_resolved
        + 4   // judge_weights
        + 2   // rest_project_count
        + 1   // bump
        + 1;  // escrow_bump
}

#[account]
pub struct ProjectAccount {
    pub hackathon:     Pubkey,
    pub github_url:    String,  // ≤ MAX_URL bytes
    pub total_staked:  u64,
    pub rank:          u8,      // 0 = unranked
    pub is_registered: bool,
    pub bump:          u8,
}

impl ProjectAccount {
    pub const MAX_URL: usize = 200;
    pub const SPACE: usize = 8
        + 32                       // hackathon
        + 4 + Self::MAX_URL        // github_url (4-byte length prefix + data)
        + 8                        // total_staked
        + 1                        // rank
        + 1                        // is_registered
        + 1;                       // bump
}

#[account]
pub struct UserStake {
    pub user:            Pubkey,
    pub project:         Pubkey,
    pub amount:          u64,
    pub stake_timestamp: i64,
    pub is_claimed:      bool,
    pub bump:            u8,
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
    /// USDC escrow owned by the hackathon PDA.
    #[account(
        init,
        payer = admin,
        token::mint      = usdc_mint,
        token::authority = hackathon,
        seeds = [b"escrow", hackathon.key().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub usdc_mint:      Account<'info, Mint>,
    pub token_program:  Program<'info, Token>,
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
    pub project:        Account<'info, ProjectAccount>,
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
    pub escrow:         Account<'info, TokenAccount>,
    pub token_program:  Program<'info, Token>,
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
    #[account(
        mut,
        has_one = hackathon,
    )]
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
    pub escrow:        Account<'info, TokenAccount>,
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
    pub escrow:        Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: all ProjectAccounts for R_total computation.
}
