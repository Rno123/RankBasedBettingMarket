"use client";

import { useEffect, useState } from "react";
import { getReadonlyProgram } from "@/lib/program";

export function useProjectCounts(hackathonPubkeys: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (hackathonPubkeys.length === 0) return;
    let cancelled = false;

    async function load() {
      try {
        const program = getReadonlyProgram();
        const accounts = await (program.account as any).projectAccount.all();
        if (cancelled) return;

        const result: Record<string, number> = {};
        for (const { account } of accounts) {
          const key: string = (account.hackathon as { toBase58(): string }).toBase58();
          result[key] = (result[key] ?? 0) + 1;
        }
        setCounts(result);
      } catch {
        // non-critical — cards just won't show a count
      }
    }

    load();
    return () => { cancelled = true; };
  }, [hackathonPubkeys.join(",")]);

  return counts;
}
