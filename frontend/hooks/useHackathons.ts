"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";

export interface HackathonInfo {
  pubkey: PublicKey;
  admin: PublicKey;
  usdcMint: PublicKey;
  resultsTimestamp: number;
  cutoffTimestamp: number;
  totalPool: bigint;
  isResolved: boolean;
  tierCount: number;
  tierPcts: number[];
  effectiveTierPcts: number[];
}

export function useHackathons() {
  const [hackathons, setHackathons] = useState<HackathonInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const program = getReadonlyProgram();
        const accounts = await (program.account as any).hackathonState.all();
        if (cancelled) return;

        const list: HackathonInfo[] = accounts.map((a: any) => {
          const d = a.account;
          return {
            pubkey: a.publicKey as PublicKey,
            admin: d.admin as PublicKey,
            usdcMint: d.usdcMint as PublicKey,
            resultsTimestamp: Number(d.resultsTimestamp),
            cutoffTimestamp: Number(d.cutoffTimestamp),
            totalPool: BigInt(d.totalPool.toString()),
            isResolved: d.isResolved as boolean,
            tierCount: d.tierCount as number,
            tierPcts: Array.from(d.tierPcts as number[]).slice(0, d.tierCount),
            effectiveTierPcts: Array.from(
              d.effectiveTierPcts as number[],
            ).slice(0, d.tierCount),
          };
        });

        // Sort: unresolved first, then by results_timestamp asc
        list.sort((a, b) => {
          if (a.isResolved !== b.isResolved)
            return a.isResolved ? 1 : -1;
          return a.resultsTimestamp - b.resultsTimestamp;
        });

        setHackathons(list);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load hackathons");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { hackathons, loading, error };
}
