"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";
import { stakePda } from "@/lib/pda";
import { fetchUserStakeAccount, type UserStakeInfo } from "@/lib/userStakeAccounts";

export type { UserStakeInfo } from "@/lib/userStakeAccounts";

export function useUserStake(
  userPubkey: PublicKey | null,
  projectPubkey: PublicKey | null,
  refreshKey?: number,
) {
  const [stake, setStake] = useState<UserStakeInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userPubkey || !projectPubkey) { setStake(null); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const program = getReadonlyProgram();
        const pda = stakePda(userPubkey!, projectPubkey!);
        const acc = await fetchUserStakeAccount(program, pda);
        if (!cancelled) {
          setStake(acc);
        }
      } catch {
        if (!cancelled) setStake(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userPubkey?.toBase58(), projectPubkey?.toBase58(), refreshKey]);

  return { stake, loading };
}
