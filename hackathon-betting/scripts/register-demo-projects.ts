/**
 * Register demo projects on the Superteam Singapore Demo Day hackathon.
 *
 * Hackathon: aiNqNxPfVxtpXaeV8sWdr6pKUjFYfCyU7ndX4cRHZaw ("Superteam Singapore Demo Day")
 * Results:   2026-05-02T10:00:00Z
 *
 * Usage:
 *   npx ts-node scripts/register-demo-projects.ts \
 *     --wallet ~/frontier-deployment/deploy-wallet.json
 *
 * Customize DEMO_PROJECTS below before running.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const PROGRAM_ID  = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");
const RPC_URL     = "https://api.devnet.solana.com";
const HACKATHON   = new PublicKey("aiNqNxPfVxtpXaeV8sWdr6pKUjFYfCyU7ndX4cRHZaw");

// register_project discriminator (from on-chain IDL)
const DISCRIMINATOR = Buffer.from([130, 150, 121, 216, 183, 225, 243, 192]);

// ── Demo projects ─────────────────────────────────────────────────────────────
// Customize these URLs before running. Each URL must be unique — it seeds the PDA.

const DEMO_PROJECTS: string[] = [
  "https://github.com/superteam-sg/solana-micropayments",
  "https://github.com/superteam-sg/defi-yield-optimizer",
  "https://github.com/superteam-sg/nft-event-ticketing",
  "https://github.com/superteam-sg/on-chain-credit-score",
  "https://github.com/superteam-sg/dao-governance-toolkit",
  "https://github.com/superteam-sg/ai-liquidity-agent",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function urlHash(url: string): Buffer {
  return createHash("sha256").update(url).digest();
}

function projectPda(hackathon: PublicKey, hash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), hash],
    PROGRAM_ID,
  )[0];
}

/** Encode register_project instruction data (borsh layout). */
function encodeRegisterProject(url: string, hash: Buffer): Buffer {
  const urlBytes = Buffer.from(url, "utf8");
  const lenBuf   = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32LE(urlBytes.length, 0);
  return Buffer.concat([DISCRIMINATOR, lenBuf, urlBytes, hash]);
}

async function sendAndConfirm(
  conn: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string,
): Promise<string> {
  const bh  = (await conn.getLatestBlockhash()).blockhash;
  tx.recentBlockhash = bh;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, "confirmed");
  log(`  ✔ ${label}: ${sig}`);
  return sig;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const walletArg =
    process.argv.find((a) => a.startsWith("--wallet="))?.slice("--wallet=".length) ??
    process.argv[process.argv.indexOf("--wallet") + 1];
  if (!walletArg) {
    console.error("Usage: ts-node scripts/register-demo-projects.ts --wallet <path>");
    process.exit(1);
  }

  const walletPath = walletArg.replace("~", process.env.HOME ?? "");
  const payer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))),
  );
  log(`Payer: ${payer.publicKey.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");
  const sol  = await conn.getBalance(payer.publicKey);
  log(`SOL balance: ${(sol / LAMPORTS_PER_SOL).toFixed(3)} SOL`);

  if (sol < 0.05 * LAMPORTS_PER_SOL) {
    console.error("Need at least 0.05 SOL.");
    process.exit(1);
  }

  log(`\nHackathon: ${HACKATHON.toBase58()}`);
  log(`Projects to register: ${DEMO_PROJECTS.length}`);

  const registered: Array<{ url: string; project: string }> = [];
  const skipped:    Array<{ url: string; reason: string }>    = [];

  for (const url of DEMO_PROJECTS) {
    const hash    = urlHash(url);
    const project = projectPda(HACKATHON, hash);

    // Check if already registered
    const existing = await conn.getAccountInfo(project);
    if (existing) {
      log(`  → skip (already exists): ${url}`);
      skipped.push({ url, reason: "already registered" });
      continue;
    }

    const data = encodeRegisterProject(url, hash);
    const ix   = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true,  isWritable: true },
        { pubkey: HACKATHON,       isSigner: false, isWritable: false },
        { pubkey: project,         isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    try {
      await sendAndConfirm(conn, new Transaction().add(ix), [payer], `register ${url}`);
      registered.push({ url, project: project.toBase58() });
      log(`     project PDA: ${project.toBase58()}`);
    } catch (e: any) {
      log(`  ✗ FAILED: ${url} — ${e.message ?? e}`);
      skipped.push({ url, reason: e.message ?? String(e) });
    }
  }

  log("\n── Summary ──────────────────────────────────────────────────────────────");
  log(`Registered (${registered.length}):`);
  for (const r of registered) log(`  ${r.project} ← ${r.url}`);
  if (skipped.length) {
    log(`Skipped (${skipped.length}):`);
    for (const s of skipped) log(`  ${s.url} — ${s.reason}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
