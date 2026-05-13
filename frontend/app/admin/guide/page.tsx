"use client";

import Navbar from "@/components/Navbar";
import { useWallet } from "@solana/wallet-adapter-react";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";
import { useHackathons } from "@/hooks/useHackathons";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-text-4)" }}>{title}</p>
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%", background: "var(--c-indigo-light)", border: "1px solid var(--c-indigo-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700, color: "var(--c-indigo-text)" }}>{n}</div>
      <div>
        <p style={{ margin: "0 0 2px", fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-2)" }}>{title}</p>
        <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.6, color: "var(--c-text-3)" }}>{children}</p>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0, width: "6px", height: "6px", marginTop: "8px", borderRadius: "50%", background: "var(--c-text-4)" }} />
      <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.6, color: "var(--c-text-3)" }}>{children}</p>
    </div>
  );
}

export default function AdminGuidePage() {
  const { publicKey } = useWallet();
  const { isProtocolAdmin } = useIsProtocolAdmin(publicKey ?? null);
  const { hackathons } = useHackathons();
  const managesHackathons = publicKey ? hackathons.some((h) => h.admin.equals(publicKey)) : false;
  const isAdmin = isProtocolAdmin || managesHackathons;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ margin: "0 auto", maxWidth: "768px", padding: "40px 16px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ margin: 0, fontSize: "1.875rem", fontWeight: 800, color: "var(--c-text)" }}>Admin Guide</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>How to run the organizer side of HackBet.</p>
        </div>

        {!isAdmin ? (
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
            Access restricted. Connect a protocol admin or assigned hackathon admin wallet to view this guide.
          </div>
        ) : (
          <section className="ui-card" style={{ padding: "24px" }}>
            <div style={{ marginBottom: "24px" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Admin How To</h2>
              <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.7, color: "var(--c-text-3)" }}>
                Use this page to run the organizer side of HackBet: create hackathons, approve submissions, manage staking access, and finalize results.
              </p>
            </div>

            <div style={{ marginBottom: "24px", borderRadius: "16px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "18px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "0.8rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--c-amber-text)" }}>Your role</p>
              <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.7, color: "var(--c-text-2)" }}>
                Protocol admins can create hackathons and manage every event. Wallets assigned as a hackathon&apos;s admin can manage that specific event&apos;s submissions, deposits, whitelist flow, and final resolution.
              </p>
              {!isProtocolAdmin && (
                <p style={{ margin: "10px 0 0", fontSize: "0.8125rem", lineHeight: 1.6, color: "var(--c-amber-text)" }}>
                  This wallet can manage assigned hackathons, but it cannot create brand new hackathons.
                </p>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              <Section title="Create and configure">
                <Step n={1} title="Create the hackathon">
                  Use the Create tab in the Admin Panel to set the hackathon name, results timing, prize tiers, builder deposit amount, protocol fee, and fee recipient.
                </Step>
                <Step n={2} title="Add metadata after creation">
                  Once the hackathon exists, expand its card and add the official link and icon so the public page has the right presentation.
                </Step>
                <Step n={3} title="Decide the approval flow">
                  Review whether staking is open or gated, then monitor builder submissions and community access from the admin panels.
                </Step>
              </Section>

              <Section title="Run the event">
                <Bullet>Approve project submissions so builders become live, on-chain projects that can receive deposits and staking.</Bullet>
                <Bullet>Use staker access tools to whitelist wallets for one hackathon or across all hackathons when needed.</Bullet>
                <Bullet>For deposit-backed events, organizer approval is what unlocks the normal builder refund path after builder declaration.</Bullet>
                <Bullet>Refund override is the exceptional path for cancellations, judging mistakes, or organizer exceptions.</Bullet>
              </Section>

              <Section title="Resolve and close">
                <Step n={1} title="Set ranks">
                  Enter project ranks inside the hackathon card. Rank 1 is the winner, and leaving a project at 0 keeps it unranked.
                </Step>
                <Step n={2} title="Finalize the results">
                  Finalizing resolution is the permanent step that opens claims for stakers and locks in the official on-chain outcome.
                </Step>
                <Step n={3} title="Handle post-event cleanup">
                  After resolution, only use deposit forfeits or refund overrides when the builder flow truly requires an exceptional intervention.
                </Step>
              </Section>

              <Section title="Admin rights">
                <Bullet>The super-admin can delegate protocol admin rights to additional wallets from the Admin Delegation panel.</Bullet>
                <Bullet>Delegated protocol admins can create hackathons and manage the full organizer workflow.</Bullet>
                <Bullet>The wallet stored as the hackathon admin can manage that event even without global protocol-admin rights.</Bullet>
              </Section>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
