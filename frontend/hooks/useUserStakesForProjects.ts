"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/program";
import { stakePda } from "@/lib/pda";
import { decodeUserStakeAccount, type UserStakeInfo } from "@/lib/userStakeAccounts";
import type { ProjectInfo } from "@/hooks/useProjects";

export function useUserStakesForProjects(
  userPubkey: PublicKey | null,
  projects: ProjectInfo[],
  refreshKey?: number,
) {
  const [stakesByProject, setStakesByProject] = useState<Record<string, UserStakeInfo | null>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userPubkey || projects.length === 0) {
      setStakesByProject({});
      return;
    }

    let cancelled = false;
    const currentUser = userPubkey;

    async function load() {
      setLoading(true);
      try {
        const connection = getConnection();
        const pdas = projects.map((p) => stakePda(currentUser, p.pubkey));
        const accountInfos = await connection.getMultipleAccountsInfo(pdas, "confirmed");

        if (cancelled) return;

        const entries = projects.map((project, i) => {
          const info = accountInfos[i];
          const account = info ? decodeUserStakeAccount(pdas[i], info.data) : null;
          return [project.pubkey.toBase58(), account] as const;
        });

        setStakesByProject(Object.fromEntries(entries));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [userPubkey?.toBase58(), projects.map((project) => project.pubkey.toBase58()).join(","), refreshKey]);

  return { stakesByProject, loading };
}
