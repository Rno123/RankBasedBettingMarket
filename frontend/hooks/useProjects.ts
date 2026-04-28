"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";

export interface ProjectInfo {
  pubkey: PublicKey;
  hackathon: PublicKey;
  githubUrl: string;
  totalStaked: bigint;
  totalShares: bigint;
  rank: number;
  builderWallet: PublicKey;
  depositAmountPaid: bigint;
  builderStaked: bigint;
  builderDeclared: boolean;
  submitted: boolean;
  isRefundEnabled: boolean;
  depositForfeited: boolean;
  depositRefunded: boolean;
}

export function useProjects(hackathonPubkey: PublicKey | null) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!hackathonPubkey) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const program = getReadonlyProgram();
        const accounts = await (program.account as any).projectAccount.all([
          {
            memcmp: {
              offset: 8, // after discriminator
              bytes: hackathonPubkey!.toBase58(),
            },
          },
        ]);
        if (cancelled) return;

        const list: ProjectInfo[] = accounts.map((a: any) => {
          const d = a.account;
          return {
            pubkey: a.publicKey as PublicKey,
            hackathon: d.hackathon as PublicKey,
            githubUrl: d.githubUrl as string,
            totalStaked: BigInt((d.totalStaked ?? 0).toString()),
            totalShares: BigInt((d.totalShares ?? 0).toString()),
            rank: d.rank as number,
            builderWallet: d.builderWallet as PublicKey,
            depositAmountPaid: BigInt((d.depositAmountPaid ?? 0).toString()),
            builderStaked: BigInt((d.builderStaked ?? 0).toString()),
            builderDeclared: (d.builderDeclared as boolean) ?? false,
            submitted: d.submitted as boolean,
            isRefundEnabled: d.isRefundEnabled as boolean,
            depositForfeited: d.depositForfeited as boolean,
            depositRefunded: d.depositRefunded as boolean,
          };
        });

        // Sort: ranked first (ascending), unranked at end
        list.sort((a, b) => {
          if (a.rank === 0 && b.rank === 0) return 0;
          if (a.rank === 0) return 1;
          if (b.rank === 0) return -1;
          return a.rank - b.rank;
        });

        setProjects(list);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [hackathonPubkey?.toBase58(), tick]);

  return { projects, loading, error, reload: () => setTick((t) => t + 1) };
}
