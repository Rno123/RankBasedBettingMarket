"use client";

import { useState, useEffect } from "react";
import { PublicKey, Transaction, TransactionInstruction, Connection } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import { PROGRAM_ID } from "@/lib/constants";

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
  const { publicKey } = useWallet();
  const { connection } = useConnection();

  const [programDataAddress] = useState(getProgramDataAddress);
  const [currentAuthority, setCurrentAuthority] = useState<PublicKey | null | undefined>(undefined);
  const [loadingAuthority, setLoadingAuthority] = useState(true);

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
      </main>
    </div>
  );
}
