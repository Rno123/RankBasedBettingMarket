import { NextRequest, NextResponse } from "next/server";
import {
  canManageHackathon,
  filterManagedHackathonRows,
  resolveAdminAccess,
  verifyAdminSessionSignature,
} from "@/lib/server-admin-auth";
import { PROTOCOL_ADMIN } from "@/lib/constants";
import { getSupabaseAdmin } from "@/lib/supabase";

interface WhitelistRequestRecord {
  id: string;
  hackathon_pubkey: string;
  wallet_address: string;
  email: string;
  notes?: string | null;
  status: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const hackathonPubkey = request.nextUrl.searchParams.get("hackathon_pubkey");
  let wallet;
  try {
    wallet = verifyAdminSessionSignature(
      request.headers,
      "whitelist_requests:list",
      hackathonPubkey ?? "*",
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const access = await resolveAdminAccess(wallet);

  const query = db
    .from("whitelist_requests")
    .select("*")
    .order("created_at", { ascending: false });
  const { data, error } = hackathonPubkey
    ? await query.eq("hackathon_pubkey", hackathonPubkey)
    : await query;

  if (error) {
    console.error("whitelist_requests list error:", error);
    return NextResponse.json({ error: "Failed to load whitelist requests" }, { status: 500 });
  }

  const visible = filterManagedHackathonRows(
    (data ?? []) as WhitelistRequestRecord[],
    access,
  );

  return NextResponse.json({ data: visible }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  let body: {
    request_id?: string;
    status?: "approved" | "rejected";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { request_id, status } = body;
  if (!request_id || !status) {
    return NextResponse.json({ error: "request_id and status are required" }, { status: 400 });
  }
  if (!["approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  let wallet;
  try {
    wallet = verifyAdminSessionSignature(
      request.headers,
      "whitelist_requests:review",
      request_id,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const access = await resolveAdminAccess(wallet);
  if (wallet.toBase58() !== PROTOCOL_ADMIN) {
    return NextResponse.json({ error: "Only the super-admin can review staker access" }, { status: 403 });
  }

  const { data: requestRow, error: fetchError } = await db
    .from("whitelist_requests")
    .select("*")
    .eq("id", request_id)
    .single();

  if (fetchError || !requestRow) {
    return NextResponse.json({ error: "Whitelist request not found" }, { status: 404 });
  }

  if (!canManageHackathon(access, requestRow.hackathon_pubkey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let updateQuery = db
    .from("whitelist_requests")
    .update({ status })
    .eq("wallet_address", requestRow.wallet_address);

  if (status === "rejected") {
    updateQuery = updateQuery.eq("status", "pending");
  }

  const { error: updateError } = await updateQuery;

  if (updateError) {
    console.error("whitelist_requests update error:", updateError);
    return NextResponse.json({ error: "Failed to update whitelist request" }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
