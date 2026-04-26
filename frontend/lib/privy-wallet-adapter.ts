import {
  BaseSignerWalletAdapter,
  WalletName,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

// Minimal interface matching ConnectedStandardSolanaWallet from @privy-io/react-auth/solana.
// Using a local interface avoids bundling Privy's Solana module in non-Privy code paths.
interface PrivySolanaWallet {
  address: string;
  signTransaction(input: { transaction: Uint8Array }): Promise<{ signedTransaction: Uint8Array }>;
  signTransaction(...inputs: { transaction: Uint8Array }[]): Promise<{ signedTransaction: Uint8Array }[]>;
  signMessage(input: { message: Uint8Array; address: string }): Promise<{ signature: Uint8Array }>;
}

export const PrivyWalletName = "Privy" as WalletName<"Privy">;

const PRIVY_ICON =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI4IiBmaWxsPSIjNjM2NmYxIi8+PHRleHQgeD0iMTYiIHk9IjIxIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtd2VpZ2h0PSI3MDAiPlA8L3RleHQ+PC9zdmc+" as string;

// Wraps a Privy embedded Solana wallet as a standard @solana/wallet-adapter wallet.
// Allows existing useWallet() / Anchor code to sign through Privy without changes.
export class PrivyWalletAdapter extends BaseSignerWalletAdapter {
  name = PrivyWalletName;
  supportedTransactionVersions = null;
  url = "https://privy.io";
  icon = PRIVY_ICON;
  readyState = WalletReadyState.Installed;

  private _wallet: PrivySolanaWallet;

  constructor(wallet: PrivySolanaWallet) {
    super();
    this._wallet = wallet;
  }

  get publicKey(): PublicKey {
    return new PublicKey(this._wallet.address);
  }

  get connecting(): boolean {
    return false;
  }

  async connect(): Promise<void> {
    this.emit("connect", this.publicKey);
  }

  async disconnect(): Promise<void> {
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const bytes =
      tx instanceof VersionedTransaction
        ? tx.serialize()
        : tx.serialize({ requireAllSignatures: false, verifySignatures: false });

    const { signedTransaction } = await (this._wallet.signTransaction as (input: { transaction: Uint8Array }) => Promise<{ signedTransaction: Uint8Array }>)({ transaction: bytes });

    return (tx instanceof VersionedTransaction
      ? VersionedTransaction.deserialize(signedTransaction)
      : Transaction.from(signedTransaction)) as T;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
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
