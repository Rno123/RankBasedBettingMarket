import type { PublicKey } from "@solana/web3.js";
import { buildAdminSessionMessage } from "@/lib/admin-session";
import { signatureToBase64 } from "@/lib/signature";

export async function createAdminAuthHeaders(
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  publicKey: PublicKey,
  action: string,
  resource?: string | null,
): Promise<Record<string, string>> {
  const walletAddress = publicKey.toBase58();
  const issuedAt = new Date().toISOString();
  const message = buildAdminSessionMessage({
    action,
    issuedAt,
    resource,
    walletAddress,
  });
  const signature = await signMessage(new TextEncoder().encode(message));

  return {
    "x-admin-wallet-address": walletAddress,
    "x-admin-issued-at": issuedAt,
    "x-admin-signature": signatureToBase64(signature),
  };
}
