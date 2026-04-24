"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { protocolAdminPda } from "@/lib/pda";
import { PROGRAM_ID, PROTOCOL_ADMIN } from "@/lib/constants";

/**
 * Returns true if the connected wallet is a protocol admin — either the
 * hardcoded PROTOCOL_ADMIN super-admin, or a wallet that has been granted
 * a ProtocolAdminEntry PDA by PROTOCOL_ADMIN via add_protocol_admin.
 */
export function useIsProtocolAdmin(walletPubkey: PublicKey | null): {
  isProtocolAdmin: boolean;
  loading: boolean;
} {
  const { connection } = useConnection();
  const [pdaExists, setPdaExists] = useState(false);
  const [loading, setLoading] = useState(false);

  const isSuperAdmin = walletPubkey?.toBase58() === PROTOCOL_ADMIN;

  useEffect(() => {
    // Super-admin is always true without a PDA check.
    if (!walletPubkey || isSuperAdmin) { setPdaExists(false); return; }
    let cancelled = false;

    async function check() {
      setLoading(true);
      try {
        const pda = protocolAdminPda(walletPubkey!);
        const info = await connection.getAccountInfo(pda);
        if (!cancelled) {
          setPdaExists(info !== null && info.owner.equals(PROGRAM_ID));
        }
      } catch {
        if (!cancelled) setPdaExists(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [walletPubkey?.toBase58(), isSuperAdmin]);

  return {
    isProtocolAdmin: isSuperAdmin || pdaExists,
    loading: !isSuperAdmin && loading,
  };
}
