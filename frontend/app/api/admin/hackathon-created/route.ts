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
    name?: string;
    admin_wallet?: string;
    results_timestamp?: number;
    num_tiers?: number;
    tier_pcts?: number[];
    tier_counts?: number[];
    fee_recipient?: string;
    protocol_fee_bps?: number;
    deposit_amount?: number;
    requires_approval?: boolean;
    open_staking?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    hackathon_pubkey,
    name,
    admin_wallet,
    results_timestamp,
    num_tiers,
    tier_pcts,
    tier_counts,
    fee_recipient,
    protocol_fee_bps,
    deposit_amount,
    requires_approval,
    open_staking,
  } = body;

  if (
    !hackathon_pubkey || !name || !admin_wallet ||
    results_timestamp == null || num_tiers == null ||
    !tier_pcts || !tier_counts || !fee_recipient ||
    protocol_fee_bps == null || deposit_amount == null ||
    requires_approval == null || open_staking == null
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  let identity;
  try {
    identity = verifyAdminRequest(request, "hackathon:create", hackathon_pubkey);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await isProtocolAdminWallet(identity.wallet))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { error } = await db.from("hackathons").upsert(
    {
      hackathon_pubkey,
      name,
      admin_wallet,
      results_timestamp,
      num_tiers,
      tier_pcts,
      tier_counts,
      fee_recipient,
      protocol_fee_bps,
      deposit_amount,
      requires_approval,
      open_staking,
    },
    { onConflict: "hackathon_pubkey" },
  );

  if (error) {
    console.error("hackathons upsert error:", error);
    return NextResponse.json({ error: "Failed to log hackathon" }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
