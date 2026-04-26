/**
 * Migrate old HackathonState accounts (186-byte layout) to the current
 * 237-byte layout by calling the new migrate_hackathon_v1 instruction.
 *
 * Usage:
 *   npx ts-node --skipProject scripts/migrate-hackathons.ts \
 *     --wallet ~/frontier-deployment/deploy-wallet.json
 */

import * as anchor from "@coral-xyz/anchor";
import { BN, Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");
const RPC_URL    = "https://api.devnet.solana.com";

// All 186-byte program accounts (potential old hackathons)
const OLD_HACKATHONS = [
  "CRfsGf1SvtVy1trxtN1nkGXXzhb9FDmnahojZGMN5Vi3",
  "aiNqNxPfVxtpXaeV8sWdr6pKUjFYfCyU7ndX4cRHZaw",
  "Au9Ta1Jdfdo9UMo2ezvfDWcWHxduDTnE5ibhUa5WF2eA",
  "HUdDUdYS4SKq1a3PfKtukQ2ys4B2nJYqkEhkZ1TkMES7",
];

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function main() {
  const walletArg =
    process.argv.find((a) => a.startsWith("--wallet="))?.slice("--wallet=".length) ??
    process.argv[process.argv.indexOf("--wallet") + 1];
  if (!walletArg) {
    console.error("Usage: ts-node --skipProject scripts/migrate-hackathons.ts --wallet <path>");
    process.exit(1);
  }

  const walletPath = walletArg.replace("~", process.env.HOME ?? "");
  const payerKp = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))),
  );
  log(`Payer: ${payerKp.publicKey.toBase58()}`);

  const conn     = new Connection(RPC_URL, "confirmed");
  const wallet   = new Wallet(payerKp);
  const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idlPath = path.join(__dirname, "../target/idl/hackathon_betting.json");
  const IDL     = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program  = new Program(IDL, provider) as any;

  for (const addr of OLD_HACKATHONS) {
    const hackathon = new PublicKey(addr);
    const info = await conn.getAccountInfo(hackathon);
    if (!info) { log(`  skip ${addr.slice(0,8)}…: not found`); continue; }
    if (info.data.length !== 186) {
      log(`  skip ${addr.slice(0,8)}…: already ${info.data.length} bytes (no migration needed)`);
      continue;
    }

    log(`  migrating ${addr}  (${info.data.length} → 237 bytes)`);
    try {
      const sig = await program.methods
        .migrateHackathonV1()
        .accounts({
          payer: payerKp.publicKey,
          hackathon,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      log(`  ✔ migrated: ${sig}`);

      const after = await conn.getAccountInfo(hackathon);
      log(`  new size: ${after?.data.length} bytes`);
    } catch (e: any) {
      const logs = typeof e.getLogs === "function" ? await e.getLogs() : e.logs;
      log(`  ✗ FAILED: ${e.message}`);
      if (logs?.length) log(`  logs: ${logs.join("\n  ")}`);
    }
  }

  log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
