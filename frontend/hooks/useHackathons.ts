"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";
import { PROGRAM_ID } from "@/lib/constants";

export interface HackathonInfo {
  pubkey: PublicKey;
  admin: PublicKey;
  usdcMint: PublicKey;
  feeRecipient: PublicKey;
  name: string;
  resultsTimestamp: number;
  cutoffTimestamp: number;
  startTimestamp: number;
  totalPool: bigint;
  depositAmount: bigint;
  isResolved: boolean;
  requiresApproval: boolean;
  openStaking: boolean;
  tierCount: number;
  tierPcts: number[];
  effectiveTierPcts: number[];
}

export function useHackathons() {
  const [hackathons, setHackathons] = useState<HackathonInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const program = getReadonlyProgram();
        const connection = (program.provider as any).connection;

        // Fetch raw accounts and decode individually so stale pre-upgrade
        // accounts (wrong struct layout) are silently skipped instead of
        // crashing the whole request.
        const rawAccounts = await connection.getProgramAccounts(PROGRAM_ID);

        if (cancelled) return;

        const list: HackathonInfo[] = rawAccounts.flatMap((item: any) => {
          try {
            const d = (program.coder.accounts as any).decode(
              "hackathonState",
              item.account.data,
            );
            // Guard: new struct fields must be present
            if (d == null || d.tierCount == null || d.tierPcts == null) return [];
            return [{
              pubkey: item.pubkey as PublicKey,
              admin: d.admin as PublicKey,
              usdcMint: d.usdcMint as PublicKey,
              feeRecipient: d.feeRecipient as PublicKey,
              name: (d.name as string) ?? "",
              resultsTimestamp: Number(d.resultsTimestamp),
              cutoffTimestamp: Number(d.cutoffTimestamp),
              startTimestamp: Number(d.startTimestamp),
              totalPool: BigInt((d.totalPool ?? 0).toString()),
              depositAmount: BigInt((d.depositAmount ?? 0).toString()),
              isResolved: d.isResolved as boolean,
              requiresApproval: (d.requiresApproval as boolean) ?? false,
              openStaking: (d.openStaking as boolean) ?? true,
              tierCount: d.tierCount as number,
              tierPcts: Array.from(d.tierPcts as number[]).slice(0, d.tierCount),
              effectiveTierPcts: Array.from(
                d.effectiveTierPcts as number[],
              ).slice(0, d.tierCount),
            }];
          } catch {
            return []; // skip accounts that fail to decode (old struct / other types)
          }
        });

        // Sort: unresolved first, then by results_timestamp asc
        list.sort((a, b) => {
          if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
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
  }, [tick]);

  return { hackathons, loading, error, reload: () => setTick((t) => t + 1) };
}
