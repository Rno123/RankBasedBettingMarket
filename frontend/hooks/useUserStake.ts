"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";
import { stakePda } from "@/lib/pda";

export interface UserStakeInfo {
  pubkey: PublicKey;
  user: PublicKey;
  project: PublicKey;
  amount: bigint;
  stakeTimestamp: number;
  isClaimed: boolean;
}

export function useUserStake(
  userPubkey: PublicKey | null,
  projectPubkey: PublicKey | null,
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
        const acc = await (program.account as any).userStake.fetchNullable(pda);
        if (!cancelled) {
          if (acc) {
            setStake({
              pubkey: pda,
              user: acc.user,
              project: acc.project,
              amount: BigInt(acc.amount.toString()),
              stakeTimestamp: Number(acc.stakeTimestamp),
              isClaimed: acc.isClaimed,
            });
          } else {
            setStake(null);
          }
        }
      } catch {
        if (!cancelled) setStake(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userPubkey?.toBase58(), projectPubkey?.toBase58()]);

  return { stake, loading };
}
