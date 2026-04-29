import type { PublicKey } from "@solana/web3.js";
import {
  ADMIN_SESSION_BOOTSTRAP_ACTION,
  ADMIN_SESSION_COOKIE_TTL_MS,
  buildAdminSessionMessage,
} from "@/lib/admin-session";
import { signatureToBase64 } from "@/lib/signature";

interface AdminSessionResponse {
  expires_at?: string;
  wallet_address?: string;
}

let cachedWalletAddress: string | null = null;
let cachedExpiresAtMs = 0;
let pendingSessionBootstrap: Promise<void> | null = null;

function cacheSession(walletAddress: string, expiresAt: string | undefined) {
  const parsed = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  cachedWalletAddress = walletAddress;
  cachedExpiresAtMs = Number.isNaN(parsed)
    ? Date.now() + ADMIN_SESSION_COOKIE_TTL_MS
    : parsed;
}

function hasValidCachedSession(walletAddress: string) {
  return cachedWalletAddress === walletAddress && Date.now() < cachedExpiresAtMs - 5_000;
}

export function clearAdminSessionCache() {
  cachedWalletAddress = null;
  cachedExpiresAtMs = 0;
  pendingSessionBootstrap = null;
}

async function readExistingAdminSession(walletAddress: string): Promise<boolean> {
  const response = await fetch("/api/admin/session", {
    cache: "no-store",
    credentials: "same-origin",
  });

  if (!response.ok) return false;

  const payload = await response.json() as AdminSessionResponse;
  if (payload.wallet_address !== walletAddress) {
    await fetch("/api/admin/session", {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => {});
    clearAdminSessionCache();
    return false;
  }

  cacheSession(walletAddress, payload.expires_at);
  return true;
}

export async function ensureAdminSession(
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  publicKey: PublicKey,
): Promise<void> {
  const walletAddress = publicKey.toBase58();
  if (hasValidCachedSession(walletAddress)) return;

  if (!pendingSessionBootstrap) {
    pendingSessionBootstrap = (async () => {
      if (await readExistingAdminSession(walletAddress)) return;

      const issuedAt = new Date().toISOString();
      const message = buildAdminSessionMessage({
        action: ADMIN_SESSION_BOOTSTRAP_ACTION,
        issuedAt,
        resource: "*",
        walletAddress,
      });
      const signature = await signMessage(new TextEncoder().encode(message));

      const response = await fetch("/api/admin/session", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "x-admin-wallet-address": walletAddress,
          "x-admin-issued-at": issuedAt,
          "x-admin-signature": signatureToBase64(signature),
        },
      });

      const payload = await response.json().catch(() => ({})) as AdminSessionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to start admin session");
      }

      cacheSession(walletAddress, payload.expires_at);
    })();
  }

  try {
    await pendingSessionBootstrap;
  } finally {
    pendingSessionBootstrap = null;
  }
}
