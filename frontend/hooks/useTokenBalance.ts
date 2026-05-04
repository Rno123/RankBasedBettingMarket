"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export function useTokenBalance(
  owner: PublicKey | null,
  mint: PublicKey | null,
  refreshKey = 0,
) {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!owner || !mint) {
      setBalance(null);
      return;
    }

    const ata = getAssociatedTokenAddressSync(mint, owner);
    connection
      .getTokenAccountBalance(ata)
      .then(({ value }) => {
        if (!cancelled) setBalance(BigInt(value.amount));
      })
      .catch(() => {
        if (!cancelled) setBalance(0n);
      });

    return () => {
      cancelled = true;
    };
  }, [connection, owner?.toBase58(), mint?.toBase58(), refreshKey]);

  return balance;
}
