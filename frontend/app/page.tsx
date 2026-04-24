"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useHackathons } from "@/hooks/useHackathons";
import { useHackathonMeta } from "@/hooks/useHackathonMeta";
import { formatTokens, timeUntil, hackathonStatus } from "@/lib/format";

const TIER_ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

function tierLabel(pcts: number[]): string {
  return pcts.map((pct, i) => `${TIER_ORDINALS[i] ?? `#${i + 1}`} ${pct}%`).join(" · ");
}

const STATUS_STYLES = {
  open: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-1 dark:ring-emerald-500/20",
  cutoff: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-1 dark:ring-amber-500/20",
  pending: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-1 dark:ring-sky-500/20",
  resolved: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-1 dark:ring-slate-500/20",
};

const STATUS_LABELS = {
  open: "Open",
  cutoff: "Cutoff passed",
  pending: "Judging",
  resolved: "Resolved",
};

export default function HomePage() {
  const { hackathons, loading, error } = useHackathons();
  const hackathonMeta = useHackathonMeta(hackathons.map((h) => h.pubkey.toBase58()));

  return (
    <div className="min-h-screen">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        {/* Hero */}
        <div className="mb-16 pt-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400">
            On-Chain · Real Stakes
          </div>
          <h1 className="mt-4 text-6xl font-black uppercase tracking-tight sm:text-8xl">
            <span className="text-slate-900 dark:text-white">HACK</span><span className="text-indigo-600 dark:text-indigo-400">BET</span>
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-lg font-medium text-slate-700 dark:text-slate-300">
            Back the builders you believe in.
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-base text-slate-500">
            Stake on builders with USDC. Signal your conviction with your wallet.
            Put your money where your mouth is and earn when your picks place.
          </p>
        </div>

        {/* How it works */}
        <div className="mb-10">
          <h2 className="mb-6 text-center text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">How it works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                n: "01",
                title: "Builders submit projects",
                body: "Builders register their hackathon project on-chain and are asked to put down an optional 10 USDC deposit. The deposit is fully refunded if they follow through and submit their project.",
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
              <div
                key={n}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none dark:backdrop-blur-sm"
              >
                <div className="mb-3 font-mono text-2xl font-black text-indigo-600 dark:text-indigo-500/60">
                  {n}
                </div>
                <h3 className="mb-2 font-bold text-slate-900 dark:text-white">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-500">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Prize tiers split the pool by rank — e.g. 1st place tier gets 50% of the total pool, split amongst all backers, 2nd place tier gets 30%, 3rd gets 10% and so on. Registering and staking closes 24h before the hackathon&apos;s submission deadline.
          </p>
        </div>

        {/* Stats strip */}
        <div className="mb-10 grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:gap-4 sm:p-6 dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none">
          <div className="text-center">
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              {hackathons.length}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Hackathons</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              {hackathons.filter((h) => !h.isResolved).length}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Active</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
              {formatTokens(hackathons.reduce((sum, h) => sum + h.totalPool, 0n))}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">USDC staked</div>
          </div>
        </div>

        {/* Hackathon cards */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-2xl bg-slate-200 dark:border dark:border-white/[0.05] dark:bg-white/[0.03]"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        ) : hackathons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400 dark:border-white/[0.08] dark:bg-transparent dark:text-slate-500">
            No hackathons found yet.
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {hackathons.map((h) => {
              const status = hackathonStatus(
                h.resultsTimestamp,
                h.cutoffTimestamp,
                h.isResolved,
              );
              const id = h.pubkey.toBase58();
              return (
                <div
                  key={id}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-indigo-100 text-lg font-black text-indigo-600 dark:border dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400">
                      {hackathonMeta[id]?.icon_url ? (
                        <img src={hackathonMeta[id].icon_url!} alt="" className="h-full w-full object-cover" />
                      ) : "H"}
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
                      {STATUS_LABELS[status]}
                    </span>
                  </div>

                  {/* Name / address */}
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">
                      {h.name || <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{id.slice(0, 8)}…{id.slice(-6)}</span>}
                    </p>
                    {h.name && (
                      <p className="font-mono text-xs text-slate-400 dark:text-slate-600">
                        {id.slice(0, 8)}…{id.slice(-6)}
                      </p>
                    )}
                  </div>

                  {/* Pool */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Total pool</p>
                    <p className="text-xl font-black text-slate-900 dark:text-white">
                      {formatTokens(h.totalPool)}{" "}
                      <span className="text-sm font-semibold text-slate-500">USDC</span>
                    </p>
                  </div>

                  {/* Bottom row: time + BET button */}
                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 dark:border-white/[0.05]">
                    <span className="text-xs text-slate-400 dark:text-slate-600">
                      {status === "open" && <>Closes in <span className="font-semibold text-slate-600 dark:text-slate-400">{timeUntil(h.cutoffTimestamp)}</span></>}
                      {status === "cutoff" && <>Results in <span className="font-semibold text-slate-600 dark:text-slate-400">{timeUntil(h.resultsTimestamp)}</span></>}
                      {status === "pending" && <span className="text-slate-400 dark:text-slate-600">Awaiting resolution</span>}
                      {status === "resolved" && <span className="text-slate-400 dark:text-slate-600">Resolved</span>}
                    </span>
                    <Link
                      href={`/hackathon/${id}`}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white transition hover:bg-indigo-700 dark:hover:bg-indigo-500"
                    >
                      View Hackathon
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
