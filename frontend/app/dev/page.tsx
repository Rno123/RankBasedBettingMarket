"use client";

import { useState, useEffect } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Session } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import { getSupabase } from "@/lib/supabase";
import { useHackathons } from "@/hooks/useHackathons";
import { hackathonStatus, formatDate, timeUntil } from "@/lib/format";
import { getProgram } from "@/lib/program";
import { projectPdaFromUrl, hashUrl } from "@/lib/pda";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Sign in", "Connect wallet", "Submit project"];
  return (
    <div className="mb-8 flex items-start justify-center gap-0">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = current > n;
        const active = current === n;
        return (
          <div key={n} className="flex items-start">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-200 text-slate-400 dark:bg-white/[0.08] dark:text-slate-500"
                }`}
              >
                {done ? "✓" : n}
              </div>
              <span
                className={`mt-1 text-xs ${
                  active
                    ? "font-medium text-indigo-600 dark:text-indigo-400"
                    : done
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-slate-400"
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-3 mt-4 h-0.5 w-10 flex-shrink-0 ${
                  current > n ? "bg-emerald-400" : "bg-slate-200 dark:bg-white/[0.08]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Auth section ──────────────────────────────────────────────────────────────

function AuthSection({ onSession }: { onSession: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supabase = getSupabase();

  function authRedirectUrl(): string {
    const base =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
      (typeof window !== "undefined" ? window.location.origin : "");
    return `${base}/dev`;
  }

  async function signInEmail() {
    if (!supabase) { setErr("Auth not configured (missing Supabase env vars)"); return; }
    if (!email.trim()) { setErr("Enter an email address"); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  async function signInOAuth(provider: "google" | "twitter") {
    if (!supabase) { setErr("Auth not configured"); return; }
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: authRedirectUrl() },
    });
  }

  if (!supabase) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
        Supabase not configured. Add <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code className="font-mono text-xs">.env.local</code> to enable sign-in.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none">
      <h2 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">Sign in to submit</h2>
      <p className="mb-6 text-sm text-slate-500">Sign in to register your project and put skin in the game.</p>

      {/* OAuth */}
      <div className="mb-4 space-y-3">
        <button onClick={() => signInOAuth("google")} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.06]">
          <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>
        <button onClick={() => signInOAuth("twitter")} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.06]">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.264 5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Continue with X / Twitter
        </button>
      </div>

      <div className="mb-4 flex items-center gap-3 text-xs text-slate-400">
        <div className="flex-1 border-t border-slate-200 dark:border-white/[0.08]" />or<div className="flex-1 border-t border-slate-200 dark:border-white/[0.08]" />
      </div>

      {/* Email magic link */}
      {sent ? (
        <div className="rounded-xl bg-emerald-50 p-4 text-center text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
          Check your email — a sign-in link was sent to <strong>{email}</strong>.
        </div>
      ) : (
        <div className="space-y-2">
          <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && signInEmail()} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder-slate-600 dark:focus:border-indigo-500/50 dark:focus:ring-indigo-500/20" />
          <button onClick={signInEmail} disabled={busy} className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy ? "Sending…" : "Send magic link"}
          </button>
        </div>
      )}

      {err && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}

// ── Submission form for one hackathon ─────────────────────────────────────────

function SubmitForm({
  hackathonPubkey,
  hackathonName,
  onDone,
  authEmail,
}: {
  hackathonPubkey: PublicKey;
  hackathonName: string;
  onDone: () => void;
  authEmail: string;
}) {
  const { publicKey, signMessage } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [url, setUrl] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "onchain" | "saving" | "done">("idle");

  async function handleSubmit() {
    if (!publicKey || !anchorWallet) return;
    if (!url.startsWith("https://github.com/")) { setErr("URL must start with https://github.com/"); return; }
    if (url.length > 200) { setErr("URL too long (max 200 chars)"); return; }

    setErr(null); setBusy(true); setStep("onchain");
    let projectPk: PublicKey = await projectPdaFromUrl(hackathonPubkey, url);
    try {
      const program = getProgram(anchorWallet);
      const urlHashBytes = await hashUrl(url);
      const urlHash = Array.from(urlHashBytes);
      await (program.methods as any)
        .registerProject(url, urlHash)
        .accounts({ payer: publicKey, hackathon: hackathonPubkey, project: projectPk, systemProgram: SystemProgram.programId })
        .rpc();
    } catch (e: any) {
      const msg: string = e.message ?? "";
      const logs: string[] = e.logs ?? [];
      const alreadyInUse = msg.includes("already in use") || logs.some((l: string) => l.includes("already in use"));
      const alreadyProcessed = msg.includes("already been processed");
      if (!alreadyInUse && !alreadyProcessed) {
        setErr(msg || "On-chain registration failed");
        setBusy(false); setStep("idle"); return;
      }
      if (alreadyInUse) {
        setErr("This project is already registered for this hackathon.");
        setBusy(false); setStep("idle"); return;
      }
    }

    setStep("saving");
    const supabase = getSupabase();
    if (supabase) {
      let signature: string | undefined;
      if (signMessage) {
        try {
          const msg = new TextEncoder().encode(`hackbet:submit:${projectPk.toBase58()}`);
          const sig = await signMessage(msg);
          signature = Buffer.from(sig).toString("base64");
        } catch { /* skip if user denies */ }
      }

      const { error: sbErr } = await supabase.from("project_submissions").upsert({
        hackathon_pubkey: hackathonPubkey.toBase58(),
        project_pubkey: projectPk!.toBase58(),
        github_url: url,
        wallet_address: publicKey.toBase58(),
        twitter_handle: twitter.replace(/^@/, "") || null,
        telegram: telegram || null,
        discord: discord || null,
        auth_email: authEmail || null,
        status: "pending",
      }, { onConflict: "project_pubkey" });
      if (sbErr) {
        setErr("Submission saved on-chain but failed to record for review: " + sbErr.message);
        setBusy(false); return;
      }
    }

    setStep("done");
    setOk("Project submitted! The organizer will review your submission.");
    setBusy(false);
  }

  if (ok) {
    return (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
        <p className="font-medium text-emerald-800 dark:text-emerald-300">Submitted successfully!</p>
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">
          Your project is <strong>pending organizer review</strong>. Once approved it will appear on the hackathon page and backers can stake on it.
        </p>
        <button onClick={onDone} className="mt-2 text-xs text-emerald-600 underline hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300">Close</button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
      <p className="text-sm font-medium text-indigo-800 dark:text-indigo-300">Submit to: {hackathonName}</p>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">GitHub URL <span className="text-red-400">*</span></label>
        <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-400 focus:outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder-slate-600" placeholder="https://github.com/org/repo" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Twitter / X</label>
          <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white" placeholder="@handle" value={twitter} onChange={(e) => setTwitter(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Telegram</label>
          <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white" placeholder="t.me/…" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Discord</label>
          <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white" placeholder="discord.gg/…" value={discord} onChange={(e) => setDiscord(e.target.value)} />
        </div>
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={busy || !publicKey} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? (step === "onchain" ? "Registering on-chain…" : "Saving…") : "Submit project"}
        </button>
        <button onClick={onDone} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08]">Cancel</button>
      </div>
    </div>
  );
}

// ── Hackathon card for devs ────────────────────────────────────────────────────

function DevHackathonCard({ hackathon, authEmail }: { hackathon: ReturnType<typeof useHackathons>["hackathons"][0]; authEmail: string }) {
  const { publicKey } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const status = hackathonStatus(hackathon.resultsTimestamp, hackathon.cutoffTimestamp, hackathon.isResolved);

  if (status !== "open") return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{hackathon.name || hackathon.pubkey.toBase58().slice(0, 12) + "…"}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Results: {formatDate(hackathon.resultsTimestamp)} · Cutoff in {timeUntil(hackathon.cutoffTimestamp)}
          </p>
        </div>
        {!submitting && (
          <button
            onClick={() => setSubmitting(true)}
            disabled={!publicKey}
            className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            title={!publicKey ? "Connect wallet first" : undefined}
          >
            Submit project
          </button>
        )}
      </div>
      {submitting && (
        <SubmitForm
          hackathonPubkey={hackathon.pubkey}
          hackathonName={hackathon.name}
          onDone={() => setSubmitting(false)}
          authEmail={authEmail}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DevPortalPage() {
  const { publicKey } = useWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const { hackathons, loading: hLoading } = useHackathons();

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) { setSessionLoading(false); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      setSessionLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
  }

  const authEmail = session?.user?.email ?? session?.user?.user_metadata?.user_name ?? "";
  const openHackathons = hackathons.filter((h) => {
    const s = hackathonStatus(h.resultsTimestamp, h.cutoffTimestamp, h.isResolved);
    return s === "open";
  });

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">Dev Portal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Register your project for a hackathon. Backers stake real USDC on who they think will win — your project&apos;s backing is a public, on-chain conviction signal.
          </p>
        </div>

        {sessionLoading ? (
          <div className="h-48 animate-pulse rounded-2xl bg-slate-200 dark:bg-white/[0.04]" />
        ) : (
          <StepIndicator current={!session ? 1 : !publicKey ? 2 : 3} />
        )}

        {sessionLoading ? null : !session ? (
          <AuthSection onSession={setSession} />
        ) : (
          <div className="space-y-6">
            {/* Logged-in banner */}
            <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                Signed in as <strong>{authEmail || "wallet user"}</strong>
              </p>
              <button onClick={signOut} className="text-xs text-emerald-600 underline hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300">Sign out</button>
            </div>

            {/* Wallet connect */}
            {!publicKey && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none">
                <p className="text-sm text-slate-600 dark:text-slate-400">Connect your wallet to register a project on-chain.</p>
                <WalletMultiButton style={{ borderRadius: "12px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", fontSize: "13px" }} />
              </div>
            )}

            {/* Hackathon list */}
            {publicKey && (
              <div>
                <h2 className="mb-3 text-lg font-bold text-slate-900 dark:text-white">Open Hackathons</h2>
                {hLoading ? (
                  <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200 dark:bg-white/[0.04]" />)}</div>
                ) : openHackathons.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-400 dark:border-white/[0.08] dark:bg-transparent dark:text-slate-500">
                    No hackathons currently accepting project submissions.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {openHackathons.map((h) => (
                      <DevHackathonCard key={h.pubkey.toBase58()} hackathon={h} authEmail={authEmail} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
