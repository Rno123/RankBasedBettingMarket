"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PROTOCOL_ADMIN } from "@/lib/constants";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/useTheme";

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
  const { theme, toggle } = useTheme();

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

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function navClass(href: string) {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return `text-sm font-medium transition ${
      active
        ? "text-indigo-600 dark:text-white"
        : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
    }`;
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#08080f]/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: logo + desktop links */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
              HACK<span className="text-indigo-600 dark:text-indigo-400">BET</span>
            </span>
          </Link>
          <div className="hidden items-center gap-4 sm:flex">
            <Link href="/" className={navClass("/")}>Hackathons</Link>
            <Link href="/dev" className={navClass("/dev")}>
              {devUser ? "Dev Portal" : "Submit Project"}
            </Link>
            {isAdmin && (
              <Link
                href="/master"
                className={`text-sm font-medium text-amber-600 transition hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 ${pathname.startsWith("/master") ? "font-semibold" : ""}`}
              >
                Master
              </Link>
            )}
          </div>
        </div>

        {/* Right: wallet + theme toggle + hamburger */}
        <div className="flex items-center gap-2">
          {devUser && (
            <span className="hidden text-xs text-slate-400 sm:block">
              {devUser.length > 20 ? devUser.slice(0, 18) + "…" : devUser}
            </span>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
          >
            {theme === "dark" ? (
              /* Sun icon */
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              /* Moon icon */
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <WalletMultiButton
            style={{
              height: "36px",
              fontSize: "13px",
              padding: "0 12px",
              borderRadius: "8px",
            }}
          />

          {/* Hamburger — mobile only */}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06] sm:hidden"
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

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="border-t border-slate-100 bg-white px-4 py-3 dark:border-white/[0.06] dark:bg-[#08080f] sm:hidden">
          <div className="flex flex-col gap-1">
            <Link href="/" className={`rounded-lg px-3 py-2 ${navClass("/")}`}>Hackathons</Link>
            <Link href="/dev" className={`rounded-lg px-3 py-2 ${navClass("/dev")}`}>
              {devUser ? "Dev Portal" : "Submit Project"}
            </Link>
            {isAdmin && (
              <Link href="/master" className="rounded-lg px-3 py-2 text-sm font-medium text-amber-600 dark:text-amber-400">
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
