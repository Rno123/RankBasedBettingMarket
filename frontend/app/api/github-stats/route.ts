import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function githubFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `token ${GITHUB_TOKEN}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  const parsed = parseGithubUrl(url);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
  }
  const { owner, repo } = parsed;

  const db = getSupabaseAdmin();

  // Check Supabase cache first
  let cached = null;
  if (db) {
    const { data } = await db
      .from("github_stats")
      .select("*")
      .eq("github_url", url)
      .maybeSingle();

    if (data) {
      const age = Date.now() - new Date(data.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({ data }, { status: 200 });
      }
      cached = data; // stale — use as fallback if GitHub fetch fails
    }
  }

  // Fetch from GitHub
  try {
    // 1. Get default branch
    const repoRes = await githubFetch(`/repos/${owner}/${repo}`);
    if (repoRes.status === 429 || !repoRes.ok) {
      if (cached) return NextResponse.json({ data: cached }, { status: 200 });
      return NextResponse.json({ data: null }, { status: 200 });
    }
    const repoData = await repoRes.json();
    const defaultBranch: string = repoData.default_branch ?? "main";

    // 2. Last commit on default branch
    const commitsRes = await githubFetch(
      `/repos/${owner}/${repo}/commits?sha=${defaultBranch}&per_page=1`,
    );
    let lastCommitAt: string | null = null;
    if (commitsRes.ok) {
      const commits = await commitsRes.json();
      lastCommitAt = commits[0]?.commit?.committer?.date ?? null;
    }

    // 3. Commits in the last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekRes = await githubFetch(
      `/repos/${owner}/${repo}/commits?sha=${defaultBranch}&since=${since}&per_page=100`,
    );
    let commits7d: number | null = null;
    if (weekRes.ok) {
      const weekCommits = await weekRes.json();
      commits7d = Array.isArray(weekCommits) ? weekCommits.length : null;
    }

    const stats = {
      github_url: url,
      default_branch: defaultBranch,
      last_commit_at: lastCommitAt,
      commits_7d: commits7d,
      fetched_at: new Date().toISOString(),
    };

    // Upsert into Supabase cache
    if (db) {
      await db
        .from("github_stats")
        .upsert(stats, { onConflict: "github_url" });
    }

    return NextResponse.json({ data: stats }, { status: 200 });
  } catch (err) {
    console.error("GitHub fetch error:", err);
    if (cached) return NextResponse.json({ data: cached }, { status: 200 });
    return NextResponse.json({ data: null }, { status: 200 });
  }
}
