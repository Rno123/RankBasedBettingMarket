"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

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

function deserialize(raw: any): ProjectInfo {
  return {
    pubkey: new PublicKey(raw.pubkey),
    hackathon: new PublicKey(raw.hackathon),
    githubUrl: raw.githubUrl,
    totalStaked: BigInt(raw.totalStaked),
    totalShares: BigInt(raw.totalShares),
    rank: raw.rank,
    builderWallet: new PublicKey(raw.builderWallet),
    depositAmountPaid: BigInt(raw.depositAmountPaid),
    builderStaked: BigInt(raw.builderStaked),
    builderDeclared: raw.builderDeclared,
    submitted: raw.submitted,
    isRefundEnabled: raw.isRefundEnabled,
    depositForfeited: raw.depositForfeited,
    depositRefunded: raw.depositRefunded,
  };
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
        const res = await fetch(`/api/projects/${hackathonPubkey!.toBase58()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        if (cancelled) return;
        setProjects(raw.map(deserialize));
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
