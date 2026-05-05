"use client";

import { Buffer } from "buffer";
if (typeof globalThis !== "undefined" && !(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

import { useMemo, useEffect, useRef } from "react";
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
import { useTheme } from "@/hooks/useTheme";

import "@solana/wallet-adapter-react-ui/styles.css";

const BASE_WALLETS = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

type LinkedSolanaAccount = {
  address?: string;
  chainType?: string;
  walletClientType?: string;
};

type BridgeSolanaWallet = {
  address: string;
  walletClientType?: string;
  signTransaction(input: { transaction: Uint8Array }): Promise<{ signedTransaction: Uint8Array }>;
  signMessage(input: { message: Uint8Array; address: string }): Promise<{ signature: Uint8Array }>;
};

function isEmbeddedPrivyWallet(wallet: { walletClientType?: string } | null | undefined) {
  return wallet?.walletClientType === "privy" || wallet?.walletClientType === "privy-v2";
}

// Bridges the active Privy-linked Solana wallet into the standard wallet adapter.
// Defined at module level so React sees a stable component identity.
function WalletAdapterBridge({ children }: { children: React.ReactNode }) {
  const { usePrivy } = require("@privy-io/react-auth");
  const { useWallets } = require("@privy-io/react-auth/solana");
  const { PrivyWalletAdapter } = require("@/lib/privy-wallet-adapter");

  const { user, login, logout } = usePrivy();
  const { wallets: solanaWallets } = useWallets();

  const adapterRef = useRef<InstanceType<typeof PrivyWalletAdapter> | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = new PrivyWalletAdapter();
  }

  useEffect(() => {
    const a = adapterRef.current!;
    a.onLoginRequest = login;
    a.onLogout = logout;
  }, [login, logout]);

  const linkedSolanaAccounts = useMemo(
    () =>
      (((user?.linkedAccounts as LinkedSolanaAccount[] | undefined) ?? []).filter(
        (account) => account.chainType === "solana" && typeof account.address === "string",
      ) as Array<Required<Pick<LinkedSolanaAccount, "address">> & LinkedSolanaAccount>),
    [user?.linkedAccounts],
  );

  const selectedPrivyWallet = useMemo(() => {
    const matchedWallets = linkedSolanaAccounts
      .map((account) => solanaWallets.find((wallet: BridgeSolanaWallet) => wallet.address === account.address) ?? null)
      .filter((wallet): wallet is BridgeSolanaWallet => wallet !== null);
    return matchedWallets.find((wallet) => !isEmbeddedPrivyWallet(wallet)) ?? matchedWallets[0] ?? null;
  }, [linkedSolanaAccounts, solanaWallets]);

  useEffect(() => {
    adapterRef.current?.setWallet(selectedPrivyWallet);
  }, [selectedPrivyWallet]);

  // Phantom and Solflare come first so they appear at the top of the wallet modal.
  // Privy is last — it shows up as an option but is not the default.
  const wallets = useMemo(() => [...BASE_WALLETS, adapterRef.current!], []);

  return (
    <WalletProvider wallets={wallets} autoConnect={true}>
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  );
}

function PrivyProviders({ children }: { children: React.ReactNode }) {
  const { PrivyProvider } = require("@privy-io/react-auth");
  const { theme } = useTheme();
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "users-without-wallets" },
        },
        appearance: { theme, accentColor: "#FF5B14" },
      }}
    >
      <WalletAdapterBridge>{children}</WalletAdapterBridge>
    </PrivyProvider>
  );
}

function PlainProviders({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider wallets={BASE_WALLETS} autoConnect={true}>
      <WalletModalProvider>{children}</WalletModalProvider>
    </WalletProvider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const Inner = PRIVY_APP_ID ? PrivyProviders : PlainProviders;
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <Inner>{children}</Inner>
    </ConnectionProvider>
  );
}
