/**
 * Migrate old ProjectAccount accounts (256-byte layout) to new 324-byte layout.
 *
 * Usage:
 *   npx ts-node --skipProject scripts/migrate-projects.ts \
 *     --wallet ~/frontier-deployment/deploy-wallet.json
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Wallet, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");

const OLD_PROJECTS = [
  "CKVdduMi95HtEQXdzTnrTmdCwEKMya67azwimx9sWopK",
  "FR5878WDPQ2qhb9EbLMPfNjrymGxd11dxL12NVWfcQYc",
  "GvoaeMhugEpezheKFGdNREtXTgDsttTrP4ELwj7YHsYD",
  "HpyChRG98k24tD1TysE7HPUJD2n6UsXadQb81RGgiV5E",
];

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function main() {
  const walletArg =
    process.argv.find((a) => a.startsWith("--wallet="))?.slice("--wallet=".length) ??
    process.argv[process.argv.indexOf("--wallet") + 1];
  if (!walletArg) { console.error("--wallet required"); process.exit(1); }

  const walletPath = walletArg.replace("~", process.env.HOME ?? "");
  const kp = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  log(`Payer: ${kp.publicKey.toBase58()}`);

  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const IDL = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/hackathon_betting.json"), "utf-8"));
  const program = new Program(IDL, provider) as any;

  for (const addr of OLD_PROJECTS) {
    const project = new PublicKey(addr);
    const info = await conn.getAccountInfo(project);
    if (!info) { log(`skip ${addr.slice(0,8)}…: not found`); continue; }
    const size = info.data.length;
    if (size === 324) { log(`skip ${addr.slice(0,8)}…: already 324 bytes`); continue; }
    if (size !== 256 && size !== 288) {
      log(`skip ${addr.slice(0,8)}…: unexpected size ${size}`);
      continue;
    }

    const methodName = size === 256 ? "migrateProjectV1" : "migrateProjectV2";
    log(`migrating ${addr}  (${size} → 324 bytes, ${methodName})`);
    try {
      const sig = await (program.methods as any)[methodName]()
        .accounts({ payer: kp.publicKey, project, systemProgram: SystemProgram.programId })
        .rpc();
      const after = await conn.getAccountInfo(project);
      log(`  ✔ ${sig.slice(0,24)}…  → ${after?.data.length} bytes`);
    } catch (e: any) {
      const logs = typeof e.getLogs === "function" ? await e.getLogs() : e.logs;
      log(`  ✗ FAILED: ${e.message}`);
      if (logs?.length) log(`  logs: ${logs.join("\n  ")}`);
    }
  }
  log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
