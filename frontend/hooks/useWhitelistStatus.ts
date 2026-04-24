"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { whitelistPda } from "@/lib/pda";
import { PROGRAM_ID } from "@/lib/constants";

export function useWhitelistStatus(
  hackathonPubkey: PublicKey | null,
  walletPubkey: PublicKey | null,
  refreshKey?: number,
) {
  const { connection } = useConnection();
  const [isWhitelisted, setIsWhitelisted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hackathonPubkey || !walletPubkey) { setIsWhitelisted(null); return; }
    let cancelled = false;

    async function check() {
      setLoading(true);
      try {
        const pda = whitelistPda(hackathonPubkey!, walletPubkey!);
        const info = await connection.getAccountInfo(pda);
        if (!cancelled) {
          // Account exists and is owned by the program → whitelisted
          setIsWhitelisted(info !== null && info.owner.equals(PROGRAM_ID));
        }
      } catch {
        if (!cancelled) setIsWhitelisted(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [hackathonPubkey?.toBase58(), walletPubkey?.toBase58(), refreshKey]);

  return { isWhitelisted, loading };
}
