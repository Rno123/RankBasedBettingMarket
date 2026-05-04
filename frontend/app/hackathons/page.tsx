"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useHackathons } from "@/hooks/useHackathons";
import { useHackathonMeta } from "@/hooks/useHackathonMeta";
import { useProjectCounts } from "@/hooks/useProjectCounts";
import { formatTokens, timeUntil, hackathonStatus } from "@/lib/format";
import type { HackathonInfo } from "@/hooks/useHackathons";

type TabKey = "ongoing" | "cutoff" | "resolved";

const TABS: Array<{
  key: TabKey;
  label: string;
  matches: (status: ReturnType<typeof hackathonStatus>) => boolean;
  tone: { background: string; border: string; text: string };
}> = [
  {
    key: "ongoing",
    label: "Ongoing",
    matches: (status) => status === "open",
    tone: {
      background: "rgba(79,70,229,0.08)",
      border: "rgba(79,70,229,0.18)",
      text: "var(--c-indigo-text)",
    },
  },
  {
    key: "cutoff",
    label: "Cutoff",
    matches: (status) => status === "cutoff" || status === "pending",
    tone: {
      background: "rgba(79,70,229,0.14)",
      border: "rgba(79,70,229,0.26)",
      text: "var(--c-indigo-text)",
    },
  },
  {
    key: "resolved",
    label: "Resolved",
    matches: (status) => status === "resolved",
    tone: {
      background: "rgba(79,70,229,0.2)",
      border: "rgba(79,70,229,0.34)",
      text: "var(--c-indigo-text)",
    },
  },
];

function HackathonRow({
  hackathon,
  iconUrl,
  projectCount,
  status,
  tone,
}: {
  hackathon: HackathonInfo;
  iconUrl?: string | null;
  projectCount: number;
  status: ReturnType<typeof hackathonStatus>;
  tone: { background: string; border: string; text: string };
}) {
  const id = hackathon.pubkey.toBase58();

  return (
    <div
      className="ui-card"
      style={{
        borderColor: tone.border,
        background: tone.background,
        padding: "clamp(18px, 4vw, 22px)",
      }}
    >
      <div className="mobile-stack-between" style={{ gap: "16px" }}>
        <div style={{ display: "flex", minWidth: 0, gap: "14px" }}>
          <div style={{ display: "flex", height: "44px", width: "44px", flexShrink: 0, alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: "12px", border: `1px solid ${tone.border}`, background: "rgba(255,255,255,0.45)", fontSize: "1.125rem", fontWeight: 900, color: tone.text }}>
            {iconUrl ? (
              <img src={iconUrl} alt="" style={{ height: "100%", width: "100%", objectFit: "cover" }} />
            ) : "H"}
          </div>

          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "var(--c-text)" }}>
              {hackathon.name || "Hackathon"}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
              {status === "open" && <>Closes in <span style={{ fontWeight: 600, color: "var(--c-text-2)" }}>{timeUntil(hackathon.cutoffTimestamp)}</span></>}
              {status === "cutoff" && <>Results in <span style={{ fontWeight: 600, color: "var(--c-text-2)" }}>{timeUntil(hackathon.resultsTimestamp)}</span></>}
              {status === "pending" && <span>Awaiting resolution</span>}
              {status === "resolved" && <span>Resolved</span>}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: "0" }}>
          <div style={{ width: "150px", textAlign: "right", paddingRight: "20px" }}>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Total pool</p>
            <p style={{ margin: "3px 0 0", fontSize: "1.125rem", fontWeight: 800, color: "var(--c-text)", lineHeight: 1 }}>
              {formatTokens(hackathon.totalPool)} <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--c-text-3)" }}>USDC</span>
            </p>
          </div>
          <div style={{ width: "1px", height: "32px", background: "var(--c-divider)", flexShrink: 0 }} />
          <div style={{ width: "90px", textAlign: "right", paddingRight: "20px", paddingLeft: "20px" }}>
            <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Projects</p>
            <p style={{ margin: "3px 0 0", fontSize: "1.125rem", fontWeight: 800, color: "var(--c-text)", lineHeight: 1 }}>{projectCount}</p>
          </div>
          <div style={{ width: "1px", height: "32px", background: "var(--c-divider)", flexShrink: 0 }} />
          <div style={{ paddingLeft: "20px" }}>
            <Link href={`/hackathon/${id}`} className="ui-btn ui-btn-indigo ui-btn-sm" style={{ fontWeight: 800, width: "72px" }}>
              View
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HackathonsPage() {
  const { hackathons, loading, error } = useHackathons();
  const hackathonMeta = useHackathonMeta(hackathons.map((h) => h.pubkey.toBase58()));
  const projectCounts = useProjectCounts(hackathons.map((h) => h.pubkey.toBase58()));
  const [activeTab, setActiveTab] = useState<TabKey>("ongoing");

  const totalProjects = Object.values(projectCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  const cumulativeStaked = hackathons.reduce((sum, hackathon) => sum + hackathon.totalPool, 0n);
  const activeHackathons = hackathons.filter(
    (hackathon) => hackathonStatus(hackathon.resultsTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved) !== "resolved",
  ).length;

  const rows = useMemo(() => {
    const currentTab = TABS.find((tab) => tab.key === activeTab)!;
    return hackathons.filter((hackathon) =>
      currentTab.matches(hackathonStatus(hackathon.resultsTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved)),
    );
  }, [activeTab, hackathons]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <div className="ambient-glow">
        <div style={{ position: "absolute", top: "-160px", right: "25%", height: "700px", width: "700px", borderRadius: "9999px", background: "rgba(79,70,229,0.2)", filter: "blur(140px)" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, height: "500px", width: "500px", borderRadius: "9999px", background: "rgba(109,28,217,0.15)", filter: "blur(120px)" }} />
      </div>

      <Navbar />

      <main style={{ margin: "0 auto", maxWidth: "1280px", padding: "32px 16px 56px" }}>
        <div style={{ marginBottom: "28px", paddingTop: "12px" }}>
          <p style={{ margin: "0 0 10px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--c-indigo-text)" }}>
            Browse markets
          </p>
          <h1 style={{ margin: 0, fontSize: "clamp(2rem, 6vw, 3.25rem)", fontWeight: 900, letterSpacing: "-0.03em", color: "var(--c-text)" }}>
            Hackathons
          </h1>
        </div>

        <div className="ui-card mobile-stats-grid" style={{ marginBottom: "24px", padding: "16px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>{activeHackathons}</div>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Active hackathons</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--c-text)" }}>{totalProjects}</div>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Projects submitted</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--c-indigo-text)" }}>{formatTokens(cumulativeStaked)}</div>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-3)" }}>Cumulative USDC staked</div>
          </div>
        </div>

        <div style={{ marginBottom: "16px", display: "flex", flexWrap: "wrap", gap: "8px", borderRadius: "12px", border: "1px solid var(--card-border)", background: "var(--card-bg)", padding: "4px", width: "fit-content" }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`ui-sort-tab ${activeTab === tab.key ? "ui-sort-tab-active" : "ui-sort-tab-inactive"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="ui-skeleton" style={{ height: "112px" }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ borderRadius: "16px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "24px", textAlign: "center", color: "var(--c-red-text)" }}>
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ borderRadius: "16px", border: "1px dashed var(--c-divider)", background: "var(--card-bg)", padding: "48px", textAlign: "center", color: "var(--c-text-4)" }}>
            No hackathons in this tab yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {rows.map((hackathon) => {
              const id = hackathon.pubkey.toBase58();
              const status = hackathonStatus(hackathon.resultsTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved);
              const tone = TABS.find((tab) => tab.key === activeTab)!.tone;
              return (
                <HackathonRow
                  key={id}
                  hackathon={hackathon}
                  iconUrl={hackathonMeta[id]?.icon_url}
                  projectCount={projectCounts[id] ?? 0}
                  status={status}
                  tone={tone}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
