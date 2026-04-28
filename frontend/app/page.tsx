"use client";

import { useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import WhitelistRequestModal from "@/components/WhitelistRequestModal";
import { useHackathons } from "@/hooks/useHackathons";
import { useHackathonMeta } from "@/hooks/useHackathonMeta";
import { formatTokens, timeUntil, hackathonStatus } from "@/lib/format";

const STATUS_LABELS = {
  open: "Open",
  cutoff: "Cutoff passed",
  pending: "Judging",
  resolved: "Resolved",
};

export default function HomePage() {
  const { hackathons, loading, error } = useHackathons();
  const hackathonMeta = useHackathonMeta(hackathons.map((h) => h.pubkey.toBase58()));
  const [wlModalOpen, setWlModalOpen] = useState(false);
  const openHackathons = hackathons.filter(
    (hackathon) =>
      hackathonStatus(
        hackathon.resultsTimestamp,
        hackathon.cutoffTimestamp,
        hackathon.isResolved,
      ) === "open",
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <div className="ambient-glow">
        <div style={{ position: "absolute", top: "-160px", right: "25%", height: "700px", width: "700px", borderRadius: "9999px", background: "rgba(79,70,229,0.2)", filter: "blur(140px)" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, height: "500px", width: "500px", borderRadius: "9999px", background: "rgba(109,28,217,0.15)", filter: "blur(120px)" }} />
      </div>

      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "1280px", padding: "48px 16px" }}>
        {/* Hero */}
        <div style={{ marginBottom: "64px", paddingTop: "32px", textAlign: "center" }}>
          <div style={{ marginBottom: "16px", display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: "9999px", border: "1px solid var(--c-indigo-border)", background: "var(--c-indigo-light)", padding: "6px 16px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--c-indigo-text)" }}>
            On-Chain · Real Stakes
          </div>
          <h1 style={{ marginTop: "16px", fontSize: "clamp(60px, 9vw, 96px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.025em", lineHeight: 1 }}>
            <span style={{ color: "var(--c-text)" }}>HACK</span>
            <span style={{ color: "var(--c-indigo-text)" }}>BET</span>
          </h1>
          <p style={{ margin: "20px auto 0", maxWidth: "32rem", fontSize: "1.125rem", fontWeight: 500, color: "var(--c-text-2)" }}>
            Back the builders you believe in.
          </p>
          <p style={{ margin: "8px auto 0", maxWidth: "42rem", fontSize: "1rem", color: "var(--c-text-3)" }}>
            Stake on builders with USDC. Signal your conviction with your wallet.
            Put your money where your mouth is and earn when your picks place.
          </p>
          {openHackathons.length > 0 && (
            <div style={{ marginTop: "24px", display: "flex", justifyContent: "center" }}>
              <button
                onClick={() => setWlModalOpen(true)}
                className="ui-btn ui-btn-indigo"
                style={{ minWidth: "220px" }}
              >
                Request staking access
              </button>
            </div>
          )}
        </div>

        {/* How it works */}
        <div style={{ marginBottom: "40px" }}>
          <h2 style={{ marginBottom: "24px", textAlign: "center", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--c-text-4)" }}>
            How it works
          </h2>
          <div className="grid-auto-3" style={{ gap: "16px" }}>
            {[
              {
                n: "01",
                title: "Builders submit projects",
                body: "Builders submit their project for organizer review first. Once approved, the organizer registers it on-chain, after which builders can pay an optional commitment deposit if the hackathon requires one, mark the project submitted, and later reclaim that deposit after the organizer approves the submission.",
              },
              {
                n: "02",
                title: "Community backs builders",
                body: "Builders, and whitelisted wallets, can stake on participants with USDC before the cutoff. See what the crowd favorites are and signal your conviction with your money.",
              },
              {
                n: "03",
                title: "Judges rank, backers earn",
                body: "When results are announced, backers of winning projects earn a share of the prize pool. The higher your pick places, the more you earn.",
              },
            ].map(({ n, title, body }) => (
              <div key={n} className="ui-card" style={{ padding: "24px" }}>
                <div style={{ marginBottom: "12px", fontFamily: "monospace", fontSize: "1.5rem", fontWeight: 900, color: "var(--c-indigo-text)" }}>
                  {n}
                </div>
                <h3 style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--c-text)" }}>{title}</h3>
                <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: "1.6", color: "var(--c-text-3)" }}>{body}</p>
              </div>
            ))}
          </div>
          <p style={{ marginTop: "24px", textAlign: "center", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
            Prize tiers split the pool by rank — e.g. 1st place tier gets 50% of the total pool, split amongst all backers, 2nd place tier gets 30%, 3rd gets 10% and so on. Project onboarding, deposits, and staking close 24h before the hackathon&apos;s results date.
          </p>
        </div>

        {/* Stats strip */}
        <div className="ui-card" style={{ marginBottom: "40px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", padding: "16px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>{hackathons.length}</div>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Hackathons</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>{hackathons.filter((h) => !h.isResolved).length}</div>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Active</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--c-indigo-text)" }}>
              {formatTokens(hackathons.reduce((sum, h) => sum + h.totalPool, 0n))}
            </div>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>USDC staked</div>
          </div>
        </div>

        {/* Hackathon cards */}
        {loading ? (
          <div className="grid-auto-3" style={{ gap: "16px" }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="ui-skeleton" style={{ height: "176px" }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ borderRadius: "16px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "24px", textAlign: "center", color: "var(--c-red-text)" }}>
            {error}
          </div>
        ) : hackathons.length === 0 ? (
          <div style={{ borderRadius: "16px", border: "1px dashed var(--c-divider)", background: "var(--card-bg)", padding: "48px", textAlign: "center", color: "var(--c-text-4)" }}>
            No hackathons found yet.
          </div>
        ) : (
          <div className="grid-auto-3" style={{ gap: "20px" }}>
            {hackathons.map((h) => {
              const status = hackathonStatus(h.resultsTimestamp, h.cutoffTimestamp, h.isResolved);
              const id = h.pubkey.toBase58();
              return (
                <div key={id} className="ui-card" style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "24px" }}>
                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
                    <div style={{ display: "flex", height: "40px", width: "40px", flexShrink: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: "12px", background: "var(--c-indigo-light)", border: "1px solid var(--c-indigo-border)", fontSize: "1.125rem", fontWeight: 900, color: "var(--c-indigo-text)" }}>
                      {hackathonMeta[id]?.icon_url ? (
                        <img src={hackathonMeta[id].icon_url!} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} />
                      ) : "H"}
                    </div>
                    <span className={`ui-badge ui-badge-${status}`}>{STATUS_LABELS[status]}</span>
                  </div>

                  {/* Name / address */}
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, color: "var(--c-text)" }}>
                      {h.name || <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{id.slice(0, 8)}…{id.slice(-6)}</span>}
                    </p>
                    {h.name && (
                      <p style={{ margin: 0, fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-text-5)" }}>
                        {id.slice(0, 8)}…{id.slice(-6)}
                      </p>
                    )}
                  </div>

                  {/* Pool */}
                  <div>
                    <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Total pool</p>
                    <p style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "var(--c-text)" }}>
                      {formatTokens(h.totalPool)}{" "}
                      <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
                    </p>
                  </div>

                  {/* Bottom row */}
                  <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid var(--c-divider-2)", paddingTop: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                        {status === "open" && <>Closes in <span style={{ fontWeight: 600, color: "var(--c-text-3)" }}>{timeUntil(h.cutoffTimestamp)}</span></>}
                        {status === "cutoff" && <>Results in <span style={{ fontWeight: 600, color: "var(--c-text-3)" }}>{timeUntil(h.resultsTimestamp)}</span></>}
                        {status === "pending" && <span>Awaiting resolution</span>}
                        {status === "resolved" && <span>Resolved</span>}
                      </span>
                      <Link
                        href={`/hackathon/${id}`}
                        className="ui-btn ui-btn-indigo ui-btn-sm"
                        style={{ fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}
                      >
                        View Hackathon
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <WhitelistRequestModal
        hackathonOptions={openHackathons.map((hackathon) => ({
          pubkey: hackathon.pubkey.toBase58(),
          name: hackathon.name || `${hackathon.pubkey.toBase58().slice(0, 8)}…`,
        }))}
        isOpen={wlModalOpen}
        onClose={() => setWlModalOpen(false)}
      />
    </div>
  );
}
