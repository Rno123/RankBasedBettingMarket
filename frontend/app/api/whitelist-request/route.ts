import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { hackathon_pubkey, wallet_address, email, notes, signature } =
    body as Record<string, string>;

  if (!hackathon_pubkey || !wallet_address || !email || !signature) {
    return NextResponse.json(
      { error: "hackathon_pubkey, wallet_address, email, and signature are required" },
      { status: 400 },
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Verify the wallet signature to prove the submitter owns wallet_address.
  try {
    const message = new TextEncoder().encode(
      `hackbet:whitelist-request:${hackathon_pubkey}`,
    );
    const sigBytes = Buffer.from(signature, "base64");
    const pubkeyBytes = new PublicKey(wallet_address).toBytes();

    const valid = nacl.sign.detached.verify(message, sigBytes, pubkeyBytes);
    if (!valid) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Global staking access is reviewed once per wallet. Reuse that status
  // instead of collecting duplicate requests across hackathons.
  const { data: existingRows, error: existingError } = await db
    .from("whitelist_requests")
    .select("id, status")
    .eq("wallet_address", wallet_address)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) {
    console.error("whitelist_requests lookup error:", existingError);
    return NextResponse.json({ error: "Failed to check existing request" }, { status: 500 });
  }

  const existing = existingRows?.[0];
  if (existing) {
    return NextResponse.json(
      { error: "Request already submitted", status: existing.status },
      { status: 409 },
    );
  }

  const { error } = await db.from("whitelist_requests").insert({
    hackathon_pubkey,
    wallet_address,
    email: email.toLowerCase().trim(),
    notes: notes?.trim() ?? null,
    status: "pending",
  });

  if (error) {
    console.error("whitelist_requests insert error:", error);
    return NextResponse.json({ error: "Failed to save request" }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
