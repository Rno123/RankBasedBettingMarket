"use client";

import { Buffer } from "buffer";
if (typeof globalThis !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { RPC_URL } from "@/lib/constants";

import "@solana/wallet-adapter-react-ui/styles.css";

const BASE_WALLETS = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

// ── Privy-enabled providers (loaded only when NEXT_PUBLIC_PRIVY_APP_ID is set) ─

function PrivyProviders({ children }: { children: React.ReactNode }) {
  // Dynamic imports keep Privy out of the bundle when the env var is absent.
  const { PrivyProvider, usePrivy } = require("@privy-io/react-auth");
  const { useWallets } = require("@privy-io/react-auth/solana");
  const { PrivyWalletAdapter } = require("@/lib/privy-wallet-adapter");

  function WalletAdapterBridge({ children }: { children: React.ReactNode }) {
    const { user } = usePrivy();
    const { wallets: solanaWallets } = useWallets();

    const privyAddr = (user?.linkedAccounts as any[])?.find(
      (a) => a.walletClientType === "privy" && a.chainType === "solana",
    )?.address as string | undefined;

    const embeddedWallet = privyAddr
      ? solanaWallets.find((w: any) => w.address === privyAddr) ?? null
      : null;

    const wallets = useMemo(
      () =>
        embeddedWallet
          ? [new PrivyWalletAdapter(embeddedWallet), ...BASE_WALLETS]
          : BASE_WALLETS,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [embeddedWallet?.address],
    );

    return (
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#6366f1",
        },
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
