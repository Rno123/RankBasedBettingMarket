"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";
import { DEPLOYER } from "@/lib/constants";

// ── Sidebar sections ──────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "overview",        label: "Overview" },
  { id: "lifecycle",       label: "Protocol Lifecycle" },
  { id: "staking",         label: "Staking & Unstaking" },
  { id: "time-weights",    label: "Time-Weighted Shares" },
  { id: "payout",          label: "Payout Formula" },
  { id: "constants",       label: "On-Chain Constants" },
  { id: "accounts",        label: "Account Structures" },
  { id: "pda-seeds",       label: "PDA Seeds" },
  { id: "claim-arch",      label: "Claim Architecture" },
  { id: "fees",            label: "Fee Architecture" },
  { id: "admin-ops",       label: "Admin Operations" },
  { id: "audit",           label: "Audit Fixes" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// ── Shared style helpers ──────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  marginBottom: "3.5rem",
  scrollMarginTop: "80px",
};

const h2Style: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: "1.5rem",
  fontWeight: 900,
  color: "var(--c-text)",
  margin: "0 0 1rem",
  letterSpacing: "-0.02em",
};

const h3Style: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 700,
  color: "var(--c-text)",
  margin: "1.5rem 0 0.5rem",
};

const pStyle: React.CSSProperties = {
  fontSize: "0.9375rem",
  lineHeight: 1.75,
  color: "var(--c-text-2)",
  margin: "0 0 0.75rem",
};

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.8125rem",
  background: "var(--card-bg-alt)",
  border: "1px solid var(--card-border)",
  borderRadius: "8px",
  padding: "1rem 1.25rem",
  display: "block",
  overflowX: "auto",
  whiteSpace: "pre",
  color: "var(--c-text)",
  lineHeight: 1.65,
  margin: "0.75rem 0",
};

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.8em",
  background: "var(--card-bg-alt)",
  border: "1px solid var(--card-border)",
  borderRadius: "4px",
  padding: "0.1em 0.35em",
  color: "var(--c-indigo-text)",
};

const tagStyle = (color: "orange" | "sky" | "amber" | "red" | "emerald"): React.CSSProperties => {
  const map = {
    orange: { bg: "var(--c-indigo-light)", border: "var(--c-indigo-border)", text: "var(--c-indigo-text)" },
    sky:    { bg: "var(--c-sky-light)",    border: "var(--c-sky-border)",    text: "var(--c-sky-text)" },
    amber:  { bg: "var(--c-amber-light)",  border: "var(--c-amber-border)",  text: "var(--c-amber-text)" },
    red:    { bg: "var(--c-red-light)",    border: "var(--c-red-border)",    text: "var(--c-red-text)" },
    emerald:{ bg: "var(--c-emerald-light)",border: "var(--c-emerald-border)",text: "var(--c-emerald-text)" },
  };
  const c = map[color];
  return {
    display: "inline-block",
    fontSize: "0.75rem",
    fontWeight: 600,
    padding: "0.15em 0.55em",
    borderRadius: "4px",
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.text,
    marginRight: "0.4rem",
    verticalAlign: "middle",
  };
};

const calloutStyle = (variant: "info" | "warn" | "danger"): React.CSSProperties => {
  const map = {
    info:   { bg: "var(--c-sky-light)",   border: "var(--c-sky-border)",   text: "var(--c-sky-text)" },
    warn:   { bg: "var(--c-amber-light)", border: "var(--c-amber-border)", text: "var(--c-amber-text)" },
    danger: { bg: "var(--c-red-light)",   border: "var(--c-red-border)",   text: "var(--c-red-text)" },
  };
  const c = map[variant];
  return {
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: "8px",
    padding: "0.75rem 1rem",
    fontSize: "0.875rem",
    color: c.text,
    lineHeight: 1.6,
    margin: "0.75rem 0",
  };
};

function IC({ children }: { children: React.ReactNode }) {
  return <code style={inlineCodeStyle}>{children}</code>;
}

function Table({ head, rows }: { head: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div style={{ overflowX: "auto", margin: "0.75rem 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "8px 12px", background: "var(--card-bg-alt)", borderBottom: "1px solid var(--card-border)", color: "var(--c-text)", fontWeight: 600, whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--c-divider-2)" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "8px 12px", color: "var(--c-text-2)", verticalAlign: "top" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section content ───────────────────────────────────────────────────────────

function SectionOverview() {
  return (
    <section id="overview" style={sectionStyle}>
      <h2 style={h2Style}>Overview</h2>
      <p style={pStyle}>
        <strong>HackBet</strong> is a Solana-native conviction pool protocol built for hackathons. Participants
        stake USDC behind hackathon projects before results are announced. When the official judges publish
        rankings, the total pool is redistributed to backers of well-ranked projects using a formula that
        rewards both early conviction and diversification.
      </p>
      <div style={calloutStyle("info")}>
        HackBet is <strong>not</strong> a prediction market. There are no orderbooks, no counterparties, and no
        binary outcomes. It is a rank-weighted, crowd-adjusted conviction pool.
      </div>
      <h3 style={h3Style}>Key stakeholders</h3>
      <Table
        head={["Role", "Description"]}
        rows={[
          ["Protocol Admin", "Controls global settings: creates hackathons, whitelists stakers, resolves outcomes."],
          ["Builder", "Registers a project, pays a refundable deposit, and optionally self-stakes to signal conviction."],
          ["Staker", "Backs one or more projects with USDC. Earns a share of the pool proportional to rank, stake, and timing."],
          ["Fee Recipient", "Receives the protocol fee (default 1.5%) on each successful claim, and 1.5% of each early-exit penalty."],
        ]}
      />
      <h3 style={h3Style}>Where the protocol lives</h3>
      <p style={pStyle}>
        The program is deployed on Solana devnet at:
      </p>
      <code style={codeStyle}>5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd</code>
      <p style={{ ...pStyle, marginTop: "0.25rem" }}>
        All funds are held in a per-hackathon USDC escrow PDA. No admin key can drain funds directly — only
        resolution-gated claim instructions can move tokens to stakers.
      </p>
    </section>
  );
}

function SectionLifecycle() {
  return (
    <section id="lifecycle" style={sectionStyle}>
      <h2 style={h2Style}>Protocol Lifecycle</h2>
      <p style={pStyle}>
        Each hackathon follows a strict on-chain state machine. The diagram below shows the full flow from
        creation to payout.
      </p>

      <div style={{ position: "relative", margin: "1.5rem 0" }}>
        {[
          { tag: "orange", label: "1. Initialize Hackathon", body: "Admin calls initialize_hackathon with name, USDC mint, tier percentages, deposit amount, and timestamps. Creates the HackathonState PDA and escrow token account." },
          { tag: "orange", label: "2. Register Projects", body: "Builders call register_project with their GitHub URL. PDA is seeded with sha256(github_url) — duplicate URLs revert automatically. If requires_approval is set, admin must whitelist first." },
          { tag: "sky",    label: "3. Staking Window", body: "Stakers call stake() to deposit USDC into escrow. Shares are computed at stake time using the time-weighted multiplier (1.5× early → 1.0× at cutoff). UserStake PDAs are initialized." },
          { tag: "amber",  label: "4. Cutoff (−24 h)", body: "results_timestamp − 86 400 seconds. All staking locks. Unstaking with a 3% penalty remains available until cutoff. At and after cutoff, unstaking is fully disabled." },
          { tag: "amber",  label: "5. Resolve", body: "Admin calls resolve_project for each project to assign its rank (1-indexed, 0 = unranked). This is reversible until finalize_resolve is called." },
          { tag: "red",    label: "6. Finalize Resolve", body: "Admin calls finalize_resolve once all ranks are set. This snapshots tier_c_totals and effective_tier_pcts onto HackathonState — the values that claim will use. Irreversible." },
          { tag: "emerald",label: "7. Claim", body: "Each staker calls claim() with their UserStake PDA. Payout is computed from snapshotted values — no iteration over remaining_accounts. Protocol fee is deducted at this point." },
        ].map(({ tag, label, body }, i) => (
          <div key={i} style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "32px", height: "32px", borderRadius: "50%",
                background: tag === "orange" ? "var(--c-indigo)" : tag === "sky" ? "var(--c-sky)" : tag === "amber" ? "var(--c-amber)" : tag === "red" ? "var(--c-red)" : "var(--c-emerald)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: "0.8125rem", fontWeight: 700, flexShrink: 0,
              }}>
                {i + 1}
              </div>
              {i < 6 && <div style={{ width: "2px", flex: 1, background: "var(--card-border)", margin: "4px 0" }} />}
            </div>
            <div style={{ paddingBottom: "0.5rem" }}>
              <p style={{ margin: "0 0 0.25rem", fontWeight: 700, fontSize: "0.9375rem", color: "var(--c-text)" }}>{label}</p>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-3)", lineHeight: 1.65 }}>{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionStaking() {
  return (
    <section id="staking" style={sectionStyle}>
      <h2 style={h2Style}>Staking & Unstaking</h2>

      <h3 style={h3Style}>Staking</h3>
      <p style={pStyle}>
        Any whitelisted wallet (or any wallet when <IC>requires_approval = false</IC>) can stake USDC behind
        a registered project from the moment the hackathon is initialized until the cutoff timestamp.
      </p>
      <Table
        head={["Constraint", "Value"]}
        rows={[
          ["Max stake per wallet per project", "$250 USDC (250,000,000 μUSDC)"],
          ["Max builder self-stake", "$250 USDC (250,000,000 μUSDC)"],
          ["Builder self-stake requires", "Project must have deposit paid and be declared"],
          ["Staking window closes", "results_timestamp − 86,400 s (24 hours before results)"],
        ]}
      />
      <div style={calloutStyle("warn")}>
        Amounts are always stored in <strong>micro-USDC</strong> (6 decimal places). 1 USDC = 1,000,000 μUSDC.
        All on-chain math uses integer arithmetic — no floats.
      </div>

      <h3 style={h3Style}>Unstaking</h3>
      <p style={pStyle}>
        A staker can exit their position at any time before the cutoff, subject to a flat 3% penalty on the
        full staked amount. There is no time-based decay — the penalty is the same whether you exit one minute
        or one month after staking.
      </p>
      <code style={codeStyle}>{`penalty          = stake_amount × 300 / 10_000   // 3% flat
to_protocol      = stake_amount × 150 / 10_000   // 1.5% → fee recipient
stays_in_pool    = penalty − to_protocol          // 1.5% stays in escrow`}</code>
      <p style={pStyle}>
        The staker receives <IC>stake_amount − penalty</IC>. After cutoff (<IC>now ≥ cutoff_timestamp</IC>),
        unstaking is fully disabled — positions are locked until claim.
      </p>
    </section>
  );
}

function SectionTimeWeights() {
  return (
    <section id="time-weights" style={sectionStyle}>
      <h2 style={h2Style}>Time-Weighted Shares</h2>
      <p style={pStyle}>
        Shares determine each staker's fraction of a project's total stake pool. They are computed
        at stake time and never change — unstaking burns your shares entirely.
      </p>
      <code style={codeStyle}>{`window    = cutoff_timestamp − hackathon.start_timestamp
elapsed   = clamp(now − start_timestamp, 0, window)
mult_bps  = 15_000 − floor(5_000 × elapsed / window)  // 15000 → 10000
shares    = floor(amount × mult_bps / 10_000)`}</code>
      <p style={pStyle}>
        The multiplier decreases linearly from <IC>1.5×</IC> at the hackathon start to <IC>1.0×</IC> at the
        cutoff. Stakers who commit early receive proportionally more shares for the same USDC amount.
      </p>

      <h3 style={h3Style}>Example</h3>
      <Table
        head={["Stake time", "Elapsed / Window", "Multiplier", "1,000 USDC → Shares"]}
        rows={[
          ["T+0 (open)", "0%", "1.5×  (15,000 bps)", "1,500"],
          ["T+25%", "25%", "1.375×  (13,750 bps)", "1,375"],
          ["T+50%", "50%", "1.25×  (12,500 bps)", "1,250"],
          ["T+75%", "75%", "1.125×  (11,250 bps)", "1,125"],
          ["T+100% (cutoff)", "100%", "1.0×  (10,000 bps)", "1,000"],
        ]}
      />
      <div style={calloutStyle("info")}>
        The builder self-stake, if any, is computed by the same formula.
        A builder who stakes at genesis gets the maximum 1.5× boost.
      </div>
    </section>
  );
}

function SectionPayout() {
  return (
    <section id="payout" style={sectionStyle}>
      <h2 style={h2Style}>Payout Formula</h2>
      <p style={pStyle}>
        The payout calculation runs in two stages: first allocate the prize pool across rank tiers,
        then distribute within each tier using a square-root crowding adjustment.
      </p>

      <h3 style={h3Style}>Stage 1 — Tier allocation</h3>
      <p style={pStyle}>
        The admin configures up to 8 tiers at hackathon creation, each with a percentage
        (must sum to 100). For example: <IC>[50, 30, 20]</IC> means rank-1 projects share 50%
        of the pool, rank-2 projects share 30%, rank-3 share 20%.
      </p>
      <p style={pStyle}>
        At <IC>finalize_resolve</IC>, empty tiers (no projects assigned that rank) have their
        allocation redistributed proportionally to occupied tiers. The resulting
        <IC>effective_tier_pcts</IC> are stored on <IC>HackathonState</IC>.
      </p>

      <h3 style={h3Style}>Stage 2 — Square-root crowding (within tier)</h3>
      <p style={pStyle}>
        Within a tier, projects are weighted by the square root of their total staked amount.
        This rewards popular projects while preventing a single heavily-backed project from
        capturing the entire tier allocation.
      </p>
      <code style={codeStyle}>{`C_i         = isqrt(project.total_staked)             // integer sqrt
C_total_t   = hackathon.tier_c_totals[tier]           // snapshotted at finalize_resolve

payout =   user_shares
         × C_i
         × effective_tier_pcts[tier]
         × total_pool
         ──────────────────────────────────────────
         project.total_shares × C_total_t × 10_000`}</code>
      <p style={pStyle}>
        The protocol fee is then deducted from <IC>payout</IC> at claim time:
      </p>
      <code style={codeStyle}>{`fee              = payout × protocol_fee_bps / 10_000   // default 1.5%
staker_receives  = payout − fee`}</code>

      <h3 style={h3Style}>Worked example</h3>
      <p style={{ ...pStyle, marginBottom: "0.5rem" }}>
        Three projects in a single-rank hackathon. Total pool = 10,000 USDC. Fee = 1.5%.
      </p>
      <Table
        head={["Project", "Total Staked", "√ (C_i)", "User Shares / Total Shares", "Gross Payout", "Net (−1.5%)"]}
        rows={[
          ["Alpha", "4,000 USDC", "63.24", "500 / 1,000", "≈ 2,558 USDC", "≈ 2,520 USDC"],
          ["Beta",  "1,000 USDC", "31.62", "200 / 500",   "≈ 2,558 USDC", "≈ 2,520 USDC"],
          ["Gamma", "9,000 USDC", "94.87", "300 / 600",   "≈ 4,883 USDC", "≈ 4,810 USDC"],
        ]}
      />
      <div style={calloutStyle("info")}>
        Notice that <strong>Alpha</strong> and <strong>Beta</strong> yield the same gross payout despite Beta
        being staked 4× less — because Beta's proportional share within the project is larger. The sqrt
        crowding adjustment brings heavily-backed projects closer to less-backed ones.
      </div>
    </section>
  );
}

function SectionConstants() {
  return (
    <section id="constants" style={sectionStyle}>
      <h2 style={h2Style}>On-Chain Constants</h2>
      <p style={pStyle}>
        These values are compiled into <IC>lib.rs</IC> and apply to every hackathon unless
        otherwise overridable at initialization.
      </p>
      <Table
        head={["Constant", "Value", "Description"]}
        rows={[
          [<IC>SELL_CUTOFF_SECS</IC>, "86,400", "Staking locks 24 h before results_timestamp"],
          [<IC>UNSTAKE_PENALTY_BPS</IC>, "300 (3%)", "Flat early-exit penalty on full stake"],
          [<IC>UNSTAKE_PROTOCOL_BPS</IC>, "150 (1.5%)", "Portion of penalty sent to fee_recipient"],
          [<IC>EARLY_MULTIPLIER_BPS</IC>, "15,000 (1.5×)", "Share multiplier at hackathon start"],
          [<IC>BASE_MULTIPLIER_BPS</IC>, "10,000 (1.0×)", "Share multiplier at cutoff"],
          [<IC>MAX_STAKE_PER_WALLET</IC>, "250,000,000", "$250 USDC per wallet per project"],
          [<IC>MAX_SELF_STAKE</IC>, "250,000,000", "$250 USDC builder self-stake cap"],
          [<IC>DEFAULT_PROTOCOL_FEE_BPS</IC>, "150 (1.5%)", "Protocol fee deducted at claim"],
          [<IC>DEFAULT_DEPOSIT_AMOUNT</IC>, "10,000,000", "$10 USDC builder commitment deposit"],
          [<IC>MAX_TIERS</IC>, "8", "Maximum number of rank tiers per hackathon"],
          [<IC>PROTOCOL_ADMIN</IC>, "5mxH…cMfP", "Only wallet that can initialize hackathons"],
        ]}
      />
      <p style={pStyle}>
        <IC>protocol_fee_bps</IC> is configurable per hackathon but is capped at
        <IC>3000</IC> (30%) as an on-chain constraint.
      </p>
    </section>
  );
}

function SectionAccounts() {
  return (
    <section id="accounts" style={sectionStyle}>
      <h2 style={h2Style}>Account Structures</h2>

      <h3 style={h3Style}>HackathonState</h3>
      <p style={pStyle}>One per hackathon. Holds all configuration, state, and post-resolution snapshots.</p>
      <code style={codeStyle}>{`HackathonState {
  admin: Pubkey,
  usdc_mint: Pubkey,
  name: String,                   // max 50 bytes; also used in PDA seed
  start_timestamp: i64,
  results_timestamp: i64,
  cutoff_timestamp: i64,          // = results_timestamp − 86_400
  total_pool: u64,                // running USDC balance in escrow
  is_resolved: bool,
  tier_count: u8,
  tier_pcts: [u8; 8],             // raw percentages, must sum to 100
  effective_tier_pcts: [u16; 8],  // redistributed — set at finalize_resolve
  tier_c_totals: [u64; 8],        // sqrt C totals per tier — set at finalize_resolve
  fee_recipient: Pubkey,
  protocol_fee_bps: u16,          // capped at 3000
  deposit_amount: u64,
  requires_approval: bool,
  bump: u8,
}`}</code>

      <h3 style={h3Style}>ProjectAccount</h3>
      <p style={pStyle}>One per project per hackathon.</p>
      <code style={codeStyle}>{`ProjectAccount {
  hackathon: Pubkey,
  github_url: String,           // max 200 chars; sha256 used for PDA seed
  total_staked: u64,
  total_shares: u64,
  rank: u8,                     // 0 = unresolved; 1-indexed
  builder_wallet: Pubkey,
  deposit_amount_paid: u64,
  builder_staked: u64,
  builder_declared: bool,
  submitted: bool,
  is_refund_enabled: bool,
  deposit_forfeited: bool,
  deposit_refunded: bool,
  bump: u8,
}`}</code>

      <h3 style={h3Style}>UserStake</h3>
      <p style={pStyle}>One per (user, project) pair. Holds the raw stake and computed shares.</p>
      <code style={codeStyle}>{`UserStake {
  user: Pubkey,
  project: Pubkey,
  amount: u64,
  shares: u64,
  stake_timestamp: i64,
  is_claimed: bool,
  bump: u8,
}`}</code>

      <h3 style={h3Style}>WhitelistedWallet</h3>
      <p style={pStyle}>Existence of this PDA grants a wallet permission to stake when <IC>requires_approval = true</IC>.</p>
      <code style={codeStyle}>{`WhitelistedWallet {
  hackathon: Pubkey,
  wallet: Pubkey,
  bump: u8,
}`}</code>
    </section>
  );
}

function SectionPdaSeeds() {
  return (
    <section id="pda-seeds" style={sectionStyle}>
      <h2 style={h2Style}>PDA Seeds</h2>
      <p style={pStyle}>All program-derived addresses are deterministic from the seeds below.</p>
      <Table
        head={["Account", "Seeds"]}
        rows={[
          [<IC>HackathonState</IC>, <><IC>"hackathon"</IC> + admin pubkey + name (UTF-8 bytes)</>],
          [<IC>ProjectAccount</IC>, <><IC>"project"</IC> + hackathon pubkey + <strong>sha256(github_url)</strong></>],
          [<IC>UserStake</IC>, <><IC>"stake"</IC> + user pubkey + project pubkey</>],
          [<><IC>Escrow</IC>{" (token acct)"}</>, <><IC>"escrow"</IC> + hackathon pubkey</>],
          [<IC>WhitelistedWallet</IC>, <><IC>"whitelist"</IC> + hackathon pubkey + wallet pubkey</>],
        ]}
      />
      <div style={calloutStyle("warn")}>
        <strong>ProjectAccount</strong> uses the SHA-256 hash of the URL, not the raw bytes. This is
        critical: passing the wrong hash will derive a different PDA address and the transaction will fail.
        Always derive the hash client-side before constructing the instruction.
      </div>
      <p style={pStyle}>All helpers live in <IC>frontend/lib/pda.ts</IC>.</p>
    </section>
  );
}

function SectionClaimArch() {
  return (
    <section id="claim-arch" style={sectionStyle}>
      <h2 style={h2Style}>Claim Architecture</h2>
      <p style={pStyle}>
        Early versions of the protocol computed <IC>C_total_t</IC> inside the <IC>claim</IC> instruction
        by iterating all project accounts passed as <IC>remaining_accounts</IC>. This had two problems:
      </p>
      <ul style={{ ...pStyle, paddingLeft: "1.25rem" }}>
        <li>CU cost scaled linearly with the number of projects (O(N)).</li>
        <li>A malicious caller could pass a crafted <IC>remaining_accounts</IC> list that manipulated the
          denominator and inflated their payout (Audit finding C-01).</li>
      </ul>

      <h3 style={h3Style}>The fix (C-01)</h3>
      <p style={pStyle}>
        <IC>finalize_resolve</IC> now iterates all projects and snapshots the per-tier square-root
        totals into <IC>hackathon.tier_c_totals[t]</IC>. The <IC>claim</IC> instruction reads this
        value directly from <IC>HackathonState</IC> — no <IC>remaining_accounts</IC> needed.
      </p>
      <code style={codeStyle}>{`// finalize_resolve — runs once, O(N):
for each project p in tier t:
    tier_c_totals[t] += isqrt(p.total_staked)

// claim — O(1), caller-manipulation-proof:
let c_total = hackathon.tier_c_totals[project.rank − 1]`}</code>

      <h3 style={h3Style}>CU benchmark (Bankrun, post-fix)</h3>
      <Table
        head={["N projects", "Claim CU"]}
        rows={[
          ["5",  "18,111"],
          ["10", "18,111"],
          ["20", "18,111"],
        ]}
      />
      <p style={pStyle}>Flat CU — independent of the number of projects in the hackathon.</p>
    </section>
  );
}

function SectionFees() {
  return (
    <section id="fees" style={sectionStyle}>
      <h2 style={h2Style}>Fee Architecture</h2>
      <p style={pStyle}>The protocol charges fees at two distinct events:</p>

      <h3 style={h3Style}>Early-exit penalty (unstake)</h3>
      <p style={pStyle}>
        Applied whenever a staker withdraws before the cutoff. The full 3% is split: 1.5% leaves
        the escrow and goes to <IC>fee_recipient</IC>; the remaining 1.5% stays in the escrow and
        becomes part of the prize pool for remaining stakers.
      </p>
      <code style={codeStyle}>{`penalty          = amount × 300 / 10_000   // 3%
to_fee_recipient = amount × 150 / 10_000   // 1.5% exits escrow
stays_in_pool    = penalty − to_fee_recipient`}</code>

      <h3 style={h3Style}>Protocol fee (claim)</h3>
      <p style={pStyle}>
        Deducted from each winning staker's gross payout at claim time.
      </p>
      <code style={codeStyle}>{`fee             = gross_payout × protocol_fee_bps / 10_000   // default 1.5%
staker_receives = gross_payout − fee`}</code>
      <p style={pStyle}>
        <IC>protocol_fee_bps</IC> is set per-hackathon at initialization and capped at 3,000 (30%)
        by the program. If 0, no fee is deducted and no transfer to <IC>fee_recipient</IC> occurs.
      </p>

      <h3 style={h3Style}>Builder deposit</h3>
      <p style={pStyle}>
        Builders pay a configurable deposit (default $10 USDC) when registering. This commitment
        deposit is added to the prize pool and refundable only if the project is formally submitted
        and the admin enables refunds. If the builder fails to submit, the deposit is forfeited to
        the pool.
      </p>
      <div style={calloutStyle("warn")}>
        If <IC>deposit_forfeited = true</IC>, <IC>claim_deposit_refund</IC> will revert. This is
        enforced on-chain (Audit finding H-01 fix).
      </div>
    </section>
  );
}

function SectionAdminOps() {
  return (
    <section id="admin-ops" style={sectionStyle}>
      <h2 style={h2Style}>Admin Operations</h2>

      <Table
        head={["Instruction", "Who", "Description"]}
        rows={[
          [<IC>initialize_hackathon</IC>, "Protocol Admin", "Creates HackathonState + escrow. Requires results_timestamp > now + 86,400 s (M-01 fix)."],
          [<IC>whitelist_wallet</IC>, "Protocol Admin", "Creates WhitelistedWallet PDA for a staker. Only needed when requires_approval = true."],
          [<IC>register_project</IC>, "Builder", "Creates ProjectAccount. Duplicate GitHub URLs revert via PDA collision."],
          [<IC>pay_deposit</IC>, "Builder", "Transfers deposit_amount from builder to escrow."],
          [<IC>declare_builder</IC>, "Builder", "Sets builder_declared = true, enabling self-staking."],
          [<IC>stake</IC>, "Staker / Builder", "Deposits USDC, mints shares, updates total_pool."],
          [<IC>unstake</IC>, "Staker", "Withdraws with 3% penalty before cutoff. Disabled at cutoff."],
          [<IC>resolve_project</IC>, "Protocol Admin", "Sets project.rank. Reversible until finalize_resolve."],
          [<IC>finalize_resolve</IC>, "Protocol Admin", "Snapshots tier_c_totals and effective_tier_pcts. Irreversible."],
          [<IC>claim</IC>, "Staker", "Computes payout from snapshots, transfers USDC, sets is_claimed."],
          [<IC>claim_deposit_refund</IC>, "Builder", "Returns deposit if submitted + refund enabled + not forfeited."],
          [<IC>enable_refund</IC>, "Protocol Admin", "Sets is_refund_enabled on a project."],
          [<IC>toggle_open_registration</IC>, "Protocol Admin", "Flips requires_approval on HackathonState."],
        ]}
      />

      <h3 style={h3Style}>Resolve flow</h3>
      <p style={pStyle}>
        Ranking is a two-step commit. First, call <IC>resolve_project</IC> for each project in any
        order — ranks can be re-set until <IC>finalize_resolve</IC> is called. Then call
        <IC>finalize_resolve</IC> once. This is the only irreversible step and it fires the
        snapshot.
      </p>
      <div style={calloutStyle("danger")}>
        <IC>finalize_resolve</IC> is irreversible. Once called, ranks and payout parameters are
        frozen. Double-check all project ranks before calling.
      </div>
    </section>
  );
}

function SectionAudit() {
  return (
    <section id="audit" style={sectionStyle}>
      <h2 style={h2Style}>Audit Fixes</h2>
      <p style={pStyle}>
        An internal Codex audit (2026-04-25) identified five findings. All have been applied and
        verified by the 82/82 Bankrun test suite.
      </p>
      <Table
        head={["ID", "Severity", "Finding", "Fix"]}
        rows={[
          ["C-01", <span style={tagStyle("red")}>Critical</span>, "claim iterated remaining_accounts to compute C_total, allowing caller manipulation of the payout denominator.", "finalize_resolve snapshots tier_c_totals on-chain. claim reads the stored value — no remaining_accounts iteration."],
          ["C-02", <span style={tagStyle("red")}>Critical</span>, "refund did not decrement total_pool / total_staked / total_shares, leaving stale state after refunds.", "refund now decrements all three fields before the token transfer (CEI pattern)."],
          ["H-01", <span style={tagStyle("orange")}>High</span>, "claim_deposit_refund did not check deposit_forfeited, allowing forfeited-deposit wallets to double-claim.", "Instruction reverts if deposit_forfeited = true."],
          ["M-01", <span style={tagStyle("amber")}>Medium</span>, "initialize_hackathon accepted results_timestamp in the past or within the cutoff window.", "Requires results_timestamp > Clock::get().unix_timestamp + SELL_CUTOFF_SECS."],
          ["M-02", <span style={tagStyle("amber")}>Medium</span>, "No upper bound on protocol_fee_bps allowed fees up to 65,535 bps (655%).", "Fee capped at 3,000 bps (30%) at initialization."],
        ]}
      />
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const { publicKey } = useWallet();
  const { isProtocolAdmin, loading } = useIsProtocolAdmin(publicKey ?? null);
  const isDeployer = publicKey?.toBase58() === DEPLOYER;
  const canView = isProtocolAdmin || isDeployer;

  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveSection(e.target.id as SectionId);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, [canView]);

  // ── Unauthorized states ───────────────────────────────────────────────────

  if (!publicKey) {
    return (
      <>
        <Navbar />
        <main style={{ minHeight: "100vh", background: "var(--page-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <p style={{ ...pStyle, color: "var(--c-text-4)" }}>Connect your wallet to continue.</p>
          </div>
        </main>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <Navbar />
        <main style={{ minHeight: "100vh", background: "var(--page-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ ...pStyle, color: "var(--c-text-4)" }}>Checking access…</p>
        </main>
      </>
    );
  }

  if (!canView) {
    return (
      <>
        <Navbar />
        <main style={{ minHeight: "100vh", background: "var(--page-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <p style={{ fontWeight: 700, fontSize: "1.125rem", color: "var(--c-text)", margin: "0 0 0.5rem" }}>Access restricted</p>
            <p style={{ ...pStyle, color: "var(--c-text-4)", margin: 0 }}>Protocol documentation is only visible to admins.</p>
          </div>
        </main>
      </>
    );
  }

  // ── Docs layout ───────────────────────────────────────────────────────────

  return (
    <>
      <Navbar />
      <div style={{ minHeight: "100vh", background: "var(--page-bg)" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "0 16px", display: "flex", gap: "0" }}>

          {/* Sidebar */}
          <aside
            className="hidden-sm-flex"
            style={{
              width: "220px",
              flexShrink: 0,
              position: "sticky",
              top: "64px",
              height: "calc(100vh - 64px)",
              overflowY: "auto",
              paddingTop: "2rem",
              paddingBottom: "2rem",
              paddingRight: "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}
          >
            <p style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c-text-4)", margin: "0 0 0.75rem 8px" }}>
              Protocol Docs
            </p>
            {SECTIONS.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                style={{
                  display: "block",
                  padding: "5px 8px",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  fontWeight: activeSection === id ? 600 : 400,
                  color: activeSection === id ? "var(--c-indigo-text)" : "var(--c-text-3)",
                  background: activeSection === id ? "var(--c-indigo-light)" : "transparent",
                  textDecoration: "none",
                  transition: "all 0.12s",
                  borderLeft: activeSection === id ? "2px solid var(--c-indigo)" : "2px solid transparent",
                }}
              >
                {label}
              </a>
            ))}
          </aside>

          {/* Content */}
          <main style={{ flex: 1, minWidth: 0, paddingTop: "2.5rem", paddingBottom: "4rem", paddingLeft: "2rem" }}>
            {/* Header */}
            <div style={{ marginBottom: "2.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                <span style={tagStyle("orange")}>Admin only</span>
                <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>Protocol v1 — devnet</span>
              </div>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.75rem, 4vw, 2.5rem)", fontWeight: 900, letterSpacing: "-0.03em", color: "var(--c-text)", margin: "0 0 0.75rem" }}>
                HACK<span style={{ color: "var(--c-indigo-text)" }}>BET</span> Protocol Reference
              </h1>
              <p style={{ ...pStyle, fontSize: "1rem", color: "var(--c-text-3)", maxWidth: "640px" }}>
                Complete technical reference for the HackBet rank-weighted conviction pool protocol.
                Covers staking mechanics, payout formulas, on-chain account structures, and admin operations.
              </p>
              <div style={{ height: "1px", background: "var(--c-divider)", margin: "1.5rem 0" }} />
            </div>

            <SectionOverview />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionLifecycle />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionStaking />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionTimeWeights />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionPayout />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionConstants />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionAccounts />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionPdaSeeds />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionClaimArch />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionFees />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionAdminOps />
            <div style={{ height: "1px", background: "var(--c-divider-2)", marginBottom: "3.5rem" }} />
            <SectionAudit />
          </main>
        </div>
      </div>
    </>
  );
}
