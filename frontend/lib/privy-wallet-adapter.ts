import {
  BaseSignerWalletAdapter,
  WalletName,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

interface PrivySolanaWallet {
  address: string;
  signTransaction(input: { transaction: Uint8Array }): Promise<{ signedTransaction: Uint8Array }>;
  signMessage(input: { message: Uint8Array; address: string }): Promise<{ signature: Uint8Array }>;
}

export const PrivyWalletName = "Privy" as WalletName<"Privy">;

const PRIVY_ICON = "data:image/x-icon;base64,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";

// Stable wallet adapter for Privy-linked Solana wallets.
// A single instance lives for the page lifetime; the underlying wallet is
// injected via setWallet() after Privy auth completes.
// connect() opens the Privy login modal if no wallet is available yet.
export class PrivyWalletAdapter extends BaseSignerWalletAdapter {
  name = PrivyWalletName;
  url = "https://privy.io";
  icon = PRIVY_ICON;
  readyState = WalletReadyState.Installed;
  supportedTransactionVersions = null;

  private _wallet: PrivySolanaWallet | null = null;
  private _pendingResolve: (() => void) | null = null;
  private _pendingReject: ((e: Error) => void) | null = null;

  // Set by WalletAdapterBridge — kept fresh via useEffect so they never go stale.
  onLoginRequest: (() => Promise<void>) | null = null;
  onLogout: (() => Promise<void>) | null = null;

  get publicKey(): PublicKey | null {
    return this._wallet ? new PublicKey(this._wallet.address) : null;
  }

  get connecting(): boolean {
    return this._pendingResolve !== null;
  }

  // Called by WalletAdapterBridge when the active Privy Solana wallet appears or disappears.
  setWallet(wallet: PrivySolanaWallet | null): void {
    const prev = this._wallet;
    this._wallet = wallet;

    if (wallet && this._pendingResolve) {
      // Login completed — resolve the pending connect() call.
      const resolve = this._pendingResolve;
      this._pendingResolve = null;
      this._pendingReject = null;
      resolve();
    }

    if (!wallet && prev) {
      this.emit("disconnect");
    }
  }

  async connect(): Promise<void> {
    if (this._wallet) {
      this.emit("connect", this.publicKey!);
      return;
    }

    if (!this.onLoginRequest) throw new Error("Privy login not configured");

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this._pendingResolve = null;
        this._pendingReject = null;
        fn();
      };

      this._pendingResolve = () => settle(resolve);
      this._pendingReject = (e: Error) => settle(() => reject(e));

      this.onLoginRequest!()
        .then(() => {
          // Give the user up to 5 min to complete email/OTP/OAuth and for
          // React to propagate Privy state and call setWallet().
          setTimeout(() => {
            if (!settled) settle(() => reject(new Error("Login timed out")));
          }, 300_000);
        })
        .catch((e: unknown) =>
          settle(() => reject(e instanceof Error ? e : new Error(String(e))))
        );
    });

    if (this._wallet) {
      this.emit("connect", this.publicKey!);
    }
  }

  async disconnect(): Promise<void> {
    this._wallet = null;
    this.emit("disconnect");
    await this.onLogout?.();
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this._wallet) throw new Error("Wallet not connected");
    const bytes =
      tx instanceof VersionedTransaction
        ? tx.serialize()
        : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const { signedTransaction } = await (
      this._wallet.signTransaction as (
        input: { transaction: Uint8Array }
      ) => Promise<{ signedTransaction: Uint8Array }>
    )({ transaction: bytes });
    return (
      tx instanceof VersionedTransaction
        ? VersionedTransaction.deserialize(signedTransaction)
        : Transaction.from(signedTransaction)
    ) as T;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._wallet) throw new Error("Wallet not connected");
    const { signature } = await this._wallet.signMessage({
      message,
      address: this._wallet.address,
    });
    return signature;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    return Promise.all(transactions.map((tx) => this.signTransaction(tx)));
  }
}
