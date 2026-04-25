"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useTheme } from "@/hooks/useTheme";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";
import { DEPLOYER } from "@/lib/constants";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton,
    ),
  { ssr: false },
);

export default function Navbar() {
  const { publicKey } = useWallet();
  const { isProtocolAdmin, isSuperAdmin } = useIsProtocolAdmin(publicKey ?? null);
  const isDeployer = publicKey?.toBase58() === DEPLOYER;
  const showAdmin = isProtocolAdmin || isDeployer;
  const showMaster = isSuperAdmin || isDeployer;
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

  function navLinkStyle(href: string): React.CSSProperties {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return {
      fontSize: "0.875rem",
      fontWeight: 500,
      textDecoration: "none",
      transition: "color 0.15s",
      color: active ? "var(--c-indigo-text)" : "var(--c-text-3)",
    };
  }

  const iconBtnStyle: React.CSSProperties = {
    display: "flex",
    height: "36px",
    width: "36px",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "8px",
    color: "var(--c-text-3)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  };

  return (
    <nav className="ui-nav">
      <div style={{ margin: "0 auto", display: "flex", maxWidth: "1280px", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
        {/* Left: logo + desktop links */}
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
            <span style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.025em", color: "var(--c-text)" }}>
              HACK<span style={{ color: "var(--c-indigo-text)" }}>BET</span>
            </span>
          </Link>
          <div className="hidden-sm-flex" style={{ alignItems: "center", gap: "16px" }}>
            <Link href="/" style={navLinkStyle("/")}>Hackathons</Link>
            <Link href="/dev" style={navLinkStyle("/dev")}>
              {devUser ? "Dev Portal" : "Submit Project"}
            </Link>
            {showAdmin && (
              <Link href="/admin" style={navLinkStyle("/admin")}>Admin</Link>
            )}
            {showMaster && (
              <Link
                href="/master"
                style={{ fontSize: "0.875rem", fontWeight: pathname.startsWith("/master") ? 600 : 500, textDecoration: "none", color: "var(--c-amber-text)", transition: "color 0.15s" }}
              >
                Master
              </Link>
            )}
          </div>
        </div>

        {/* Right: wallet + theme toggle + hamburger */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {devUser && (
            <span className="hidden-sm-block" style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
              {devUser.length > 20 ? devUser.slice(0, 18) + "…" : devUser}
            </span>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            style={iconBtnStyle}
          >
            {theme === "dark" ? (
              <svg style={{ height: "16px", width: "16px" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
              <svg style={{ height: "16px", width: "16px" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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
            className="sm-hidden"
            style={iconBtnStyle}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? (
              <svg style={{ height: "20px", width: "20px" }} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg style={{ height: "20px", width: "20px" }} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div style={{ borderTop: "1px solid var(--c-divider)", background: "var(--nav-bg)", padding: "12px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <Link href="/" style={{ ...navLinkStyle("/"), padding: "8px 12px", borderRadius: "8px" }}>Hackathons</Link>
            <Link href="/dev" style={{ ...navLinkStyle("/dev"), padding: "8px 12px", borderRadius: "8px" }}>
              {devUser ? "Dev Portal" : "Submit Project"}
            </Link>
            {showAdmin && (
              <Link href="/admin" style={{ ...navLinkStyle("/admin"), padding: "8px 12px", borderRadius: "8px" }}>Admin</Link>
            )}
            {showMaster && (
              <Link href="/master" style={{ fontSize: "0.875rem", fontWeight: 500, textDecoration: "none", color: "var(--c-amber-text)", padding: "8px 12px", borderRadius: "8px" }}>
                Master
              </Link>
            )}
            {devUser && (
              <p style={{ margin: "4px 0 0", padding: "0 12px", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                {devUser.length > 30 ? devUser.slice(0, 28) + "…" : devUser}
              </p>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
