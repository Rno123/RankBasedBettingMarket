/**
 * Devnet demo seeder — creates a full realistic dataset on devnet.
 *
 * What it does:
 *   1. Creates a mock USDC mint (or reuses an existing one)
 *   2. Mints 50K USDC to the admin wallet
 *   3. Creates 4 hackathons with realistic tier configs
 *   4. Registers 5-7 projects per hackathon
 *   5. Stakes USDC from the admin wallet across projects
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/seed-devnet-demo.ts [wallet.json]
 *
 * Prints the mock USDC address at the end — paste that into .env.local.
 */

import * as anchor from "@coral-xyz/anchor";
import { BN, Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createInitializeMint2Instruction, createAssociatedTokenAccountInstruction,
  createMintToInstruction, getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID, MINT_SIZE,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`  ${msg}`); }

function hackathonPda(admin: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("hackathon"), admin.toBuffer(), Buffer.from(name)], PROGRAM_ID)[0];
}
function escrowPda(hackathon: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), hackathon.toBuffer()], PROGRAM_ID)[0];
}
function projectPda(hackathon: PublicKey, url: string): PublicKey {
  const hash = createHash("sha256").update(url).digest();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), hash], PROGRAM_ID)[0];
}
function stakePda(user: PublicKey, project: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), user.toBuffer(), project.toBuffer()], PROGRAM_ID)[0];
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const walletPath = process.argv[2] || path.join(require("os").homedir(), ".config", "solana", "id.json");
  const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  const wallet = new Wallet(keypair);

  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(
    require("../lib/hackathon_betting.json"),
    PROGRAM_ID,
    provider,
  ) as any;

  const admin = wallet.publicKey;
  const bal = await connection.getBalance(admin);
  console.log(`Admin: ${admin.toBase58()}`);
  console.log(`Balance: ${(bal / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  if (bal < 0.5 * LAMPORTS_PER_SOL) {
    console.error("Need at least 0.5 SOL. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  // ── Step 1: Mock USDC mint ──────────────────────────────────────────────
  console.log("\n── Step 1: Mock USDC mint ──");
  const mintKeypair = Keypair.generate();
  const mockUsdc = mintKeypair.publicKey;

  // Check if mint already exists (from a prior run)
  const existingMint = await connection.getAccountInfo(mockUsdc);
  let mintCreated = false;

  if (existingMint) {
    console.log(`Mint ${mockUsdc.toBase58()} already exists, reusing`);
  } else {
    const mintSpace = MINT_SIZE;
    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintSpace);
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin, newAccountPubkey: mockUsdc,
        lamports: mintLamports, space: mintSpace, programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mockUsdc, 6, admin, null),
    );
    await sendAndConfirmTransaction(connection, createMintTx, [wallet.payer, mintKeypair], { commitment: "confirmed" });
    mintCreated = true;
    console.log(`Created mock USDC: ${mockUsdc.toBase58()}`);
  }

  // Admin ATA + mint tokens
  const adminAta = getAssociatedTokenAddressSync(mockUsdc, admin);
  const adminAtaInfo = await connection.getAccountInfo(adminAta);
  if (!adminAtaInfo) {
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(admin, adminAta, admin, mockUsdc),
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [wallet.payer], { commitment: "confirmed" });
  }

  if (mintCreated) {
    // Mint 50K USDC
    const mintTx = new Transaction().add(
      createMintToInstruction(mockUsdc, adminAta, admin, 50_000_000_000n),
    );
    await sendAndConfirmTransaction(connection, mintTx, [wallet.payer], { commitment: "confirmed" });
    console.log("Minted 50,000 USDC to admin wallet");
  }

  // ── Step 2: Create hackathons ───────────────────────────────────────────
  console.log("\n── Step 2: Create hackathons ──");

  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  const hackathonDefs = [
    { name: "Solana Frontier 2026", deadlineDays: 18, tierPcts: [40, 25, 15, 10, 10], tierCounts: [1, 4, 8, 0, 0], feeBps: 150, deposit: 10_000_000, openStaking: true, openReg: true },
    { name: "Colosseum Renaissance S2", deadlineDays: 24, tierPcts: [35, 25, 20, 20], tierCounts: [1, 3, 6, 0], feeBps: 150, deposit: 10_000_000, openStaking: true, openReg: true },
    { name: "Breakpoint Hacks 2026", deadlineDays: 31, tierPcts: [50, 30, 20], tierCounts: [3, 5, 0], feeBps: 150, deposit: 10_000_000, openStaking: true, openReg: true },
    { name: "Radar Superteam", deadlineDays: 9, tierPcts: [60, 40], tierCounts: [1, 3], feeBps: 150, deposit: 10_000_000, openStaking: true, openReg: true },
  ];

  const createdHackathons: { pubkey: PublicKey; name: string }[] = [];

  for (const def of hackathonDefs) {
    const deadline = now + def.deadlineDays * day;
    const paddedPcts = Array(8).fill(0) as number[];
    def.tierPcts.forEach((p, i) => paddedPcts[i] = p);
    const paddedCounts = Array(8).fill(0) as number[];
    def.tierCounts.forEach((c, i) => paddedCounts[i] = c);

    const hackathonPk = hackathonPda(admin, def.name);
    const existing = await connection.getAccountInfo(hackathonPk);
    if (existing) {
      console.log(`  ${def.name} — already exists, skipping`);
      createdHackathons.push({ pubkey: hackathonPk, name: def.name });
      continue;
    }

    const escrowPk = escrowPda(hackathonPk);
    const tx = await program.methods.initializeHackathon(
      def.name, new BN(deadline), def.tierPcts.length,
      paddedPcts, paddedCounts, new BN(def.feeBps),
      new BN(def.deposit), !def.openReg, def.openStaking,
    ).accounts({
      admin, hackathon: hackathonPk, escrow: escrowPk,
      usdcMint: mockUsdc, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).transaction();

    await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
    createdHackathons.push({ pubkey: hackathonPk, name: def.name });
    console.log(`  ✓ ${def.name} (${def.deadlineDays}d deadline, ${def.tierPcts.length} tiers)`);
  }

  // ── Step 3: Register projects ───────────────────────────────────────────
  console.log("\n── Step 3: Register projects ──");

  const projectDefs: Record<string, string[]> = {
    "Solana Frontier 2026": [
      "https://github.com/deepgrid/finance",
      "https://github.com/novadex/protocol",
      "https://github.com/layerflow/ai",
      "https://github.com/zenith-fi/oracle",
      "https://github.com/tapestry/identity",
      "https://github.com/ferrum-labs/bridge",
      "https://github.com/cipher-dao/governance",
    ],
    "Colosseum Renaissance S2": [
      "https://github.com/aurora-protocol/defi",
      "https://github.com/bastion-fi/wallet",
      "https://github.com/catalyst/nft",
      "https://github.com/driftwood/trade",
      "https://github.com/ember-labs/payments",
    ],
    "Breakpoint Hacks 2026": [
      "https://github.com/nebula-swap/amm",
      "https://github.com/orbit-protocol/lending",
      "https://github.com/parallax/zk-rollup",
      "https://github.com/quasar-finance/options",
      "https://github.com/rift-protocol/perps",
    ],
    "Radar Superteam": [
      "https://github.com/solstice-fi/aggregator",
      "https://github.com/terraform-labs/infra",
      "https://github.com/umbra-privacy/mixer",
      "https://github.com/vector-dao/treasury",
      "https://github.com/wyvern-sdk/tools",
    ],
  };

  const createdProjects: { pubkey: PublicKey; hackathon: PublicKey }[] = [];

  for (const h of createdHackathons) {
    const urls = projectDefs[h.name] ?? [];
    for (const url of urls) {
      const projectPk = projectPda(h.pubkey, url);
      const existing = await connection.getAccountInfo(projectPk);
      if (existing) {
        createdProjects.push({ pubkey: projectPk, hackathon: h.pubkey });
        continue;
      }
      const hash = createHash("sha256").update(url).digest();
      const tx = await program.methods.registerProject(url, Array.from(hash)).accounts({
        caller: admin, builder: admin, hackathon: h.pubkey,
        project: projectPk, systemProgram: SystemProgram.programId,
      }).transaction();
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      createdProjects.push({ pubkey: projectPk, hackathon: h.pubkey });
    }
    console.log(`  ${h.name}: ${urls.length} projects`);
  }

  // ── Step 4: Place some stakes ───────────────────────────────────────────
  console.log("\n── Step 4: Place stakes ──");

  const stakeAmounts = [50_000_000, 30_000_000, 20_000_000, 15_000_000, 10_000_000, 8_000_000, 5_000_000];

  // Stake on Frontier projects (the largest hackathon)
  const frontierProjects = createdProjects.filter(p =>
    p.hackathon.equals(createdHackathons[0].pubkey)
  );

  let staked = 0;
  for (let i = 0; i < Math.min(frontierProjects.length, stakeAmounts.length); i++) {
    const projectPk = frontierProjects[i].pubkey;
    const hackathonPk = frontierProjects[i].hackathon;
    const userStakePk = stakePda(admin, projectPk);
    const existing = await connection.getAccountInfo(userStakePk);
    if (existing) continue;

    const escrowPk = escrowPda(hackathonPk);
    const amount = stakeAmounts[i];
    try {
      const tx = await program.methods.stake(new BN(amount)).accounts({
        user: admin, hackathon: hackathonPk, project: projectPk,
        userStake: userStakePk, userTokenAccount: adminAta, escrow: escrowPk,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).transaction();
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      staked++;
    } catch (e: any) {
      log(`Stake failed for project ${i}: ${e.message?.slice(0, 80)}`);
    }
  }
  console.log(`  Staked on ${staked} Frontier projects`);

  // ── Done ────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════");
  console.log("  Seed complete!");
  console.log(`  Mock USDC mint: ${mockUsdc.toBase58()}`);
  console.log(`  Hackathons: ${createdHackathons.length}`);
  console.log(`  Projects: ${createdProjects.length}`);
  console.log("\n  Add to .env.local:");
  console.log(`  NEXT_PUBLIC_USDC_MINT=${mockUsdc.toBase58()}`);
  console.log("══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
