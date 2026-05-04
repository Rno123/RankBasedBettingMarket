import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/constants";
import { buildProjectRegistrationMessage } from "@/lib/project-signing";
import { getReadonlyProgram } from "@/lib/program";
import { getSupabaseAdmin } from "@/lib/supabase";

interface ProjectSubmissionBody {
  authEmail?: string | null;
  discord?: string;
  githubUrl?: string;
  hackathonPubkey?: string;
  iconBase64?: string | null;  // data:image/...;base64,... — client-resized to ≤256px
  projectName?: string;
  projectPubkey?: string;
  signature?: string;
  telegram?: string;
  twitterHandle?: string;
  walletAddress?: string;
}

function formatProjectSubmissionDbError(error: {
  code?: string | null;
  message?: string | null;
} | null): string {
  if (!error) return "Failed to save submission";
  if (
    error.code === "PGRST204" &&
    (error.message ?? "").includes("project_submissions")
  ) {
    return `Supabase schema is out of date for project submissions. ${error.message} Run the latest Supabase migration.`;
  }
  return error.message ?? "Failed to save submission";
}

function normalizeGithubUrl(raw: string): string {
  try {
    const u = new URL(raw.toLowerCase());
    u.pathname = u.pathname.replace(/\.git$/, "").replace(/\/$/, "");
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function expectedProjectPubkey(
  hackathonPubkey: string,
  githubUrl: string,
): string {
  const normalized = normalizeGithubUrl(githubUrl);
  const urlHash = createHash("sha256").update(normalized).digest();
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
    iconBase64,
    projectName,
    projectPubkey,
    signature,
    telegram,
    twitterHandle,
    walletAddress,
  } = body;
  const normalizedProjectName = projectName?.trim() ?? "";

  if (!projectPubkey || !hackathonPubkey || !githubUrl || !walletAddress || !signature || !normalizedProjectName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (normalizedProjectName.length > 120) {
    return NextResponse.json({ error: "Project name too long (max 120 chars)" }, { status: 400 });
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
    .select("github_url, hackathon_pubkey, icon_url, status, wallet_address")
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
  // Resolve requires_approval from on-chain — never trust the client.
  let onChainRequiresApproval = true;
  try {
    const program = getReadonlyProgram();
    const hackathonPk = new PublicKey(hackathonPubkey);
    const hackathonAccount = await (program.account as any).hackathonState.fetchNullable(hackathonPk);
    if (hackathonAccount) {
      onChainRequiresApproval = (hackathonAccount.requiresApproval as boolean) ?? true;
    }
  } catch {
    // If on-chain lookup fails, default to requiring approval (safe default).
  }
  // Preserve an existing "approved" status on re-submission.
  // For new submissions, auto-approve when the hackathon has open registration.
  const status = existing?.status === "approved"
    ? "approved"
    : !onChainRequiresApproval
      ? "approved"
      : "pending";

  // ── Icon upload ──────────────────────────────────────────────────────────
  let iconUrl: string | null = existing?.icon_url ?? null;
  if (iconBase64 && iconBase64.startsWith("data:image/")) {
    try {
      const [header, data] = iconBase64.split(",");
      const mime = header.match(/data:(image\/\w+);base64/)?.[1] ?? "image/png";
      const ext = mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1];
      const buf = Buffer.from(data, "base64");

      // Reject anything over 100 KB.
      if (buf.length > 102_400) {
        return NextResponse.json({ error: "Icon too large — max 100 KB" }, { status: 400 });
      }

      const filename = `${projectPubkey}.${ext}`;
      const { error: uploadErr } = await db.storage
        .from("project_icons")
        .upload(filename, buf, { contentType: mime, upsert: true });

      if (uploadErr) {
        console.error("icon upload error:", uploadErr);
      } else {
        const { data: publicUrl } = db.storage.from("project_icons").getPublicUrl(filename);
        iconUrl = publicUrl.publicUrl;
      }
    } catch {
      // Icon upload is best-effort; proceed without it.
    }
  }

  const record = {
    auth_email: authEmail?.trim() || null,
    discord: discord || null,
    github_url: githubUrl,
    hackathon_pubkey: hackathonPubkey,
    icon_url: iconUrl,
    project_name: normalizedProjectName,
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
    return NextResponse.json(
      { error: formatProjectSubmissionDbError(upsertError) },
      { status: 500 },
    );
  }

  return NextResponse.json({ data }, { status: existing ? 200 : 201 });
}
