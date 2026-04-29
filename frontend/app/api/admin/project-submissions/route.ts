import { NextRequest, NextResponse } from "next/server";
import {
  canManageHackathon,
  filterManagedHackathonRows,
  resolveAdminAccess,
  verifyAdminRequest,
} from "@/lib/server-admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

interface SubmissionRecord {
  id: string;
  hackathon_pubkey: string;
  project_pubkey?: string | null;
  github_url: string;
  wallet_address: string;
  twitter_handle?: string | null;
  telegram?: string | null;
  discord?: string | null;
  status: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  let identity;
  try {
    identity = verifyAdminRequest(
      request,
      "project_submissions:list",
      "*",
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const access = await resolveAdminAccess(identity.wallet);

  const { data, error } = await db
    .from("project_submissions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("project_submissions list error:", error);
    return NextResponse.json({ error: "Failed to load submissions" }, { status: 500 });
  }

  const visible = filterManagedHackathonRows(
    (data ?? []) as SubmissionRecord[],
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
    submission_id?: string;
    status?: "approved" | "rejected";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { submission_id, status } = body;
  if (!submission_id || !status) {
    return NextResponse.json({ error: "submission_id and status are required" }, { status: 400 });
  }
  if (!["approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  let identity;
  try {
    identity = verifyAdminRequest(
      request,
      "project_submissions:review",
      submission_id,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const access = await resolveAdminAccess(identity.wallet);

  const { data: submissionData, error: fetchError } = await db
    .from("project_submissions")
    .select("*")
    .eq("id", submission_id)
    .single();

  const submission = submissionData as SubmissionRecord | null;

  if (fetchError || !submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  if (!canManageHackathon(access, submission.hackathon_pubkey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const reviewedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from("project_submissions")
    .update({ status, reviewed_at: reviewedAt })
    .eq("id", submission_id);

  if (updateError) {
    console.error("project_submissions update error:", updateError);
    return NextResponse.json({ error: "Failed to update submission" }, { status: 500 });
  }

  if (status === "approved" && submission.project_pubkey) {
    const { data: existingMeta } = await db
      .from("project_metadata")
      .select("created_at, registered_wallet")
      .eq("project_pubkey", submission.project_pubkey)
      .maybeSingle();

    const now = new Date().toISOString();
    const metadataRecord = {
      project_pubkey: submission.project_pubkey,
      hackathon_pubkey: submission.hackathon_pubkey,
      github_url: submission.github_url,
      twitter_handle: submission.twitter_handle ?? null,
      telegram: submission.telegram ?? null,
      discord: submission.discord ?? null,
      registered_wallet: existingMeta?.registered_wallet ?? submission.wallet_address,
      updated_at: now,
      ...(existingMeta?.created_at ? {} : { created_at: now }),
    };

    const { error: metadataError } = await db
      .from("project_metadata")
      .upsert(metadataRecord, { onConflict: "project_pubkey" });

    if (metadataError) {
      console.error("project_metadata upsert error:", metadataError);
      return NextResponse.json({ error: "Submission approved, but metadata sync failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, reviewed_at: reviewedAt }, { status: 200 });
}
