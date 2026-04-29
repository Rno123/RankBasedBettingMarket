import { NextRequest, NextResponse } from "next/server";
import { isProtocolAdminWallet, verifyAdminRequest } from "@/lib/server-admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  let body: {
    hackathon_pubkey?: string;
    official_link?: string | null;
    icon_url?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { hackathon_pubkey, official_link, icon_url } = body;
  if (!hackathon_pubkey) {
    return NextResponse.json({ error: "hackathon_pubkey is required" }, { status: 400 });
  }

  let identity;
  try {
    identity = verifyAdminRequest(request, "hackathon-metadata:write", hackathon_pubkey);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await isProtocolAdminWallet(identity.wallet))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { error } = await db
    .from("hackathon_metadata")
    .upsert(
      { hackathon_pubkey, official_link: official_link ?? null, icon_url: icon_url ?? null },
      { onConflict: "hackathon_pubkey" },
    );

  if (error) {
    console.error("hackathon_metadata upsert error:", error);
    return NextResponse.json({ error: "Failed to save metadata" }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
