import { NextRequest, NextResponse } from "next/server";
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

  const { hackathon_pubkey, wallet_address, email, notes } = body as Record<string, string>;

  if (!hackathon_pubkey || !wallet_address || !email) {
    return NextResponse.json(
      { error: "hackathon_pubkey, wallet_address, and email are required" },
      { status: 400 },
    );
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Prevent duplicate requests from the same wallet in the same hackathon
  const { data: existing } = await db
    .from("whitelist_requests")
    .select("id, status")
    .eq("hackathon_pubkey", hackathon_pubkey)
    .eq("wallet_address", wallet_address)
    .maybeSingle();

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
