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

// BPF loader SetAuthority instruction (variant 4, bincode u32 LE).
// newAuthority = null → revoke (program becomes immutable).
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
    data: Buffer.from([4, 0, 0, 0]), // SetAuthority = variant 4
  });
}

async function readUpgradeAuthority(
  connection: Connection,
  programDataAddress: PublicKey,
): Promise<PublicKey | null> {
  const account = await connection.getAccountInfo(programDataAddress);
  if (!account || account.data.length < 45) return null;
  // ProgramData layout: [u32 discriminator=3][u64 slot][u8 option][32 bytes pubkey?]
  const opt = account.data[12];
  if (opt !== 1) return null; // None = already immutable
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
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none">
      <h2 className="mb-1 text-lg font-bold text-slate-900 dark:text-white">Transfer Upgrade Authority</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Hand deploy rights to a partner wallet. Once transferred, only that wallet can push new bytecode or revoke further.
      </p>

      {step === "idle" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">New authority pubkey</label>
            <input
              value={newAuthInput}
              onChange={(e) => { setNewAuthInput(e.target.value); setErr(null); }}
              placeholder="Enter Solana wallet address…"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-indigo-400 focus:outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white"
            />
          </div>
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          {ok && <p className="break-all font-mono text-xs text-emerald-600 dark:text-emerald-400">{ok}</p>}
          <button
            onClick={handleNext}
            disabled={!publicKey || !newAuthInput.trim()}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Review transfer →
          </button>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Confirm transfer</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              You are transferring upgrade authority for program <span className="font-mono">{PROGRAM_ID.toBase58()}</span> to:
            </p>
            <p className="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-900 dark:bg-white/[0.06] dark:text-white">
              {newAuthInput.trim()}
            </p>
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
              The recipient will have full deploy rights. Your wallet will lose them immediately.
            </p>
          </div>
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex gap-3">
            <button onClick={() => { setStep("idle"); setErr(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-white/[0.08] dark:text-slate-400 dark:hover:bg-white/[0.06]">← Back</button>
            <button onClick={handleTransfer} disabled={busy || !publicKey} className="rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
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
    <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-500/20 dark:bg-white/[0.03] dark:shadow-none">
      <h2 className="mb-1 text-lg font-bold text-red-700 dark:text-red-400">Revoke Upgrade Authority</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Permanently remove the upgrade authority. The program bytecode will be frozen forever — no further code changes are possible by anyone.
      </p>

      <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/10">
        <p className="text-sm font-bold text-red-700 dark:text-red-400">This action is irreversible.</p>
        <ul className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-400">
          <li>— No one will be able to upgrade this program, ever.</li>
          <li>— No bug fixes, no feature additions, no emergency patches.</li>
          <li>— Only do this when the protocol is fully audited and stable.</li>
        </ul>
      </div>

      {ok ? (
        <p className="break-all rounded-xl bg-emerald-50 p-3 font-mono text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{ok}</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Type <span className="font-mono font-bold text-red-600 dark:text-red-400">REVOKE</span> to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="REVOKE"
              className="w-full rounded-xl border border-red-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-red-500 focus:outline-none dark:border-red-500/30 dark:bg-white/[0.04] dark:text-white"
            />
          </div>
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          <button
            onClick={handleRevoke}
            disabled={!confirmed || busy || !publicKey}
            className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
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
  // Gate on the actual on-chain upgrade authority, not PROTOCOL_ADMIN.
  // Only the wallet that currently holds BPF upgrade rights can transfer/revoke.
  const isDeployer =
    !loadingAuthority &&
    currentAuthority !== null &&
    publicKey?.toBase58() === currentAuthority?.toBase58();

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">Master Panel</h1>
          <p className="mt-1 text-sm text-slate-500">Program upgrade authority management.</p>
          {!loadingAuthority && !isImmutable && !isDeployer && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
              Transfer and revoke controls are only available to the current upgrade authority.
            </div>
          )}
        </div>

        {/* Authority status card — always visible */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.03] dark:shadow-none">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Program Authority Status</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Program ID</p>
              <p className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{PROGRAM_ID.toBase58()}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Program data account</p>
              <p className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{programDataAddress.toBase58()}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wider text-slate-400 dark:text-slate-600">Current upgrade authority</p>
              {loadingAuthority ? (
                <div className="mt-1 h-4 w-64 animate-pulse rounded bg-slate-200 dark:bg-white/[0.06]" />
              ) : isImmutable ? (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-1 dark:ring-emerald-500/20">
                  Immutable — no upgrade authority
                </span>
              ) : (
                <p className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{currentAuthority?.toBase58()}</p>
              )}
            </div>
          </div>
        </div>

        {isDeployer && !isImmutable && (
          <div className="space-y-6">
            <TransferAuthorityPanel
              programDataAddress={programDataAddress}
              onTransferred={(newAuth) => setCurrentAuthority(newAuth)}
            />
            <RevokeAuthorityPanel programDataAddress={programDataAddress} />
          </div>
        )}

        {isImmutable && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-500/20 dark:bg-emerald-500/10">
            <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">Program is immutable</p>
            <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-500">
              No upgrade authority exists. The bytecode is permanently frozen.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
