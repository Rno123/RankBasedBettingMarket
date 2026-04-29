import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_BOOTSTRAP_ACTION,
  ADMIN_SESSION_COOKIE_TTL_MS,
} from "@/lib/admin-session";
import {
  clearAdminSessionCookie,
  resolveAdminAccess,
  setAdminSessionCookie,
  verifyAdminSessionCookie,
  verifyAdminSessionSignature,
} from "@/lib/server-admin-auth";

function hasAnyAdminAccess(access: Awaited<ReturnType<typeof resolveAdminAccess>>) {
  return access.protocolAdmin || access.managedHackathons.size > 0;
}

export async function GET(request: NextRequest) {
  const session = verifyAdminSessionCookie(request);
  if (!session) {
    const response = NextResponse.json({ error: "No admin session" }, { status: 401 });
    clearAdminSessionCookie(response);
    return response;
  }

  const access = await resolveAdminAccess(session.wallet);
  if (!hasAnyAdminAccess(access)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    clearAdminSessionCookie(response);
    return response;
  }

  return NextResponse.json({
    expires_at: new Date(session.expiresAt).toISOString(),
    managed_hackathons: [...access.managedHackathons],
    protocol_admin: access.protocolAdmin,
    wallet_address: session.wallet.toBase58(),
  }, { status: 200 });
}

export async function POST(request: NextRequest) {
  let wallet;
  try {
    wallet = verifyAdminSessionSignature(
      request.headers,
      ADMIN_SESSION_BOOTSTRAP_ACTION,
      "*",
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const access = await resolveAdminAccess(wallet);
  if (!hasAnyAdminAccess(access)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const expiresAtMs = Date.now() + ADMIN_SESSION_COOKIE_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const response = NextResponse.json({
    expires_at: expiresAt,
    managed_hackathons: [...access.managedHackathons],
    protocol_admin: access.protocolAdmin,
    wallet_address: wallet.toBase58(),
  }, { status: 200 });

  setAdminSessionCookie(response, wallet, expiresAtMs);
  response.headers.set("x-admin-session-expires-at", expiresAt);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true }, { status: 200 });
  clearAdminSessionCookie(response);
  return response;
}
