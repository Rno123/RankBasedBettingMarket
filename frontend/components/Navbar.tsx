"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PROTOCOL_ADMIN } from "@/lib/constants";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

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
  const [devUser, setDevUser] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setDevUser(session?.user?.email ?? session?.user?.user_metadata?.user_name ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setDevUser(session?.user?.email ?? session?.user?.user_metadata?.user_name ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function navClass(href: string, defaultColor: string) {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return `text-sm font-medium transition ${active ? "text-indigo-600" : `${defaultColor} hover:text-slate-900`}`;
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: logo + desktop links */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-indigo-600">BuildProof</span>
          </Link>
          <div className="hidden items-center gap-4 sm:flex">
            <Link href="/" className={navClass("/", "text-slate-500")}>
              Hackathons
            </Link>
            <Link href="/dev" className={navClass("/dev", "text-slate-500")}>
              {devUser ? "Dev Portal" : "Submit Project"}
            </Link>
            {isAdmin && (
              <Link href="/master" className={navClass("/master", "text-amber-500")}>
                Master
              </Link>
            )}
          </div>
        </div>

        {/* Right: wallet + hamburger */}
        <div className="flex items-center gap-2">
          {devUser && (
            <span className="hidden text-xs text-slate-400 sm:block">
              {devUser.length > 20 ? devUser.slice(0, 18) + "…" : devUser}
            </span>
          )}
          <WalletMultiButton
            style={{
              height: "36px",
              fontSize: "13px",
              padding: "0 12px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            }}
          />
          {/* Hamburger — mobile only */}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="border-t border-slate-100 bg-white px-4 py-3 sm:hidden">
          <div className="flex flex-col gap-1">
            <Link
              href="/"
              className={`rounded-lg px-3 py-2 ${navClass("/", "text-slate-600")}`}
            >
              Hackathons
            </Link>
            <Link
              href="/dev"
              className={`rounded-lg px-3 py-2 ${navClass("/dev", "text-slate-600")}`}
            >
              {devUser ? "Dev Portal" : "Submit Project"}
            </Link>
            {isAdmin && (
              <Link
                href="/master"
                className={`rounded-lg px-3 py-2 ${navClass("/master", "text-amber-500")}`}
              >
                Master
              </Link>
            )}
            {devUser && (
              <p className="mt-1 px-3 text-xs text-slate-400">
                {devUser.length > 30 ? devUser.slice(0, 28) + "…" : devUser}
              </p>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
