"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";
import { PROGRAM_ID, HIDDEN_HACKATHONS } from "@/lib/constants";

export interface HackathonInfo {
  pubkey: PublicKey;
  admin: PublicKey;
  usdcMint: PublicKey;
  feeRecipient: PublicKey;
  name: string;
  irlHackathonDeadlineTimestamp: number;
  cutoffTimestamp: number;
  startTimestamp: number;
  totalPool: bigint;
  depositAmount: bigint;
  isResolved: boolean;
  requiresApproval: boolean;
  openStaking: boolean;
  protocolFeeBps: number;
  tierCount: number;
  tierPcts: number[];
  tierExpectedCounts: number[];
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
        // Filter to HackathonState accounts only (discriminator = sha256("account:HackathonState")[:8]).
        // Without this, getProgramAccounts returns every account type, which is slow on mobile.
        const rawAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [{ memcmp: { offset: 0, bytes: "68mXvqEofeP" } }],
        });

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
              irlHackathonDeadlineTimestamp: Number(d.irlHackathonDeadlineTimestamp),
              cutoffTimestamp: Number(d.cutoffTimestamp),
              startTimestamp: Number(d.startTimestamp),
              totalPool: BigInt((d.totalPool ?? 0).toString()),
              depositAmount: BigInt((d.depositAmount ?? 0).toString()),
              isResolved: d.isResolved as boolean,
              requiresApproval: (d.requiresApproval as boolean) ?? false,
              openStaking: (d.openStaking as boolean) ?? true,
              protocolFeeBps: (d.protocolFeeBps as number) ?? 150,
              tierCount: d.tierCount as number,
              tierPcts: Array.from(d.tierPcts as number[]).slice(0, d.tierCount),
              tierExpectedCounts: Array.from(d.tierExpectedCounts as number[]).slice(0, d.tierCount),
              effectiveTierPcts: Array.from(
                d.effectiveTierPcts as number[],
              ).slice(0, d.tierCount),
            }];
          } catch {
            return []; // skip accounts that fail to decode (old struct / other types)
          }
        });

        // Skip stale/hidden hackathon PDAs.
        const filtered = list.filter((h) => !HIDDEN_HACKATHONS.has(h.pubkey.toBase58()));

        // Sort: unresolved first, then by irlHackathonDeadlineTimestamp asc
        filtered.sort((a, b) => {
          if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
          return a.irlHackathonDeadlineTimestamp - b.irlHackathonDeadlineTimestamp;
        });

        setHackathons(filtered);
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
