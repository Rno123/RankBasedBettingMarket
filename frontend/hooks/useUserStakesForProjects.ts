"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";
import { stakePda } from "@/lib/pda";
import { fetchUserStakeAccount, type UserStakeInfo } from "@/lib/userStakeAccounts";
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
        const program = getReadonlyProgram();
        const results = await Promise.all(
          projects.map(async (project) => {
            const projectKey = project.pubkey.toBase58();
            try {
              const pda = stakePda(currentUser, project.pubkey);
              const account = await fetchUserStakeAccount(program, pda);
              return [projectKey, account] as const;
            } catch {
              return [projectKey, null] as const;
            }
          }),
        );

        if (!cancelled) {
          setStakesByProject(Object.fromEntries(results));
        }
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
