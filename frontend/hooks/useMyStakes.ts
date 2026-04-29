"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";
import type { UserStakeInfo } from "@/hooks/useUserStake";
import type { ProjectInfo } from "@/hooks/useProjects";

export interface MyStakeEntry {
  stake: UserStakeInfo;
  project: ProjectInfo | null;
}

export function useMyStakes(walletPubkey: PublicKey | null, refreshKey?: number) {
  const [entries, setEntries] = useState<MyStakeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!walletPubkey) { setEntries([]); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const program = getReadonlyProgram();

        // All UserStake PDAs where user === walletPubkey
        const stakeAccounts = await (program.account as any).userStake.all([
          { memcmp: { offset: 8, bytes: walletPubkey!.toBase58() } },
        ]);
        if (cancelled) return;

        const stakes: UserStakeInfo[] = stakeAccounts.map((a: any) => ({
          pubkey: a.publicKey as PublicKey,
          user: a.account.user as PublicKey,
          project: a.account.project as PublicKey,
          amount: BigInt((a.account.amount ?? 0).toString()),
          shares: BigInt((a.account.shares ?? 0).toString()),
          stakeTimestamp: Number(a.account.stakeTimestamp),
          isClaimed: a.account.isClaimed as boolean,
        }));

        // Include zero-amount stakes only if claimed (so history is visible)
        const relevant = stakes.filter(s => s.amount > 0n || s.isClaimed);

        // Batch fetch project accounts in parallel
        const uniqueProjectKeys = [
          ...new Map(relevant.map(s => [s.project.toBase58(), s.project])).values(),
        ];

        const projectResults = await Promise.all(
          uniqueProjectKeys.map(async (pk) => {
            try {
              const acc = await (program.account as any).projectAccount.fetchNullable(pk);
              if (!acc) return null;
              return {
                pubkey: pk,
                hackathon: acc.hackathon as PublicKey,
                githubUrl: acc.githubUrl as string,
                totalStaked: BigInt((acc.totalStaked ?? 0).toString()),
                totalShares: BigInt((acc.totalShares ?? 0).toString()),
                rank: acc.rank as number,
                builderWallet: acc.builderWallet as PublicKey,
                depositAmountPaid: BigInt((acc.depositAmountPaid ?? 0).toString()),
                builderStaked: BigInt((acc.builderStaked ?? 0).toString()),
                builderDeclared: (acc.builderDeclared as boolean) ?? false,
                submitted: acc.submitted as boolean,
                isRefundEnabled: acc.isRefundEnabled as boolean,
                depositForfeited: acc.depositForfeited as boolean,
                depositRefunded: acc.depositRefunded as boolean,
              } as ProjectInfo;
            } catch {
              return null;
            }
          }),
        );

        const projectMap = new Map<string, ProjectInfo | null>(
          uniqueProjectKeys.map((pk, i) => [pk.toBase58(), projectResults[i]]),
        );

        if (cancelled) return;

        const result: MyStakeEntry[] = relevant.map(stake => ({
          stake,
          project: projectMap.get(stake.project.toBase58()) ?? null,
        }));

        // Active (unclaimed) first, then by stake timestamp descending
        result.sort((a, b) => {
          if (a.stake.isClaimed !== b.stake.isClaimed) return a.stake.isClaimed ? 1 : -1;
          return b.stake.stakeTimestamp - a.stake.stakeTimestamp;
        });

        setEntries(result);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [walletPubkey?.toBase58(), refreshKey]);

  return { entries, loading, reload: (k: number) => k }; // refreshKey passed from outside
}
