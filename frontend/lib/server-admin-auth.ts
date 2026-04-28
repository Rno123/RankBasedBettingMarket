import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import {
  ADMIN_SESSION_CLOCK_SKEW_MS,
  ADMIN_SESSION_TTL_MS,
  buildAdminSessionMessage,
} from "@/lib/admin-session";
import { PROGRAM_ID, PROTOCOL_ADMIN } from "@/lib/constants";
import { protocolAdminPda } from "@/lib/pda";
import { getReadonlyProgram } from "@/lib/program";

export interface AdminAccess {
  managedHackathons: Set<string>;
  protocolAdmin: boolean;
  wallet: PublicKey;
}

export function verifyAdminSessionSignature(
  headers: Headers,
  action: string,
  resource?: string | null,
): PublicKey {
  const walletAddress = headers.get("x-admin-wallet-address");
  const issuedAt = headers.get("x-admin-issued-at");
  const signature = headers.get("x-admin-signature");
  if (!walletAddress || !issuedAt || !signature) {
    throw new Error("Missing admin auth headers");
  }

  const wallet = new PublicKey(walletAddress);
  const issuedAtMs = Date.parse(issuedAt);
  if (Number.isNaN(issuedAtMs)) {
    throw new Error("Invalid admin auth timestamp");
  }

  const now = Date.now();
  if (issuedAtMs > now + ADMIN_SESSION_CLOCK_SKEW_MS) {
    throw new Error("Admin auth timestamp is in the future");
  }
  if (now - issuedAtMs > ADMIN_SESSION_TTL_MS) {
    throw new Error("Admin auth timestamp expired");
  }

  const message = new TextEncoder().encode(buildAdminSessionMessage({
    action,
    issuedAt,
    resource,
    walletAddress,
  }));
  const signatureBytes = Buffer.from(signature, "base64");

  const valid = nacl.sign.detached.verify(message, signatureBytes, wallet.toBytes());
  if (!valid) {
    throw new Error("Signature verification failed");
  }

  return wallet;
}

export async function isProtocolAdminWallet(wallet: PublicKey): Promise<boolean> {
  if (wallet.toBase58() === PROTOCOL_ADMIN) return true;

  const program = getReadonlyProgram();
  const connection = (program.provider as any).connection;
  const adminEntry = protocolAdminPda(wallet);
  const info = await connection.getAccountInfo(adminEntry);
  return info !== null && info.owner.equals(PROGRAM_ID);
}

export async function managedHackathonPubkeys(wallet: PublicKey): Promise<Set<string>> {
  if (await isProtocolAdminWallet(wallet)) return new Set();

  const program = getReadonlyProgram();
  const accounts = await (program.account as any).hackathonState.all([
    {
      memcmp: {
        offset: 8,
        bytes: wallet.toBase58(),
      },
    },
  ]);

  return new Set(accounts.map((entry: any) => entry.publicKey.toBase58()));
}

export async function resolveAdminAccess(wallet: PublicKey): Promise<AdminAccess> {
  const protocolAdmin = await isProtocolAdminWallet(wallet);
  return {
    wallet,
    protocolAdmin,
    managedHackathons: protocolAdmin ? new Set<string>() : await managedHackathonPubkeys(wallet),
  };
}

export function canManageHackathon(
  access: AdminAccess,
  hackathonPubkey: string,
): boolean {
  return access.protocolAdmin || access.managedHackathons.has(hackathonPubkey);
}

export function filterManagedHackathonRows<T extends { hackathon_pubkey: string }>(
  rows: T[],
  access: AdminAccess,
): T[] {
  if (access.protocolAdmin) return rows;
  return rows.filter((row) => access.managedHackathons.has(row.hackathon_pubkey));
}
