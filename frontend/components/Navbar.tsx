"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { PROTOCOL_ADMIN } from "@/lib/constants";

// Wallet button must never render on the server — it reads browser extension
// state (Phantom, Solflare) which doesn't exist during SSR, causing a
// hydration mismatch between the server-rendered HTML and the client DOM.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton,
    ),
  { ssr: false },
);

export default function Navbar() {
  const { publicKey } = useWallet();
  const isAdmin = publicKey?.toBase58() === PROTOCOL_ADMIN;

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-indigo-600">HackBet</span>
          </Link>
          <div className="hidden items-center gap-4 sm:flex">
            <Link
              href="/"
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Hackathons
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="text-sm font-medium text-amber-600 hover:text-amber-800"
              >
                Admin
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <WalletMultiButton
            style={{
              height: "36px",
              fontSize: "13px",
              padding: "0 16px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            }}
          />
        </div>
      </div>
    </nav>
  );
}
