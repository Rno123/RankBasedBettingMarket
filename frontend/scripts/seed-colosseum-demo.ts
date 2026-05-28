/**
 * Seeds "Colosseum Frontier Demo 2026" hackathon with 5 projects, no stakes.
 * Usage: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/seed-colosseum-demo.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { BN, Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PROGRAM_ID = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");
const USDC_MINT = new PublicKey("9sGNYYMokaUVsa1dEEqiPV4DYT2wABt1BcX6FHqVZF15");
const RPC_URL = "https://solana-devnet.core.chainstack.com/9e97c8b2f2ab98524cb7057c9e1a512e";

const HACKATHON_NAME = "Colosseum Frontier Demo 2026";
const PROJECTS = [
  "https://github.com/colosseum-demo/solana-ai-agent",
  "https://github.com/colosseum-demo/defi-yield-optimizer",
  "https://github.com/colosseum-demo/nft-marketplace-v2",
  "https://github.com/colosseum-demo/cross-chain-bridge",
  "https://github.com/colosseum-demo/dao-governance-sdk",
];

function hackathonPda(admin: PublicKey, name: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("hackathon"), admin.toBuffer(), Buffer.from(name)], PROGRAM_ID)[0];
}
function escrowPda(hackathon: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), hackathon.toBuffer()], PROGRAM_ID)[0];
}
function projectPda(hackathon: PublicKey, url: string) {
  const hash = createHash("sha256").update(url).digest();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), hash], PROGRAM_ID)[0];
}

async function main() {
  const walletPath = process.argv[2] || path.join(os.homedir(), ".config", "solana", "id.json");
  const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  const wallet = new Wallet(keypair);
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(require("../lib/hackathon_betting.json"), provider) as any;

  const admin = wallet.publicKey;
  console.log(`Admin: ${admin.toBase58()}`);

  const now = Math.floor(Date.now() / 1000);
  const deadline = now + 21 * 86400; // 21 days

  // ── Create hackathon ──
  const hackathonPk = hackathonPda(admin, HACKATHON_NAME);
  const escrowPk = escrowPda(hackathonPk);
  const existing = await connection.getAccountInfo(hackathonPk);

  if (existing) {
    console.log(`Hackathon already exists: ${hackathonPk.toBase58()}`);
  } else {
    const tx = await program.methods.initializeHackathon(
      HACKATHON_NAME,
      new BN(deadline),
      Buffer.from([35, 25, 20, 20]),   // tier pcts
      Buffer.from([1, 3, 5, 0]),        // tier expected counts
      admin,
      150,                              // fee bps
      new BN(10_000_000),               // $10 deposit
      false,                            // requires_approval
      true,                             // open_staking
    ).accounts({
      admin, hackathon: hackathonPk, escrow: escrowPk,
      usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).transaction();
    await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
    console.log(`✓ Created: ${HACKATHON_NAME}`);
    console.log(`  PDA: ${hackathonPk.toBase58()}`);
  }

  // ── Register projects ──
  const adminAta = getAssociatedTokenAddressSync(USDC_MINT, admin);
  const adminAtaInfo = await connection.getAccountInfo(adminAta);
  if (!adminAtaInfo) {
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(admin, adminAta, admin, USDC_MINT),
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [wallet.payer], { commitment: "confirmed" });
  }

  console.log("\nRegistering projects...");
  for (const url of PROJECTS) {
    const projectPk = projectPda(hackathonPk, url);
    const existingProject = await connection.getAccountInfo(projectPk);
    if (existingProject) {
      console.log(`  (already exists) ${url}`);
      continue;
    }
    const hash = createHash("sha256").update(url).digest();
    const tx = await program.methods.registerProject(url, Array.from(hash)).accounts({
      caller: admin, builder: admin, hackathon: hackathonPk,
      project: projectPk, systemProgram: SystemProgram.programId,
    }).transaction();
    await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
    console.log(`  ✓ ${url}`);

    // Pay deposit
    try {
      const depositTx = await program.methods.payDeposit().accounts({
        builder: admin, hackathon: hackathonPk, project: projectPk,
        builderTokenAccount: adminAta, escrow: escrowPk,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).transaction();
      await provider.sendAndConfirm(depositTx, [], { commitment: "confirmed" });
      console.log(`    deposit paid`);
    } catch (e: any) {
      console.log(`    deposit skipped: ${e.message?.slice(0, 60)}`);
    }
  }

  console.log(`\nDone! Hackathon PDA: ${hackathonPk.toBase58()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
