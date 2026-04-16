import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { getSupabaseAdmin } from "@/lib/supabase";

// TODO: After program redeploy (which adds registered_by: Pubkey to ProjectAccount),
// this route should additionally fetch the on-chain ProjectAccount and verify
//   registered_by == walletAddress
// For now we use a first-claimer approach: the first wallet to submit metadata
// for a given projectPubkey claims ownership. Subsequent updates from a different
// wallet are rejected with 403.

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Server not configured: missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 },
    );
  }

  let body: {
    projectPubkey: string;
    hackathonPubkey: string;
    githubUrl: string;
    twitterHandle?: string;
    telegram?: string;
    discord?: string;
    walletAddress: string;
    signature: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    projectPubkey,
    hackathonPubkey,
    githubUrl,
    twitterHandle,
    telegram,
    discord,
    walletAddress,
    signature,
  } = body;

  if (!projectPubkey || !hackathonPubkey || !githubUrl || !walletAddress || !signature) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify wallet signature
  // Message: hackbet:register:<projectPubkey>
  const message = `hackbet:register:${projectPubkey}`;
  const messageBytes = Buffer.from(message, "utf8");

  let sigBytes: Uint8Array;
  let pubkeyBytes: Uint8Array;
  try {
    sigBytes = Buffer.from(signature, "base64");
    pubkeyBytes = new PublicKey(walletAddress).toBytes();
  } catch {
    return NextResponse.json({ error: "Invalid signature or wallet address" }, { status: 400 });
  }

  const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
  if (!valid) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  // Check if project_metadata already exists for this projectPubkey
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("project_metadata")
    .select("registered_wallet")
    .eq("project_pubkey", projectPubkey)
    .maybeSingle();

  if (fetchError) {
    console.error("Supabase fetch error:", fetchError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (existing && existing.registered_wallet !== walletAddress) {
    return NextResponse.json(
      { error: "Project metadata already claimed by a different wallet" },
      { status: 403 },
    );
  }

  // Upsert project_metadata
  const now = new Date().toISOString();
  const record = {
    project_pubkey: projectPubkey,
    hackathon_pubkey: hackathonPubkey,
    github_url: githubUrl,
    twitter_handle: twitterHandle ?? null,
    telegram: telegram ?? null,
    discord: discord ?? null,
    registered_wallet: walletAddress,
    updated_at: now,
    ...(existing ? {} : { created_at: now }),
  };

  const { data: upserted, error: upsertError } = await supabaseAdmin
    .from("project_metadata")
    .upsert(record, { onConflict: "project_pubkey" })
    .select()
    .single();

  if (upsertError) {
    console.error("Supabase upsert error:", upsertError);
    return NextResponse.json({ error: "Failed to save metadata" }, { status: 500 });
  }

  return NextResponse.json({ data: upserted }, { status: 200 });
}
