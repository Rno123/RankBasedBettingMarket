"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/program";
import { PROGRAM_ID } from "@/lib/constants";

// ProjectAccount discriminator = sha256("account:ProjectAccount")[:8]
const PROJECT_DISCRIMINATOR = "X1htXkgi8yH";

export function useProjectCounts(hackathonPubkeys: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const connection = getConnection();
        // Only fetch the 32-byte hackathon pubkey field (offset 8, after discriminator).
        // dataSlice slashes response size ~95% vs fetching full account data.
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [{ memcmp: { offset: 0, bytes: PROJECT_DISCRIMINATOR } }],
          dataSlice: { offset: 8, length: 32 },
        });
        if (cancelled) return;

        const result: Record<string, number> = {};
        for (const { account } of accounts) {
          const key = new PublicKey(account.data).toBase58();
          result[key] = (result[key] ?? 0) + 1;
        }
        setCounts(result);
      } catch {
        // non-critical — cards just won't show a count
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return counts;
}
