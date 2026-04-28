"use client";

import { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

type Role = "staker" | "builder" | "admin";

const ROLES: { id: Role; label: string; color: string; borderColor: string; textColor: string }[] = [
  { id: "staker",  label: "Staker",  color: "var(--c-indigo-light)",  borderColor: "var(--c-indigo-border)",  textColor: "var(--c-indigo-text)" },
  { id: "builder", label: "Builder", color: "var(--c-emerald-light)", borderColor: "var(--c-emerald-border)", textColor: "var(--c-emerald-text)" },
  { id: "admin",   label: "Admin",   color: "var(--c-amber-light)",   borderColor: "var(--c-amber-border)",   textColor: "var(--c-amber-text)" },
];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "16px" }}>
      <div style={{ flexShrink: 0, display: "flex", height: "32px", width: "32px", alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: "var(--c-indigo)", color: "#fff", fontSize: "0.875rem", fontWeight: 700 }}>
        {n}
      </div>
      <div style={{ paddingTop: "4px" }}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-text)" }}>{title}</p>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-3)", lineHeight: 1.6 }}>{children}</p>
      </div>
    </div>
  );
}

function Pill({ children, color, border, text }: { children: React.ReactNode; color: string; border: string; text: string }) {
  return (
    <span style={{ display: "inline-block", borderRadius: "9999px", border: `1px solid ${border}`, background: color, padding: "2px 10px", fontSize: "0.75rem", fontWeight: 600, color: text }}>
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "24px" }}>
      <p style={{ margin: "0 0 12px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-text-4)" }}>{title}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{children}</div>
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "0.875rem", color: "var(--c-text-2)", lineHeight: 1.6 }}>
      <span style={{ flexShrink: 0, marginTop: "5px", height: "6px", width: "6px", borderRadius: "9999px", background: "var(--c-indigo)" }} />
      <span>{children}</span>
    </div>
  );
}

function StakerGuide() {
  return (
    <div>
      <div style={{ marginBottom: "24px", borderRadius: "12px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "16px" }}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-indigo-text)" }}>Your role</p>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-2)", lineHeight: 1.6 }}>
          Stakers are the signal engine of HackBet. You put USDC behind the hackathon projects you believe in. Your conviction — and the crowd&apos;s collective judgment — is recorded permanently on-chain. After results, winners redistribute the pool proportional to their crowd backing.
        </p>
      </div>

      <Section title="Prerequisites">
        <Item>A Solana wallet (Phantom, Solflare, or Backpack) with USDC</Item>
        <Item>Whitelist approval from the hackathon organizer — you need a <strong>WhitelistedWallet</strong> PDA for the specific hackathon</Item>
        <Item>Request access directly on the hackathon page if your wallet isn&apos;t whitelisted yet</Item>
      </Section>

      <Section title="How to stake">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Step n={1} title="Browse hackathons">
            Visit the <Link href="/" className="ui-text-link">Hackathons</Link> list. Open ones show a <Pill color="var(--c-emerald-light)" border="var(--c-emerald-border)" text="var(--c-emerald-text)">Open for staking</Pill> badge and a countdown to cutoff.
          </Step>
          <Step n={2} title="Connect your wallet">
            Click <strong>Connect Wallet</strong> in the navbar. Your wallet must hold USDC for the hackathon&apos;s network.
          </Step>
          <Step n={3} title="Pick a project and back it">
            On the hackathon detail page, click <strong>Back</strong> next to any project. Enter a USDC amount and confirm the transaction.
          </Step>
          <Step n={4} title="Earn early-backer multiplier">
            Stakes placed earlier earn a higher share multiplier — <strong>1.5×</strong> at the time of a project&apos;s registration, decaying to <strong>1.0×</strong> at hackathon cutoff. Earlier conviction = more shares.
          </Step>
          <Step n={5} title="Wait for results">
            Staking locks 24 hours before the results timestamp. After the admin finalizes the judge ranking, the hackathon enters <Pill color="var(--c-indigo-light)" border="var(--c-indigo-border)" text="var(--c-indigo-text)">Resolved</Pill> state.
          </Step>
          <Step n={6} title="Claim your payout">
            Click <strong>Claim payout</strong> on the project you backed. Payout is calculated using a sqrt-crowding formula — backing less-popular winning projects pays out more per USDC.
          </Step>
        </div>
      </Section>

      <Section title="Key rules">
        <Item><strong>3% early exit fee</strong> if you unstake before cutoff — 1.5% goes to the protocol fee recipient, 1.5% stays in the pool.</Item>
        <Item>Unstaking is <strong>locked 24 h before results</strong>. Plan accordingly.</Item>
        <Item>Builders may also stake on their own project — this is public, on-chain conviction signal and is visible alongside community stakes.</Item>
        <Item>The payout formula rewards correct conviction, not just the biggest stake.</Item>
      </Section>

      <Section title="Payout formula (simplified)">
        <Item>The pool is split between prize tiers (e.g. #1 gets 55%, #2 gets 30%, #3 gets 15%).</Item>
        <Item>Within each tier, your share = <code style={{ fontFamily: "monospace", fontSize: "0.85em" }}>your_shares × √(project_total_staked)</code>, crowding-adjusted so backing under-backed winners pays more.</Item>
        <Item>A protocol fee (set at hackathon creation, typically 1.5%) is deducted from your payout at claim time.</Item>
      </Section>
    </div>
  );
}

function BuilderGuide() {
  return (
    <div>
      <div style={{ marginBottom: "24px", borderRadius: "12px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "16px" }}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-emerald-text)" }}>Your role</p>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-2)", lineHeight: 1.6 }}>
          Builders register their hackathon project on-chain and optionally put skin in the game with a commitment deposit and self-stake. Your project becomes a public signal — the community backs projects they believe will win, creating a crowd-sourced prediction that persists even after the event.
        </p>
      </div>

      <Section title="Step-by-step flow">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Step n={1} title="Sign in">
            Go to <Link href="/dev" className="ui-text-link">Dev Portal</Link>. Sign in with email (magic link), Google, or X. This links your project submission to your identity.
          </Step>
          <Step n={2} title="Connect your wallet">
            Connect the Solana wallet you&apos;ll use as your on-chain builder identity. This address is permanently stored as the <strong>builder_wallet</strong> on your project account.
          </Step>
          <Step n={3} title="Submit your project">
            Click <strong>Submit project</strong> on an open hackathon. Enter your GitHub repo URL — this calls <code style={{ fontFamily: "monospace", fontSize: "0.85em" }}>register_project</code> on-chain (creates your project PDA) and queues a submission for organizer review.
          </Step>
          <Step n={4} title="Pay the commitment deposit">
            If the hackathon requires a deposit (e.g. $10 USDC), pay it via the <strong>My Projects</strong> section. The deposit is held in escrow — you get it back when you submit.
          </Step>
          <Step n={5} title="Self-stake (optional but visible)">
            Stake USDC on your own project via <strong>Self-stake</strong>. This is public, on-chain proof of your own conviction. There&apos;s a minimum and maximum set by the protocol.
          </Step>
          <Step n={6} title="Mark as submitted">
            When your project is shipped, click <strong>Mark as submitted</strong>. This sends a signal that the admin uses to confirm your submission and unlock your deposit refund.
          </Step>
          <Step n={7} title="Claim your deposit refund">
            Once the admin unlocks your deposit, click <strong>Claim refund</strong> to retrieve it from escrow.
          </Step>
        </div>
      </Section>

      <Section title="What happens after judging">
        <Item>Admins set judge rankings and finalize resolution. Your project is assigned a rank on-chain.</Item>
        <Item>Stakers who backed your project can now claim payouts based on your rank and the payout formula.</Item>
        <Item>The <Link href="/" className="ui-text-link">Crowd vs. Judges</Link> comparison is visible on the hackathon page — showing whether the community called it correctly.</Item>
      </Section>

      <Section title="Deposit rules">
        <Item>Deposit is forfeit if you don&apos;t mark the project as submitted.</Item>
        <Item>A forfeited deposit goes to the protocol fee recipient (the organizer&apos;s designated wallet).</Item>
      </Section>
    </div>
  );
}

function AdminGuide() {
  return (
    <div>
      <div style={{ marginBottom: "24px", borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "16px" }}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--c-amber-text)" }}>Your role</p>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-text-2)", lineHeight: 1.6 }}>
          Admins are hackathon organizers or delegated operators. They initialize hackathons on-chain, curate participants via the whitelist, approve project submissions, and finalize results after judging. Admin actions are gated by the protocol — only wallets with a <strong>ProtocolAdminEntry</strong> PDA (or the super-admin) can execute them.
        </p>
      </div>

      <Section title="Creating a hackathon">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Step n={1} title="Open the Admin panel">
            Navigate to <Link href="/admin" className="ui-text-link">/admin</Link> with a protocol admin or deployer wallet connected.
          </Step>
          <Step n={2} title="Configure the hackathon">
            Set: name, results date, number of tiers (up to 8) with prize percentages summing to 100%, builder deposit amount, protocol fee (bps), fee recipient wallet, and whether submissions require approval.
          </Step>
          <Step n={3} title="Add hackathon metadata">
            After creation, expand the hackathon card and set an official link and icon URL. These appear on the public hackathon detail page.
          </Step>
        </div>
      </Section>

      <Section title="Managing participants">
        <Item><strong>Whitelist stakers</strong> — paste any Solana wallet address into the Whitelist panel and confirm the transaction. Only whitelisted wallets can stake in your hackathon.</Item>
        <Item><strong>Approve project submissions</strong> — builders submit via the Dev Portal and appear in the Submissions queue. Approved projects become visible on the hackathon page; rejected ones stay hidden.</Item>
        <Item><strong>Forfeit deposits</strong> — in the Deposit Management section, forfeit the deposit of any builder who registered but didn&apos;t submit their project. This sends the deposit to your fee recipient wallet.</Item>
      </Section>

      <Section title="Resolving a hackathon">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Step n={1} title="Set ranks">
            Enter a rank number for each project (1 = winner). Leave 0 for unranked. Click <strong>Set ranks</strong> — this calls the on-chain <code style={{ fontFamily: "monospace", fontSize: "0.85em" }}>resolve</code> instruction per project.
          </Step>
          <Step n={2} title="Finalize (irreversible)">
            Click <strong>Finalize resolve</strong> and confirm. This is permanent — it computes effective tier allocations, snapshots sqrt totals, and sets <code style={{ fontFamily: "monospace", fontSize: "0.85em" }}>is_resolved = true</code>. Stakers can now claim.
          </Step>
        </div>
      </Section>

      <Section title="Admin delegation">
        <Item>The super-admin (<strong>PROTOCOL_ADMIN</strong>) can grant the admin role to additional wallets via the <strong>Admin Delegation</strong> panel.</Item>
        <Item>Delegated admins can whitelist wallets and resolve hackathons. Only the super-admin can create hackathons.</Item>
        <Item>Revoke delegated admins at any time from the same panel.</Item>
      </Section>

      <Section title="Exceptional paths">
        <Item><strong>Enable refund</strong> — if a project is disqualified or withdrawn, enable refunds for it. Stakers backing that project can then reclaim their USDC instead of receiving a payout.</Item>
        <Item><strong>Emergency refund mode</strong> — the <code style={{ fontFamily: "monospace", fontSize: "0.85em" }}>enable_refund / refund</code> path lets stakers exit even after the cutoff if you activate it.</Item>
      </Section>
    </div>
  );
}

export default function HowToUsePage() {
  const [activeRole, setActiveRole] = useState<Role>("staker");
  const active = ROLES.find((r) => r.id === activeRole)!;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ margin: "0 auto", maxWidth: "800px", padding: "40px 16px 80px" }}>

        {/* Hero */}
        <div style={{ marginBottom: "40px" }}>
          <h1 style={{ margin: "0 0 12px", fontSize: "clamp(1.75rem, 4vw, 2.25rem)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.035em", color: "var(--c-text)" }}>
            How to use HackBet
          </h1>
          <p style={{ margin: 0, fontSize: "1rem", color: "var(--c-text-3)", lineHeight: 1.7, maxWidth: "600px" }}>
            HackBet is an on-chain conviction signal market for hackathons. Builders register projects, stakers back who they think will win with USDC, and after judging, the crowd&apos;s prediction is permanently visible on-chain alongside the official results.
          </p>
        </div>

        {/* Ecosystem overview */}
        <div className="ui-card" style={{ marginBottom: "32px", padding: "24px" }}>
          <h2 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            The ecosystem
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            {[
              {
                title: "Organizers / Admins",
                color: "var(--c-amber-light)", border: "var(--c-amber-border)", text: "var(--c-amber-text)",
                desc: "Create hackathons, curate whitelists, approve submissions, and publish official judge rankings."
              },
              {
                title: "Builders",
                color: "var(--c-emerald-light)", border: "var(--c-emerald-border)", text: "var(--c-emerald-text)",
                desc: "Register projects, pay a commitment deposit, and optionally self-stake to signal conviction in their own work."
              },
              {
                title: "Stakers",
                color: "var(--c-indigo-light)", border: "var(--c-indigo-border)", text: "var(--c-indigo-text)",
                desc: "Whitelisted community members who back projects they believe will win. The crowd ranking is the signal."
              },
            ].map((card) => (
              <div key={card.title} style={{ borderRadius: "12px", border: `1px solid ${card.border}`, background: card.color, padding: "16px" }}>
                <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "0.875rem", color: card.text }}>{card.title}</p>
                <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--c-text-2)", lineHeight: 1.5 }}>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* How it works — 4-step overview */}
        <div className="ui-card" style={{ marginBottom: "32px", padding: "24px" }}>
          <h2 style={{ margin: "0 0 20px", fontSize: "1rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            How it works
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <Step n={1} title="Hackathon created on-chain">
              An admin initializes a hackathon with a name, results date, prize tiers, and a builder deposit amount.
            </Step>
            <Step n={2} title="Builders register, stakers back">
              Builders submit their GitHub repo URL — this creates an on-chain project PDA. Whitelisted stakers browse projects and lock in USDC. Earlier stakers earn a higher share multiplier (1.5× at project registration → 1.0× at hackathon cutoff).
            </Step>
            <Step n={3} title="Staking locks 24h before results">
              Once the cutoff passes, no new stakes or unstakes are accepted. The pool is frozen.
            </Step>
            <Step n={4} title="Results published → claims open">
              The admin sets judge rankings on-chain and finalizes. Stakers who backed winners claim payouts. Builders who&apos;ve submitted claim their deposits.
            </Step>
          </div>
        </div>

        {/* Role-specific guides */}
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            Guide by role
          </h2>

          {/* Tab strip */}
          <div style={{ display: "flex", gap: "4px", borderRadius: "12px", border: "1px solid var(--card-border)", background: "var(--card-bg)", padding: "4px", marginBottom: "24px", width: "fit-content" }}>
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRole(r.id)}
                style={{
                  padding: "8px 20px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                  background: activeRole === r.id ? r.color : "transparent",
                  color: activeRole === r.id ? r.textColor : "var(--c-text-3)",
                  outline: activeRole === r.id ? `1px solid ${r.borderColor}` : "none",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Role content */}
          <div className="ui-card" style={{ padding: "28px" }}>
            {activeRole === "staker"  && <StakerGuide />}
            {activeRole === "builder" && <BuilderGuide />}
            {activeRole === "admin"   && <AdminGuide />}
          </div>
        </div>

        {/* Quick links */}
        <div className="ui-card" style={{ padding: "20px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "1rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
            Quick links
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {[
              { href: "/",          label: "Browse hackathons" },
              { href: "/dev",       label: "Submit a project" },
              { href: "/dashboard", label: "Activity dashboard" },
              { href: "/admin",     label: "Admin panel" },
            ].map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                style={{
                  borderRadius: "8px",
                  border: "1px solid var(--c-divider)",
                  background: "var(--card-bg-alt)",
                  padding: "8px 16px",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color: "var(--c-text-2)",
                  textDecoration: "none",
                  transition: "border-color 0.15s",
                }}
              >
                {label} →
              </Link>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
