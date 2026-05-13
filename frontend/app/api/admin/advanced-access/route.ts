import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/server-admin-auth";
import { PROTOCOL_ADMIN } from "@/lib/constants";
import { getSupabaseAdmin } from "@/lib/supabase";

// Table: advanced_panel_access(wallet_address TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW())
// RLS:   SELECT enabled for all; INSERT/DELETE restricted to service role.

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ wallets: [] });
  const { data } = await db
    .from("advanced_panel_access")
    .select("wallet_address")
    .order("created_at", { ascending: true });
  return NextResponse.json({ wallets: (data ?? []).map((r: any) => r.wallet_address as string) });
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  let body: { wallet_address?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { wallet_address } = body;
  if (!wallet_address?.trim()) return NextResponse.json({ error: "wallet_address required" }, { status: 400 });

  let identity;
  try { identity = verifyAdminRequest(request, "advanced_access:add", wallet_address); } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (identity.wallet.toBase58() !== PROTOCOL_ADMIN) {
    return NextResponse.json({ error: "Only the super-admin can manage advanced panel access" }, { status: 403 });
  }

  const { error } = await db
    .from("advanced_panel_access")
    .upsert({ wallet_address: wallet_address.trim() }, { onConflict: "wallet_address" });
  if (error) return NextResponse.json({ error: "Failed to add wallet" }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  let body: { wallet_address?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { wallet_address } = body;
  if (!wallet_address?.trim()) return NextResponse.json({ error: "wallet_address required" }, { status: 400 });

  let identity;
  try { identity = verifyAdminRequest(request, "advanced_access:remove", wallet_address); } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (identity.wallet.toBase58() !== PROTOCOL_ADMIN) {
    return NextResponse.json({ error: "Only the super-admin can manage advanced panel access" }, { status: 403 });
  }

  const { error } = await db
    .from("advanced_panel_access")
    .delete()
    .eq("wallet_address", wallet_address.trim());
  if (error) return NextResponse.json({ error: "Failed to remove wallet" }, { status: 500 });
  return NextResponse.json({ success: true });
}
