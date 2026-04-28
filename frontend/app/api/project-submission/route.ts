import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/constants";
import { buildProjectRegistrationMessage } from "@/lib/project-signing";
import { getSupabaseAdmin } from "@/lib/supabase";

interface ProjectSubmissionBody {
  authEmail?: string | null;
  discord?: string;
  githubUrl?: string;
  hackathonPubkey?: string;
  projectPubkey?: string;
  signature?: string;
  telegram?: string;
  twitterHandle?: string;
  walletAddress?: string;
}

function expectedProjectPubkey(
  hackathonPubkey: string,
  githubUrl: string,
): string {
  const urlHash = createHash("sha256").update(githubUrl).digest();
  const [projectPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("project"), new PublicKey(hackathonPubkey).toBuffer(), urlHash],
    PROGRAM_ID,
  );
  return projectPda.toBase58();
}

export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json(
      { error: "Server not configured: missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 },
    );
  }

  let body: ProjectSubmissionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    authEmail,
    discord,
    githubUrl,
    hackathonPubkey,
    projectPubkey,
    signature,
    telegram,
    twitterHandle,
    walletAddress,
  } = body;

  if (!projectPubkey || !hackathonPubkey || !githubUrl || !walletAddress || !signature) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const expected = expectedProjectPubkey(hackathonPubkey, githubUrl);
    if (expected !== projectPubkey) {
      return NextResponse.json(
        { error: "projectPubkey does not match the submitted hackathon/github pair" },
        { status: 409 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid hackathon or project public key" },
      { status: 400 },
    );
  }

  const message = buildProjectRegistrationMessage(projectPubkey);
  let pubkeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    pubkeyBytes = new PublicKey(walletAddress).toBytes();
    signatureBytes = Buffer.from(signature, "base64");
  } catch {
    return NextResponse.json(
      { error: "Invalid signature or wallet address" },
      { status: 400 },
    );
  }

  const valid = nacl.sign.detached.verify(
    Buffer.from(message, "utf8"),
    signatureBytes,
    pubkeyBytes,
  );
  if (!valid) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  const { data: existing, error: fetchError } = await db
    .from("project_submissions")
    .select("github_url, hackathon_pubkey, status, wallet_address")
    .eq("project_pubkey", projectPubkey)
    .maybeSingle();

  if (fetchError) {
    console.error("project_submissions fetch error:", fetchError);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (existing && existing.wallet_address !== walletAddress) {
    return NextResponse.json(
      { error: "Project submission already claimed by a different wallet" },
      { status: 403 },
    );
  }

  if (
    existing &&
    (existing.github_url !== githubUrl || existing.hackathon_pubkey !== hackathonPubkey)
  ) {
    return NextResponse.json(
      { error: "Project submission does not match the existing project identity" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const status = existing?.status === "approved" ? "approved" : "pending";
  const record = {
    auth_email: authEmail?.trim() || null,
    discord: discord || null,
    github_url: githubUrl,
    hackathon_pubkey: hackathonPubkey,
    project_pubkey: projectPubkey,
    status,
    telegram: telegram || null,
    twitter_handle: twitterHandle?.replace(/^@/, "") || null,
    updated_at: now,
    wallet_address: walletAddress,
    ...(existing ? {} : { created_at: now }),
  };

  const { data, error: upsertError } = await db
    .from("project_submissions")
    .upsert(record, { onConflict: "project_pubkey" })
    .select()
    .single();

  if (upsertError) {
    console.error("project_submissions upsert error:", upsertError);
    return NextResponse.json({ error: "Failed to save submission" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: existing ? 200 : 201 });
}
