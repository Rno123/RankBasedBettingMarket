"use client";

import { useState, useEffect } from "react";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, Connection } from "@solana/web3.js";
import { useWallet, useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import { getProgram, getReadonlyProgram } from "@/lib/program";
import { protocolAdminPda, whitelistPda } from "@/lib/pda";
import { useHackathons } from "@/hooks/useHackathons";
import { useIsProtocolAdmin } from "@/hooks/useIsProtocolAdmin";
import { clearAdminSessionCache, ensureAdminSession } from "@/lib/client-admin-auth";
import { PROGRAM_ID, PROTOCOL_ADMIN } from "@/lib/constants";

interface AdminApiAuth {
  ensureSession: (() => Promise<void>) | null;
  invalidateSession: (message?: string) => void;
  ready: boolean;
}

interface WhitelistRequest {
  id: string;
  hackathon_pubkey: string;
  wallet_address: string;
  email: string;
  notes?: string | null;
  status: string;
  created_at: string;
}

type HackathonEntry = ReturnType<typeof useHackathons>["hackathons"][number];

function getMasterProtocolAdminRemainingAccounts(publicKey: PublicKey | null) {
  if (!publicKey) return [];
  if (publicKey.toBase58() === PROTOCOL_ADMIN) return [];
  return [{
    pubkey: protocolAdminPda(publicKey),
    isWritable: false,
    isSigner: false,
  }];
}

async function ensureWalletWhitelistedOnHackathonMaster(
  program: any,
  admin: PublicKey,
  hackathonPubkey: PublicKey,
  hackathonAdmin: PublicKey,
  wallet: PublicKey,
  openStaking?: boolean,
) {
  if (openStaking) return;
  const whitelistEntry = whitelistPda(hackathonPubkey, wallet);
  try {
    await (program.methods as any)
      .whitelistWallet()
      .accounts({
        admin,
        hackathon: hackathonPubkey,
        wallet,
        whitelistEntry,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(getMasterProtocolAdminRemainingAccounts(admin))
      .rpc();
  } catch (e: any) {
    const text = e.message ?? "";
    if (!text.includes("already in use")) {
      throw e;
    }
  }
}

async function ensureWalletWhitelistedAcrossHackathonsMaster(
  program: any,
  admin: PublicKey,
  hackathons: Array<Pick<HackathonEntry, "pubkey" | "admin" | "openStaking">>,
  wallet: PublicKey,
) {
  for (const hackathon of hackathons) {
    await ensureWalletWhitelistedOnHackathonMaster(
      program,
      admin,
      hackathon.pubkey,
      hackathon.admin,
      wallet,
      hackathon.openStaking,
    );
  }
}

async function fetchApprovedWhitelistWalletsMaster(adminAuth: AdminApiAuth) {
  if (!adminAuth.ensureSession || !adminAuth.ready) return [] as string[];
  await adminAuth.ensureSession();
  const response = await fetch("/api/admin/whitelist-requests", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Failed to load approved stakers");
  return [...new Set(
    ((payload.data ?? []) as WhitelistRequest[])
      .filter((request) => request.status === "approved")
      .map((request) => request.wallet_address),
  )];
}

// ── Admin Delegation ──────────────────────────────────────────────────────────

function AdminDelegationPanel() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [newAdminInput, setNewAdminInput] = useState("");
  const [delegatedAdmins, setDelegatedAdmins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const isSuperAdmin = publicKey?.toBase58() === PROTOCOL_ADMIN;

  useEffect(() => {
    async function load() {
      try {
        const roProgram = getReadonlyProgram();
        const entries = await (roProgram.account as any).protocolAdminEntry.all();
        setDelegatedAdmins(entries.map((e: any) => (e.account.wallet ?? e.account.admin ?? e.publicKey).toBase58()));
      } catch { setDelegatedAdmins([]); }
      finally { setLoading(false); }
    }
    load();
  }, [ok]);

  async function addAdmin() {
    if (!publicKey || !anchorWallet) return;
    let wallet: PublicKey;
    try { wallet = new PublicKey(newAdminInput.trim()); } catch { setErr("Invalid public key"); return; }
    setBusy("add"); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const adminEntry = protocolAdminPda(wallet);
      await (program.methods as any).addProtocolAdmin().accounts({
        authority: publicKey,
        newAdmin: wallet,
        adminEntry,
        systemProgram: SystemProgram.programId,
      }).rpc();
      setOk(`Granted admin: ${wallet.toBase58().slice(0, 8)}…`);
      setNewAdminInput("");
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function removeAdmin(adminWallet: string) {
    if (!publicKey || !anchorWallet) return;
    const wallet = new PublicKey(adminWallet);
    setBusy(adminWallet); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      const adminEntry = protocolAdminPda(wallet);
      await (program.methods as any).removeProtocolAdmin().accounts({
        authority: publicKey,
        adminWallet: wallet,
        adminEntry,
      }).rpc();
      setOk(`Revoked admin: ${adminWallet.slice(0, 8)}…`);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Admin Delegation</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Grant or revoke protocol admin role. Only the super-admin (<code style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{PROTOCOL_ADMIN.slice(0, 8)}…</code>) can call this on-chain.
      </p>
      {!isSuperAdmin && (
        <div style={{ marginBottom: "16px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.875rem", color: "var(--c-amber-text)" }}>
          Connect the super-admin wallet to grant or revoke admins.
        </div>
      )}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input
          value={newAdminInput}
          onChange={(e) => { setNewAdminInput(e.target.value); setErr(null); }}
          placeholder="Wallet address to grant admin…"
          className="ui-input"
          style={{ flex: 1, fontFamily: "monospace" }}
          disabled={!isSuperAdmin}
        />
        <button onClick={addAdmin} disabled={busy === "add" || !isSuperAdmin || !newAdminInput.trim()} className="ui-btn ui-btn-indigo ui-btn-sm">
          {busy === "add" ? "…" : "Grant"}
        </button>
      </div>
      {err && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      <div>
        <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
          Delegated admins {loading ? "" : `(${delegatedAdmins.length})`}
        </p>
        {loading ? (
          <div className="ui-skeleton" style={{ height: "32px", borderRadius: "8px" }} />
        ) : delegatedAdmins.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No delegated admins.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {delegatedAdmins.map((addr) => (
              <div key={addr} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", borderRadius: "8px", border: "1px solid var(--c-divider)", padding: "8px 12px" }}>
                <code style={{ fontSize: "0.75rem", color: "var(--c-text-2)" }}>{addr}</code>
                <button
                  onClick={() => removeAdmin(addr)}
                  disabled={busy === addr || !isSuperAdmin}
                  className="ui-btn ui-btn-outline-red ui-btn-xs"
                >
                  {busy === addr ? "…" : "Revoke"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Global Whitelist Panel ─────────────────────────────────────────────────────

function GlobalWhitelistPanel({
  hackathons,
  adminAuth,
}: {
  hackathons: HackathonEntry[];
  adminAuth: AdminApiAuth;
}) {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [walletInput, setWalletInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [requests, setRequests] = useState<WhitelistRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestErr, setRequestErr] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRequests() {
      if (!adminAuth.ensureSession || !adminAuth.ready) {
        if (!cancelled) setRequests([]);
        if (!cancelled) setLoadingRequests(false);
        return;
      }

      setLoadingRequests(true);
      setRequestErr(null);
      try {
        const response = await fetch("/api/admin/whitelist-requests", { cache: "no-store" });
        if (response.status === 401) {
          adminAuth.invalidateSession();
          throw new Error("Admin session expired. Sign in again.");
        }
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Failed to load whitelist requests");
        if (!cancelled) setRequests((payload.data ?? []) as WhitelistRequest[]);
      } catch (e: any) {
        if (!cancelled) setRequestErr(e.message ?? "Failed to load whitelist requests");
      } finally {
        if (!cancelled) setLoadingRequests(false);
      }
    }

    void loadRequests();
    return () => { cancelled = true; };
  }, [publicKey?.toBase58(), adminAuth.ready, hackathons.length]);

  async function handleWhitelist() {
    if (!publicKey || !anchorWallet) return;
    let wallet: PublicKey;
    try { wallet = new PublicKey(walletInput.trim()); } catch { setErr("Invalid public key"); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const program = getProgram(anchorWallet);
      await ensureWalletWhitelistedAcrossHackathonsMaster(program, publicKey, hackathons, wallet);
      setOk(
        `Granted staking access across ${hackathons.length} hackathon${hackathons.length === 1 ? "" : "s"} for ${walletInput.trim().slice(0, 8)}…${walletInput.trim().slice(-4)}.`,
      );
      setWalletInput("");
      setRequests((current) =>
        current.map((request) =>
          request.wallet_address === wallet.toBase58() ? { ...request, status: "approved" } : request,
        ),
      );
    } catch (e: any) {
      setErr(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(request: WhitelistRequest, status: "approved" | "rejected") {
    if (!publicKey || !anchorWallet || !adminAuth.ensureSession) return;
    setRequestBusy(request.id);
    setRequestErr(null);
    try {
      if (status === "approved") {
        const wallet = new PublicKey(request.wallet_address);
        const program = getProgram(anchorWallet);
        await ensureWalletWhitelistedAcrossHackathonsMaster(program, publicKey, hackathons, wallet);
      }

      await adminAuth.ensureSession();
      const response = await fetch("/api/admin/whitelist-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: request.id, status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Failed to update whitelist request");

      setRequests((current) =>
        current.map((entry) =>
          entry.wallet_address === request.wallet_address ? { ...entry, status } : entry,
        ),
      );
    } catch (e: any) {
      setRequestErr(e.message ?? "Failed to update whitelist request");
    } finally {
      setRequestBusy(null);
    }
  }

  const pendingRequests = requests.filter((request) => request.status === "pending");
  const hackathonNameByPubkey = new Map(
    hackathons.map((hackathon) => [
      hackathon.pubkey.toBase58(),
      hackathon.name || `${hackathon.pubkey.toBase58().slice(0, 8)}…`,
    ]),
  );

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Global Staker Access</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Protocol admins can grant staking access across every current hackathon here. New hackathons inherit the same approved staker set when they are created.
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          value={walletInput}
          onChange={(e) => { setWalletInput(e.target.value); setErr(null); }}
          placeholder="Wallet address to whitelist globally…"
          className="ui-input"
          style={{ flex: 1, fontFamily: "monospace" }}
        />
        <button onClick={handleWhitelist} disabled={busy || !publicKey || !walletInput.trim()} className="ui-btn ui-btn-indigo ui-btn-sm">
          {busy ? "…" : "Grant access"}
        </button>
      </div>
      {err && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      <div style={{ marginTop: "16px" }}>
        <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
          Pending request queue
        </p>
        {loadingRequests ? (
          <div className="ui-skeleton" style={{ height: "56px", borderRadius: "10px" }} />
        ) : pendingRequests.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No pending staking access requests.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {pendingRequests.map((request) => (
              <div key={request.id} style={{ borderRadius: "10px", border: "1px solid var(--c-divider)", background: "var(--card-bg-alt)", padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <code style={{ fontSize: "0.75rem", color: "var(--c-text-2)" }}>{request.wallet_address}</code>
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-3)" }}>{request.email}</p>
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                      Requested from {hackathonNameByPubkey.get(request.hackathon_pubkey) ?? `${request.hackathon_pubkey.slice(0, 8)}…`}
                    </p>
                    {request.notes && <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{request.notes}</p>}
                    <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-text-4)" }}>{new Date(request.created_at).toLocaleString()}</p>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button
                      onClick={() => reviewRequest(request, "approved")}
                      disabled={requestBusy === request.id}
                      className="ui-btn ui-btn-emerald ui-btn-xs"
                    >
                      {requestBusy === request.id ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => reviewRequest(request, "rejected")}
                      disabled={requestBusy === request.id}
                      className="ui-btn ui-btn-outline-red ui-btn-xs"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {requestErr && <p style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{requestErr}</p>}
      </div>
    </section>
  );
}

// ── Advanced Panel Access ──────────────────────────────────────────────────────

function AdvancedAccessPanel({ adminAuth }: { adminAuth: AdminApiAuth }) {
  const { publicKey } = useWallet();
  const [wallets, setWallets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const isSuperAdmin = publicKey?.toBase58() === PROTOCOL_ADMIN;

  useEffect(() => {
    fetch("/api/admin/advanced-access")
      .then((r) => r.json())
      .then((payload) => setWallets(payload.wallets ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ok]);

  async function addWallet() {
    if (!adminAuth.ensureSession) return;
    setErr(null); setOk(null); setBusy("add");
    try {
      await adminAuth.ensureSession();
      const res = await fetch("/api/admin/advanced-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: input.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed");
      setOk(`Added ${input.trim().slice(0, 8)}…`);
      setInput("");
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  async function removeWallet(addr: string) {
    if (!adminAuth.ensureSession) return;
    setErr(null); setOk(null); setBusy(addr);
    try {
      await adminAuth.ensureSession();
      const res = await fetch("/api/admin/advanced-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: addr }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed");
      setOk(`Removed ${addr.slice(0, 8)}…`);
    } catch (e: any) { setErr(e.message ?? "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Advanced Panel Access</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Wallets on this list can access the Advanced tab in the Admin Panel. Only the super-admin can modify this list.
      </p>
      {!isSuperAdmin && (
        <div style={{ marginBottom: "16px", borderRadius: "8px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "10px 14px", fontSize: "0.875rem", color: "var(--c-amber-text)" }}>
          Connect the super-admin wallet to modify this list.
        </div>
      )}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value); setErr(null); }}
          placeholder="Wallet address to grant access…"
          className="ui-input"
          style={{ flex: 1, fontFamily: "monospace" }}
          disabled={!isSuperAdmin}
        />
        <button
          onClick={addWallet}
          disabled={busy === "add" || !isSuperAdmin || !input.trim()}
          className="ui-btn ui-btn-indigo ui-btn-sm"
        >
          {busy === "add" ? "…" : "Add"}
        </button>
      </div>
      {err && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
      {ok && <p style={{ marginBottom: "8px", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
      <div>
        <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>
          Allowed wallets {loading ? "" : `(${wallets.length})`}
        </p>
        {loading ? (
          <div className="ui-skeleton" style={{ height: "32px", borderRadius: "8px" }} />
        ) : wallets.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--c-text-4)" }}>No wallets on the access list.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {wallets.map((addr) => (
              <div key={addr} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", borderRadius: "8px", border: "1px solid var(--c-divider)", padding: "8px 12px" }}>
                <code style={{ fontSize: "0.75rem", color: "var(--c-text-2)" }}>{addr}</code>
                <button
                  onClick={() => removeWallet(addr)}
                  disabled={busy === addr || !isSuperAdmin}
                  className="ui-btn ui-btn-outline-red ui-btn-xs"
                >
                  {busy === addr ? "…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

function getProgramDataAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
}

function buildSetAuthorityIx(
  programData: PublicKey,
  currentAuthority: PublicKey,
  newAuthority: PublicKey | null,
): TransactionInstruction {
  const keys = [
    { pubkey: programData, isSigner: false, isWritable: true },
    { pubkey: currentAuthority, isSigner: true, isWritable: false },
  ];
  if (newAuthority) {
    keys.push({ pubkey: newAuthority, isSigner: false, isWritable: false });
  }
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE,
    keys,
    data: Buffer.from([4, 0, 0, 0]),
  });
}

async function readUpgradeAuthority(
  connection: Connection,
  programDataAddress: PublicKey,
): Promise<PublicKey | null> {
  const account = await connection.getAccountInfo(programDataAddress);
  if (!account || account.data.length < 45) return null;
  const opt = account.data[12];
  if (opt !== 1) return null;
  return new PublicKey(account.data.slice(13, 45));
}

// ── Transfer authority panel ───────────────────────────────────────────────────

function TransferAuthorityPanel({
  programDataAddress,
  onTransferred,
}: {
  programDataAddress: PublicKey;
  onTransferred: (newAuth: PublicKey) => void;
}) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [newAuthInput, setNewAuthInput] = useState("");
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function handleNext() {
    setErr(null);
    try { new PublicKey(newAuthInput.trim()); } catch { setErr("Invalid public key"); return; }
    setStep("confirm");
  }

  async function handleTransfer() {
    if (!publicKey) return;
    let newAuth: PublicKey;
    try { newAuth = new PublicKey(newAuthInput.trim()); } catch { setErr("Invalid public key"); return; }

    setBusy(true); setErr(null);
    try {
      const ix = buildSetAuthorityIx(programDataAddress, publicKey, newAuth);
      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Transferred. Tx: ${sig}`);
      setNewAuthInput("");
      setStep("idle");
      onTransferred(newAuth);
    } catch (e: any) {
      setErr(e.message ?? "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ui-card" style={{ padding: "24px" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-text)" }}>Transfer Upgrade Authority</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Hand deploy rights to a partner wallet. Once transferred, only that wallet can push new bytecode or revoke further.
      </p>

      {step === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" }}>New authority pubkey</label>
            <input
              value={newAuthInput}
              onChange={(e) => { setNewAuthInput(e.target.value); setErr(null); }}
              placeholder="Enter Solana wallet address…"
              className="ui-input"
              style={{ fontFamily: "monospace" }}
            />
          </div>
          {err && <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
          {ok && <p style={{ margin: 0, wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{ok}</p>}
          <button
            onClick={handleNext}
            disabled={!publicKey || !newAuthInput.trim()}
            className="ui-btn ui-btn-indigo ui-btn-sm"
          >
            Review transfer →
          </button>
        </div>
      )}

      {step === "confirm" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "16px" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--c-amber-text)" }}>Confirm transfer</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--c-amber-text)" }}>
              You are transferring upgrade authority for program <span style={{ fontFamily: "monospace" }}>{PROGRAM_ID.toBase58()}</span> to:
            </p>
            <p style={{ margin: "8px 0 0", wordBreak: "break-all", borderRadius: "8px", background: "var(--card-bg)", padding: "8px 12px", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-text)" }}>
              {newAuthInput.trim()}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "var(--c-amber-text)" }}>
              The recipient will have full deploy rights. Your wallet will lose them immediately.
            </p>
          </div>
          {err && <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={() => { setStep("idle"); setErr(null); }} className="ui-btn ui-btn-outline ui-btn-sm">← Back</button>
            <button onClick={handleTransfer} disabled={busy || !publicKey} className="ui-btn ui-btn-amber ui-btn-sm">
              {busy ? "Sending…" : "Confirm transfer"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Revoke authority panel ─────────────────────────────────────────────────────

function RevokeAuthorityPanel({ programDataAddress }: { programDataAddress: PublicKey }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const confirmed = typed === "REVOKE";

  async function handleRevoke() {
    if (!publicKey || !confirmed) return;
    setBusy(true); setErr(null);
    try {
      const ix = buildSetAuthorityIx(programDataAddress, publicKey, null);
      const tx = new Transaction().add(ix);
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setOk(`Authority revoked. Program is now immutable. Tx: ${sig}`);
      setTyped("");
    } catch (e: any) {
      setErr(e.message ?? "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ borderRadius: "16px", border: "1px solid var(--c-red-border)", background: "var(--card-bg)", padding: "24px", boxShadow: "var(--card-shadow)" }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "1.125rem", fontWeight: 700, color: "var(--c-red-text)" }}>Revoke Upgrade Authority</h2>
      <p style={{ margin: "0 0 16px", fontSize: "0.875rem", color: "var(--c-text-3)" }}>
        Permanently remove the upgrade authority. The program bytecode will be frozen forever — no further code changes are possible by anyone.
      </p>

      <div style={{ marginBottom: "16px", borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px" }}>
        <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "var(--c-red-text)" }}>This action is irreversible.</p>
        <ul style={{ margin: "8px 0 0", paddingLeft: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.75rem", color: "var(--c-red-text)" }}>
          <li>— No one will be able to upgrade this program, ever.</li>
          <li>— No bug fixes, no feature additions, no emergency patches.</li>
          <li>— Only do this when the protocol is fully audited and stable.</li>
        </ul>
      </div>

      {ok ? (
        <p style={{ wordBreak: "break-all", borderRadius: "12px", background: "var(--c-emerald-light)", padding: "12px", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-emerald-text)" }}>{ok}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.75rem", fontWeight: 500, color: "var(--c-text-3)" }}>
              Type <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--c-red-text)" }}>REVOKE</span> to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="REVOKE"
              className="ui-input"
              style={{ fontFamily: "monospace", borderColor: "var(--c-red-border)" }}
            />
          </div>
          {err && <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-red-text)" }}>{err}</p>}
          <button
            onClick={handleRevoke}
            disabled={!confirmed || busy || !publicKey}
            className="ui-btn ui-btn-red ui-btn-sm"
          >
            {busy ? "Sending…" : "Permanently revoke authority"}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function MasterPage() {
  const { publicKey, signMessage } = useWallet();
  const { connection } = useConnection();
  const { hackathons } = useHackathons();
  const { isProtocolAdmin, isSuperAdmin } = useIsProtocolAdmin(publicKey ?? null);

  const [programDataAddress] = useState(getProgramDataAddress);
  const [currentAuthority, setCurrentAuthority] = useState<PublicKey | null | undefined>(undefined);
  const [loadingAuthority, setLoadingAuthority] = useState(true);

  // Admin session state (mirrors admin page pattern)
  const [adminSessionReady, setAdminSessionReady] = useState(false);
  const [adminSessionBusy, setAdminSessionBusy] = useState(false);
  const [adminSessionErr, setAdminSessionErr] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoadingAuthority(true);
      try {
        const auth = await readUpgradeAuthority(connection, programDataAddress);
        setCurrentAuthority(auth);
      } catch {
        setCurrentAuthority(null);
      } finally {
        setLoadingAuthority(false);
      }
    }
    load();
  }, [connection, programDataAddress]);

  useEffect(() => {
    let cancelled = false;
    clearAdminSessionCache();
    setAdminSessionReady(false);
    setAdminSessionErr(null);

    async function loadExistingSession() {
      if (!publicKey || !signMessage || !isProtocolAdmin) return;
      try {
        const response = await fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const payload = await response.json() as { wallet_address?: string };
        if (payload.wallet_address !== publicKey.toBase58()) {
          await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
          return;
        }
        if (!cancelled) setAdminSessionReady(true);
      } catch {
        if (!cancelled) setAdminSessionReady(false);
      }
    }

    void loadExistingSession();
    return () => { cancelled = true; };
  }, [publicKey?.toBase58(), Boolean(signMessage), isProtocolAdmin]);

  async function startAdminSession() {
    if (!signMessage || !publicKey) {
      throw new Error("Your wallet must support message signing to review requests");
    }
    await ensureAdminSession(signMessage, publicKey);
  }

  function invalidateAdminSession(message = "Admin session expired. Sign in again.") {
    clearAdminSessionCache();
    setAdminSessionReady(false);
    setAdminSessionBusy(false);
    setAdminSessionErr(message);
    void fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
  }

  async function handleAdminSignIn() {
    setAdminSessionBusy(true);
    setAdminSessionErr(null);
    try {
      await startAdminSession();
      setAdminSessionReady(true);
    } catch (e: any) {
      setAdminSessionReady(false);
      setAdminSessionErr(e?.message ?? "Failed to sign in as admin");
    } finally {
      setAdminSessionBusy(false);
    }
  }

  const adminAuth: AdminApiAuth = {
    ensureSession: publicKey && signMessage ? startAdminSession : null,
    invalidateSession: invalidateAdminSession,
    ready: adminSessionReady,
  };

  const isImmutable = currentAuthority === null && !loadingAuthority;
  const isDeployer =
    !loadingAuthority &&
    currentAuthority !== null &&
    publicKey?.toBase58() === currentAuthority?.toBase58();

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main style={{ margin: "0 auto", maxWidth: "768px", padding: "40px 16px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ margin: 0, fontSize: "1.875rem", fontWeight: 800, color: "var(--c-text)" }}>Master Panel</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-text-3)" }}>Program upgrade authority management.</p>
          {!loadingAuthority && !isImmutable && !isDeployer && (
            <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid var(--c-red-border)", background: "var(--c-red-light)", padding: "16px", fontSize: "0.875rem", color: "var(--c-red-text)" }}>
              Transfer and revoke controls are only available to the current upgrade authority.
            </div>
          )}
        </div>

        {/* Authority status card */}
        <div className="ui-card" style={{ marginBottom: "24px", padding: "20px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Program Authority Status</h2>
          <div className="grid-auto-2" style={{ gap: "12px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Program ID</p>
              <p style={{ margin: "2px 0 0", wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-text-2)" }}>{PROGRAM_ID.toBase58()}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Program data account</p>
              <p style={{ margin: "2px 0 0", wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-text-2)" }}>{programDataAddress.toBase58()}</p>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <p style={{ margin: 0, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--c-text-4)" }}>Current upgrade authority</p>
              {loadingAuthority ? (
                <div className="ui-skeleton" style={{ marginTop: "4px", height: "16px", width: "256px" }} />
              ) : isImmutable ? (
                <span style={{ marginTop: "4px", display: "inline-flex", alignItems: "center", gap: "6px", borderRadius: "9999px", background: "var(--c-emerald-light)", padding: "4px 12px", fontSize: "0.75rem", fontWeight: 600, color: "var(--c-emerald-text)" }}>
                  Immutable — no upgrade authority
                </span>
              ) : (
                <p style={{ margin: "2px 0 0", wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.75rem", color: "var(--c-text-2)" }}>{currentAuthority?.toBase58()}</p>
              )}
            </div>
          </div>
        </div>

        {isDeployer && !isImmutable && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <TransferAuthorityPanel
              programDataAddress={programDataAddress}
              onTransferred={(newAuth) => setCurrentAuthority(newAuth)}
            />
            <RevokeAuthorityPanel programDataAddress={programDataAddress} />
          </div>
        )}

        {isImmutable && (
          <div style={{ borderRadius: "16px", border: "1px solid var(--c-emerald-border)", background: "var(--c-emerald-light)", padding: "24px", textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--c-emerald-text)" }}>Program is immutable</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "var(--c-emerald-text)" }}>
              No upgrade authority exists. The bytecode is permanently frozen.
            </p>
          </div>
        )}

        {/* Admin sign-in banner */}
        {isProtocolAdmin && !adminSessionReady && (
          <div style={{ marginTop: "24px", borderRadius: "12px", border: "1px solid var(--c-amber-border)", background: "var(--c-amber-light)", padding: "16px" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--c-amber-text)" }}>
              Sign in as admin to manage staker access and delegation. This signature does not cost gas.
            </p>
            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <button
                onClick={() => void handleAdminSignIn()}
                disabled={adminSessionBusy || !signMessage}
                className="ui-btn ui-btn-indigo ui-btn-sm"
              >
                {adminSessionBusy ? "Waiting for signature..." : "Sign In As Admin"}
              </button>
              {!signMessage && (
                <span style={{ fontSize: "0.75rem", color: "var(--c-text-4)" }}>
                  This wallet must support message signing.
                </span>
              )}
            </div>
            {adminSessionErr && (
              <p style={{ margin: "10px 0 0", fontSize: "0.8125rem", color: "var(--c-red-text)" }}>
                {adminSessionErr}
              </p>
            )}
          </div>
        )}

        {/* Admin delegation — super-admin only */}
        {isSuperAdmin && (
          <div style={{ marginTop: "24px" }}>
            <AdminDelegationPanel />
          </div>
        )}

        {/* Global staker access — protocol admin with active session */}
        {isProtocolAdmin && adminSessionReady && (
          <div style={{ marginTop: "24px" }}>
            <GlobalWhitelistPanel hackathons={hackathons} adminAuth={adminAuth} />
          </div>
        )}

        {/* Advanced panel access — super-admin with active session */}
        {isSuperAdmin && adminSessionReady && (
          <div style={{ marginTop: "24px" }}>
            <AdvancedAccessPanel adminAuth={adminAuth} />
          </div>
        )}
      </main>
    </div>
  );
}
