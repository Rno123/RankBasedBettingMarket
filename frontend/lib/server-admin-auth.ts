import { createHmac, timingSafeEqual } from "crypto";
import nacl from "tweetnacl";
import type { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_TTL_MS,
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

export interface AdminRequestIdentity {
  wallet: PublicKey;
  via: "cookie" | "signature";
}

interface AdminCookiePayload {
  exp: number;
  wallet: string;
}

function sessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Missing ADMIN_SESSION_SECRET");
  }
  return secret;
}

function signCookiePayload(encodedPayload: string): string {
  return createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

function decodeAdminCookie(token: string): AdminCookiePayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = Buffer.from(signCookiePayload(encodedPayload), "base64url");
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AdminCookiePayload;
  } catch {
    return null;
  }
}

function encodeAdminCookie(payload: AdminCookiePayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signCookiePayload(encodedPayload)}`;
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

export function verifyAdminSessionCookie(request: NextRequest): {
  expiresAt: number;
  wallet: PublicKey;
} | null {
  const raw = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!raw) return null;

  const payload = decodeAdminCookie(raw);
  if (!payload) return null;
  if (Date.now() > payload.exp) return null;

  try {
    return {
      wallet: new PublicKey(payload.wallet),
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function verifyAdminRequest(
  request: NextRequest,
  action: string,
  resource?: string | null,
): AdminRequestIdentity {
  const cookieSession = verifyAdminSessionCookie(request);
  if (cookieSession) {
    return {
      wallet: cookieSession.wallet,
      via: "cookie",
    };
  }

  return {
    wallet: verifyAdminSessionSignature(request.headers, action, resource),
    via: "signature",
  };
}

export function setAdminSessionCookie(
  response: NextResponse,
  wallet: PublicKey,
  expiresAtMs = Date.now() + ADMIN_SESSION_COOKIE_TTL_MS,
): string {
  const token = encodeAdminCookie({
    exp: expiresAtMs,
    wallet: wallet.toBase58(),
  });

  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAtMs),
  });

  return new Date(expiresAtMs).toISOString();
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
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
