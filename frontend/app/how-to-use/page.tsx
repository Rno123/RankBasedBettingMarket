"use client";

import { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

type Role = "staker" | "builder";

type RoleGuide = {
  id: Role;
  label: string;
  accentBg: string;
  accentBorder: string;
  accentText: string;
  ecosystemBody: string;
  roleBody: string;
  ctaHref: string;
  ctaLabel: string;
  steps: Array<{ title: string; body: string }>;
  notes: string[];
};

const ROLE_GUIDES: RoleGuide[] = [
  {
    id: "builder",
    label: "Builder",
    accentBg: "var(--c-emerald-light)",
    accentBorder: "var(--c-emerald-border)",
    accentText: "var(--c-emerald-text)",
    ecosystemBody:
      "Submit projects for review, pay commitment deposit, and self-stake to show conviction in your own project.",
    roleBody:
      "Builders bring projects into the market. Your repo is registered on-chain, and then becomes something the community can back before the hackathon ends.",
    ctaHref: "/devs",
    ctaLabel: "Open builder portal",
    steps: [
      {
        title: "Sign in and connect your wallet",
        body: "Use the Builders' tab to sign in, then connect the Solana wallet that will be tied to your project on-chain.",
      },
      {
        title: "Select an ongoing hackathon you intend to participate in",
        body: "Choose an active hackathon and register your project by submitting your GitHub repository (may be subject to approval).",
      },
      {
        title: "Pay the builder deposit",
        body: "To prevent spam, builders are required to pay a refundable commitment deposit. Projects without deposits are ineligible for staking.",
      },
      {
        title: "Self-stake if you want to signal conviction",
        body: "Builders can back their own project. Self-stake amount is public and verifiable, along with community backing.",
      },
      {
        title: "Mark the project submitted",
        body: "Once you've submitted your project, mark it submitted before results are posted so the organizer can release your deposit refund.",
      },
      {
        title: "Claim your refund after organizer approval",
        body: "After the hackathon results are published, the refund function will be unlocked for eligible builders.",
      },
    ],
    notes: [
      "Projects can be submitted without deposit, but only those with a deposit are included in the staking pool.",
      "The hackathon organizer controls the deposit refund function. Reach out if you think there's a mistake.",
      "It is possible, but not encouraged, to submit a project on behalf of other builders."
    ],
  },
  {
    id: "staker",
    label: "Staker",
    accentBg: "var(--c-indigo-light)",
    accentBorder: "var(--c-indigo-border)",
    accentText: "var(--c-indigo-text)",
    ecosystemBody:
      "Back the projects you believe in with USDC, create a visible market signal before judging, and claim from winning outcomes after resolution.",
    roleBody:
      "Stakers are the signal engine of HackBet. You put USDC behind the projects you believe will win, and the crowd's conviction remains visible on-chain beside the official outcome.",
    ctaHref: "/hackathons",
    ctaLabel: "Browse hackathons",
    steps: [
      {
        title: "Browse live hackathons",
        body: "Start from the Hackathons page and choose an event that is still open for staking.",
      },
      {
        title: "Connect a wallet with USDC",
        body: "Your wallet should be on the right network and hold USDC. Some hackathons may require you to be whitelisted.",
      },
      {
        title: "Pick a project and place your stake",
        body: "Make a simple parlay bet, or choose to back a single project only.",
      },
      {
        title: "Watch the cutoff and final resolution",
        body: "Staking may close up to 24h before hackathon ends. Organizers then finalize the rankings, publish outcomes and open claims.",
      },
      {
        title: "Claim winning payouts",
        body: "If your backed projects places, claim your payout from the hackathon page or your portfolio page.",
      },
    ],
    notes: [
      "Earlier staking carries a stronger signal (up to 1.5x weight at project's initialization).",
      "Hackathons can be whitelist-gated, meaning only whitelisted wallets are allowed to stake.",
      "Payouts can vary from initial estimate at entry. For more information, read our documentation.",
      "Stake withdrawal incurs a penalty fee of 3%."
    ],
  },
];

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 16px",
        fontSize: "0.78rem",
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--c-text-4)",
      }}
    >
      {children}
    </p>
  );
}

function StepRow({ index, title, body, accentText }: { index: number; title: string; body: string; accentText: string }) {
  return (
    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          height: "34px",
          width: "34px",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "9999px",
          background: "var(--card-bg-alt)",
          color: accentText,
          fontSize: "0.9rem",
          fontWeight: 800,
        }}
      >
        {index}
      </div>
      <div>
        <p style={{ margin: "2px 0 6px", fontSize: "0.98rem", fontWeight: 700, color: "var(--c-text)" }}>{title}</p>
        <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.7, color: "var(--c-text-3)" }}>{body}</p>
      </div>
    </div>
  );
}

function NoteRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
      <span
        style={{
          marginTop: "9px",
          height: "6px",
          width: "6px",
          flexShrink: 0,
          borderRadius: "9999px",
          background: "var(--c-indigo)",
        }}
      />
      <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.7, color: "var(--c-text-3)" }}>{children}</p>
    </div>
  );
}

export default function HowToUsePage() {
  const [activeRole, setActiveRole] = useState<Role>("staker");
  const activeGuide = ROLE_GUIDES.find((guide) => guide.id === activeRole)!;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "960px", padding: "48px 16px 88px" }}>
        <header style={{ marginBottom: "34px" }}>
          <h1
            style={{
              margin: "0 0 18px",
              fontSize: "clamp(2.1rem, 5vw, 3rem)",
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "-0.04em",
              color: "var(--c-text)",
            }}
          >
            How to use HackBet
          </h1>
          <div style={{ maxWidth: "760px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.75, color: "var(--c-text-3)" }}>
              HackBet is a conviction market for hackathons. Builders submit projects, organizers approve and resolve events, and stakers use USDC to signal which builds they believe deserve to win.
            </p>
            <p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.75, color: "var(--c-text-3)" }}>
              The guide below is split by role so the public flow stays simple: builders bring projects into the market, and stakers back the projects they believe in before judging.
            </p>
          </div>
        </header>

        <section className="ui-card" style={{ marginBottom: "28px", padding: "28px" }}>
          <SectionEyebrow>The ecosystem</SectionEyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "18px" }}>
            {ROLE_GUIDES.map((guide) => {
              const isActive = guide.id === activeRole;
              return (
                <button
                  key={guide.id}
                  onClick={() => setActiveRole(guide.id)}
                  style={{
                    borderRadius: "24px",
                    border: `2px solid ${isActive ? guide.accentText : guide.accentBorder}`,
                    background: guide.accentBg,
                    padding: "22px 22px 20px",
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    outline: "none",
                    boxShadow: isActive ? `0 0 0 3px ${guide.accentBorder}` : "none",
                    transition: "box-shadow 0.15s, border-color 0.15s",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: "1.15rem",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "-0.03em",
                      color: guide.accentText,
                    }}
                  >
                    {guide.label}s
                  </p>
                  <p style={{ margin: 0, fontSize: "0.95rem", lineHeight: 1.7, color: "var(--c-text-2)" }}>
                    {guide.ecosystemBody}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="ui-card" style={{ padding: "28px" }}>
          <SectionEyebrow>Guide</SectionEyebrow>

          <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
            <div
              style={{
                borderRadius: "24px",
                border: `1px solid ${activeGuide.accentBorder}`,
                background: activeGuide.accentBg,
                padding: "22px 22px 20px",
              }}
            >
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: "0.82rem",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: activeGuide.accentText,
                }}
              >
                Your role
              </p>
              <p style={{ margin: "0 0 16px", fontSize: "0.98rem", lineHeight: 1.75, color: "var(--c-text-2)" }}>
                {activeGuide.roleBody}
              </p>
              <Link
                href={activeGuide.ctaHref}
                className="ui-btn ui-btn-indigo"
                style={{ width: "fit-content", fontWeight: 800 }}
              >
                {activeGuide.ctaLabel}
              </Link>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
              {activeGuide.steps.map((step, index) => (
                <StepRow
                  key={step.title}
                  index={index + 1}
                  title={step.title}
                  body={step.body}
                  accentText={activeGuide.accentText}
                />
              ))}
            </div>

            <div style={{ borderTop: "1px solid var(--c-divider)", paddingTop: "22px" }}>
              <SectionEyebrow>IMPORTANT</SectionEyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {activeGuide.notes.map((note) => (
                  <NoteRow key={note}>{note}</NoteRow>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
