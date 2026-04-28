/**
 * seed-demo.ts — registers sample projects for a test hackathon on devnet.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/seed-demo.ts <hackathon-pubkey>
 *
 * Requires: ~/.config/solana/id.json (local Solana keypair, funded on devnet)
 *
 * Each sample project is registered with a unique GitHub URL. The wallet
 * running this script must be authorized to manage the hackathon and also
 * becomes the builder_wallet for each seeded project.
 */

import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

const RPC_URL = "https://devnet.helius-rpc.com/?api-key=5ca80e05-7f74-4f2b-899b-1579d7dce52d";
const PROGRAM_ID = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");

const SAMPLE_REPOS = [
  "https://github.com/solana-labs/solana-program-library",
  "https://github.com/coral-xyz/anchor",
  "https://github.com/metaplex-foundation/metaplex",
  "https://github.com/orca-so/whirlpools",
  "https://github.com/marinade-finance/marinade-ts-sdk",
  "https://github.com/drift-labs/protocol-v2",
];

async function hashUrl(url: string): Promise<Buffer> {
  return crypto.createHash("sha256").update(url).digest();
}

async function projectPda(hackathon: PublicKey, url: string): Promise<PublicKey> {
  const urlHash = await hashUrl(url);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), urlHash],
    PROGRAM_ID,
  );
  return pda;
}

async function main() {
  const hackathonArg = process.argv[2];
  if (!hackathonArg) {
    console.error("Usage: npx ts-node scripts/seed-demo.ts <hackathon-pubkey>");
    process.exit(1);
  }

  const hackathonPk = new PublicKey(hackathonArg);
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Hackathon:", hackathonPk.toBase58());

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const idlPath = path.join(__dirname, "../lib/hackathon_betting.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  for (const url of SAMPLE_REPOS) {
    const projectPk = await projectPda(hackathonPk, url);
    const urlHashBytes = await hashUrl(url);
    const urlHash = Array.from(urlHashBytes);

    try {
      await (program.methods as any)
        .registerProject(url, urlHash)
        .accounts({
          admin: payer.publicKey,
          builder: payer.publicKey,
          hackathon: hackathonPk,
          project: projectPk,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`✓ Registered: ${url.replace("https://github.com/", "")}  →  ${projectPk.toBase58()}`);
    } catch (e: any) {
      const msg: string = e.message ?? "";
      if (msg.includes("already in use")) {
        console.log(`↩ Already exists: ${url.replace("https://github.com/", "")}`);
      } else {
        console.error(`✗ Failed: ${url}`, e.message);
      }
    }
  }

  console.log("\nDone. Reload the dashboard to see the projects.");
}

main().catch((e) => { console.error(e); process.exit(1); });
