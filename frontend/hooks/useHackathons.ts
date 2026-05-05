"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

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

function deserialize(raw: any): HackathonInfo {
  return {
    pubkey: new PublicKey(raw.pubkey),
    admin: new PublicKey(raw.admin),
    usdcMint: new PublicKey(raw.usdcMint),
    feeRecipient: new PublicKey(raw.feeRecipient),
    name: raw.name,
    irlHackathonDeadlineTimestamp: raw.irlHackathonDeadlineTimestamp,
    cutoffTimestamp: raw.cutoffTimestamp,
    startTimestamp: raw.startTimestamp,
    totalPool: BigInt(raw.totalPool),
    depositAmount: BigInt(raw.depositAmount),
    isResolved: raw.isResolved,
    requiresApproval: raw.requiresApproval,
    openStaking: raw.openStaking,
    protocolFeeBps: raw.protocolFeeBps,
    tierCount: raw.tierCount,
    tierPcts: raw.tierPcts,
    tierExpectedCounts: raw.tierExpectedCounts,
    effectiveTierPcts: raw.effectiveTierPcts,
  };
}

export function useHackathons() {
  const [hackathons, setHackathons] = useState<HackathonInfo[]>([]);
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/hackathons");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { hackathons: raw, projectCounts: counts } = await res.json();
        if (cancelled) return;
        setHackathons(raw.map(deserialize));
        setProjectCounts(counts ?? {});
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load hackathons");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tick]);

  return { hackathons, projectCounts, loading, error, reload: () => setTick((t) => t + 1) };
}
