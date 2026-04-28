"use client";

import { Buffer } from "buffer";
if (typeof globalThis !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

import { useMemo, useEffect, useRef } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { RPC_URL } from "@/lib/constants";
import { PrivyWalletName } from "@/lib/privy-wallet-adapter";

import "@solana/wallet-adapter-react-ui/styles.css";

const BASE_WALLETS = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

// Reconnects returning Privy users without triggering the login modal.
// Sits inside <WalletProvider> so it can call useWallet().
function AutoConnectPrivy({ embeddedWalletAddress }: { embeddedWalletAddress: string | undefined }) {
  const { wallet, connected, select, connect } = useWallet();

  useEffect(() => {
    if (!embeddedWalletAddress) return;
    if (wallet?.adapter.name === PrivyWalletName) return;
    select(PrivyWalletName);
  }, [embeddedWalletAddress, wallet?.adapter.name, select]);

  useEffect(() => {
    if (wallet?.adapter.name !== PrivyWalletName) return;
    if (connected) return;
    connect().catch(() => {});
  }, [wallet?.adapter.name, connected, connect]);

  return null;
}

// Bridges the Privy embedded Solana wallet into the standard wallet adapter.
// Defined at module level so React sees a stable component identity — defining
// it inside PrivyProviders would remount the wallet subtree on every render.
// Must be rendered inside <PrivyProvider>.
function WalletAdapterBridge({ children }: { children: React.ReactNode }) {
  const { usePrivy } = require("@privy-io/react-auth");
  const { useWallets } = require("@privy-io/react-auth/solana");
  const { PrivyWalletAdapter } = require("@/lib/privy-wallet-adapter");

  const { user, login, logout } = usePrivy();
  const { wallets: solanaWallets } = useWallets();

  // One stable adapter for the page lifetime.
  const adapterRef = useRef<InstanceType<typeof PrivyWalletAdapter> | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = new PrivyWalletAdapter();
  }

  // Keep login/logout callbacks fresh so the adapter never captures stale closures.
  useEffect(() => {
    const a = adapterRef.current!;
    a.onLoginRequest = login;
    a.onLogout = logout;
  }, [login, logout]);

  // Detect the Privy embedded Solana wallet and push it into the adapter.
  const privyAddr = (user?.linkedAccounts as any[])?.find(
    (a: any) => a.walletClientType === "privy" && a.chainType === "solana",
  )?.address as string | undefined;

  const embeddedWallet = privyAddr
    ? solanaWallets.find((w: any) => w.address === privyAddr) ?? null
    : null;

  useEffect(() => {
    adapterRef.current?.setWallet(embeddedWallet);
  }, [embeddedWallet]);

  // Wallet list is stable: Privy (email login) always first, then injected wallets.
  // autoConnect={false} avoids a race where the adapter fires login() before
  // Privy has had time to restore the user's session on page load.
  const wallets = useMemo(() => [adapterRef.current!, ...BASE_WALLETS], []);

  return (
    <WalletProvider wallets={wallets} autoConnect={false}>
      <WalletModalProvider>
        <AutoConnectPrivy embeddedWalletAddress={privyAddr} />
        {children}
      </WalletModalProvider>
    </WalletProvider>
  );
}

// ── Privy-enabled providers ───────────────────────────────────────────────────

function PrivyProviders({ children }: { children: React.ReactNode }) {
  const { PrivyProvider } = require("@privy-io/react-auth");
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
        },
        appearance: { theme: "dark", accentColor: "#6366f1" },
      }}
    >
      <WalletAdapterBridge>{children}</WalletAdapterBridge>
    </PrivyProvider>
  );
}

// ── Fallback providers (no Privy) ─────────────────────────────────────────────

function PlainProviders({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider wallets={BASE_WALLETS} autoConnect>
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  );
}

// ── Root providers ────────────────────────────────────────────────────────────

export default function Providers({ children }: { children: React.ReactNode }) {
  const Inner = PRIVY_APP_ID ? PrivyProviders : PlainProviders;
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <Inner>{children}</Inner>
    </ConnectionProvider>
  );
}
