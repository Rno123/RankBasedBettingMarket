"use client";

import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useHackathons } from "@/hooks/useHackathons";
import { formatTokens, timeUntil, hackathonStatus } from "@/lib/format";
import { TOKEN_DECIMALS } from "@/lib/constants";

const STATUS_STYLES = {
  open: "bg-emerald-100 text-emerald-700",
  cutoff: "bg-amber-100 text-amber-700",
  pending: "bg-sky-100 text-sky-700",
  resolved: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS = {
  open: "Open",
  cutoff: "Cutoff passed",
  pending: "Judging",
  resolved: "Resolved",
};

export default function HomePage() {
  const { hackathons, loading, error } = useHackathons();

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        {/* Hero */}
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Prove your conviction. Discover serious builders.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-500">
            Builders back each other with real USDC. The crowd signal is
            credible because it can&apos;t be edited — immutability is the product.
            Earn rewards when your picks place.
          </p>
        </div>

        {/* Stats strip */}
        <div className="mb-10 grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:gap-4 sm:p-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-indigo-600">
              {hackathons.length}
            </div>
            <div className="mt-1 text-sm text-slate-500">Hackathons</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-indigo-600">
              {hackathons.filter((h) => !h.isResolved).length}
            </div>
            <div className="mt-1 text-sm text-slate-500">Active</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-indigo-600">
              {hackathons
                .reduce((sum, h) => sum + h.totalPool, 0n)
                .toString()
                .slice(0, -TOKEN_DECIMALS) || "0"}
            </div>
            <div className="mt-1 text-sm text-slate-500">USDC staked</div>
          </div>
        </div>

        {/* Hackathon cards */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-2xl bg-slate-200"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-600">
            {error}
          </div>
        ) : hackathons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
            No hackathons found on devnet yet.
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
                <Link
                  key={id}
                  href={`/hackathon/${id}`}
                  className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md hover:border-indigo-300"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-lg font-bold text-indigo-600">
                      H
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  </div>

                  {/* Name / address */}
                  <div>
                    <p className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {h.name || <span className="font-mono text-slate-400 text-xs">{id.slice(0, 8)}…{id.slice(-6)}</span>}
                    </p>
                    {h.name && (
                      <p className="text-xs font-mono text-slate-400">
                        {id.slice(0, 8)}…{id.slice(-6)}
                      </p>
                    )}
                  </div>

                  {/* Pool & tiers */}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-400">
                        Total pool
                      </p>
                      <p className="text-xl font-bold text-slate-900">
                        {formatTokens(h.totalPool)} USDC
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wider text-slate-400">
                        {h.tierCount} tiers
                      </p>
                      <p className="text-sm font-medium text-slate-600">
                        {h.tierPcts.join(" / ")}%
                      </p>
                    </div>
                  </div>

                  {/* Time */}
                  {!h.isResolved && (
                    <div className="mt-auto border-t border-slate-100 pt-3 text-xs text-slate-400">
                      {status === "open" && (
                        <>Staking closes in {timeUntil(h.cutoffTimestamp)}</>
                      )}
                      {status === "cutoff" && (
                        <>Results in {timeUntil(h.resultsTimestamp)}</>
                      )}
                      {status === "pending" && <>Awaiting resolution</>}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
