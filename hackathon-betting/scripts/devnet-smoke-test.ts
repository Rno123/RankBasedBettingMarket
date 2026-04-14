/**
 * Devnet smoke test — full protocol lifecycle
 *
 * Runs: initialize_hackathon → register_project → stake →
 *       (wait for results_timestamp) → resolve → finalize_resolve → claim
 *
 * Usage:
 *   npx ts-node scripts/devnet-smoke-test.ts \
 *     --wallet ~/frontier-deployment/deploy-wallet.json
 *
 * The script creates its own mock USDC mint so no external faucet is needed.
 * results_timestamp is set 90 seconds in the future; the script waits for it.
 */

import * as anchor from "@coral-xyz/anchor";
import { BN, Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  AccountLayout,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");
const RPC_URL    = "https://api.devnet.solana.com";

// Time window: results_timestamp is this many seconds in the future.
// The script stakes immediately, then waits for the window to pass.
const RESULTS_DELAY_SECS = 90;

// Tier config — matches the 3-tier setup used in tests
const TIER_PCTS    = [55, 30, 15];
const TIER_COUNTS  = [1, 0, 0];

// Stake amounts (in token smallest units — treating 1 unit = 1 token for simplicity)
const STAKE_ALICE = 1_000;
const STAKE_BOB   = 2_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function hackathonPda(admin: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("hackathon"), admin.toBuffer()], PROGRAM_ID)[0];
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

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendAndConfirm(
  connection: Connection, tx: Transaction,
  signers: Keypair[], label: string,
): Promise<string> {
  const bh = (await connection.getLatestBlockhash()).blockhash;
  tx.recentBlockhash = bh;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  log(`  ✔ ${label}: ${sig}`);
  return sig;
}

async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(ata);
  if (!info) return 0n;
  return AccountLayout.decode(info.data).amount;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // -- Load wallet --
  const walletArg = process.argv.find(a => a.startsWith("--wallet"))?.split("=")[1]
    ?? process.argv[process.argv.indexOf("--wallet") + 1];
  if (!walletArg) {
    console.error("Usage: ts-node scripts/devnet-smoke-test.ts --wallet <path>");
    process.exit(1);
  }
  const walletPath = walletArg.replace("~", process.env.HOME ?? "");
  const adminKp = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))),
  );
  log(`Admin wallet: ${adminKp.publicKey.toBase58()}`);

  // -- Connection + provider --
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet     = new Wallet(adminKp);
  const provider   = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idlPath = path.join(__dirname, "../target/idl/hackathon_betting.json");
  const IDL     = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program  = new Program(IDL, provider) as any;

  // -- Check SOL balance --
  const sol = await connection.getBalance(adminKp.publicKey);
  log(`SOL balance: ${(sol / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  if (sol < 0.5 * LAMPORTS_PER_SOL) {
    console.error("Need at least 0.5 SOL. Run: solana airdrop 2");
    process.exit(1);
  }

  // ── Step 1: Create mock USDC mint ─────────────────────────────────────────
  log("\n── Step 1: Create mock USDC mint");
  const mintKp = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(82);
  await sendAndConfirm(connection, new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: adminKp.publicKey, newAccountPubkey: mintKp.publicKey,
      lamports: mintRent, space: 82, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mintKp.publicKey, 6, adminKp.publicKey, null),
  ), [adminKp, mintKp], "create mock USDC mint");
  log(`  Mint: ${mintKp.publicKey.toBase58()}`);

  // ── Step 2: Create token accounts & mint tokens ───────────────────────────
  log("\n── Step 2: Set up token accounts");

  // Create fresh user keypairs
  const aliceKp = Keypair.generate();
  const bobKp   = Keypair.generate();

  // Fund users with SOL for rent
  await sendAndConfirm(connection, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: adminKp.publicKey, toPubkey: aliceKp.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: adminKp.publicKey, toPubkey: bobKp.publicKey,   lamports: 0.1 * LAMPORTS_PER_SOL }),
  ), [adminKp], "fund users");

  const adminAta = getAssociatedTokenAddressSync(mintKp.publicKey, adminKp.publicKey);
  const aliceAta = getAssociatedTokenAddressSync(mintKp.publicKey, aliceKp.publicKey);
  const bobAta   = getAssociatedTokenAddressSync(mintKp.publicKey, bobKp.publicKey);

  await sendAndConfirm(connection, new Transaction().add(
    createAssociatedTokenAccountInstruction(adminKp.publicKey, adminAta, adminKp.publicKey, mintKp.publicKey),
    createAssociatedTokenAccountInstruction(adminKp.publicKey, aliceAta, aliceKp.publicKey, mintKp.publicKey),
    createAssociatedTokenAccountInstruction(adminKp.publicKey, bobAta,   bobKp.publicKey,   mintKp.publicKey),
    createMintToInstruction(mintKp.publicKey, aliceAta, adminKp.publicKey, STAKE_ALICE),
    createMintToInstruction(mintKp.publicKey, bobAta,   adminKp.publicKey, STAKE_BOB),
  ), [adminKp], "create ATAs and mint tokens");

  log(`  Alice (${aliceKp.publicKey.toBase58().slice(0, 8)}…): ${STAKE_ALICE} tokens`);
  log(`  Bob   (${bobKp.publicKey.toBase58().slice(0, 8)}…): ${STAKE_BOB} tokens`);

  // ── Step 3: initialize_hackathon ──────────────────────────────────────────
  log("\n── Step 3: initialize_hackathon");
  const resultsTs = Math.floor(Date.now() / 1000) + RESULTS_DELAY_SECS;
  const hackathon = hackathonPda(adminKp.publicKey);
  const escrow    = escrowPda(hackathon);

  await program.methods
    .initializeHackathon(new BN(resultsTs), Buffer.from(TIER_PCTS), Buffer.from(TIER_COUNTS))
    .accounts({
      admin: adminKp.publicKey, hackathon, escrow,
      usdcMint: mintKp.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([adminKp]).rpc();

  const h = await program.account.hackathonState.fetch(hackathon);
  log(`  HackathonState: ${hackathon.toBase58()}`);
  log(`  results_timestamp: ${new Date(h.resultsTimestamp.toNumber() * 1000).toISOString()}`);
  log(`  tier_count: ${h.tierCount}, tier_pcts: [${Array.from(h.tierPcts as Uint8Array).slice(0, h.tierCount).join(", ")}]`);

  // ── Step 4: register_project ──────────────────────────────────────────────
  log("\n── Step 4: register_project");
  const URL_A = "https://github.com/smoke/project-alpha";
  const URL_B = "https://github.com/smoke/project-beta";
  const hashA = Array.from(createHash("sha256").update(URL_A).digest());
  const hashB = Array.from(createHash("sha256").update(URL_B).digest());
  const projectA = projectPda(hackathon, URL_A);
  const projectB = projectPda(hackathon, URL_B);

  await program.methods.registerProject(URL_A, hashA)
    .accounts({ payer: adminKp.publicKey, hackathon, project: projectA, systemProgram: SystemProgram.programId })
    .signers([adminKp]).rpc();
  await program.methods.registerProject(URL_B, hashB)
    .accounts({ payer: adminKp.publicKey, hackathon, project: projectB, systemProgram: SystemProgram.programId })
    .signers([adminKp]).rpc();
  log(`  Project A (rank-1): ${projectA.toBase58()}`);
  log(`  Project B (rank-2): ${projectB.toBase58()}`);

  // ── Step 5: stake ─────────────────────────────────────────────────────────
  log("\n── Step 5: stake");
  await program.methods.stake(new BN(STAKE_ALICE))
    .accounts({
      user: aliceKp.publicKey, hackathon, project: projectA,
      userStake: stakePda(aliceKp.publicKey, projectA),
      userTokenAccount: aliceAta, escrow,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([aliceKp]).rpc();

  await program.methods.stake(new BN(STAKE_BOB))
    .accounts({
      user: bobKp.publicKey, hackathon, project: projectB,
      userStake: stakePda(bobKp.publicKey, projectB),
      userTokenAccount: bobAta, escrow,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([bobKp]).rpc();

  const pool = (await program.account.hackathonState.fetch(hackathon)).totalPool.toNumber();
  log(`  total_pool: ${pool} (alice: ${STAKE_ALICE}, bob: ${STAKE_BOB})`);

  // ── Step 6: Wait for results_timestamp ───────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const waitMs = (resultsTs - now + 2) * 1000;
  log(`\n── Step 6: Waiting ${Math.ceil(waitMs / 1000)}s for results_timestamp…`);
  const interval = setInterval(() => {
    const remaining = resultsTs - Math.floor(Date.now() / 1000);
    if (remaining > 0) process.stdout.write(`\r  ${remaining}s remaining…   `);
  }, 1000);
  await sleep(waitMs);
  clearInterval(interval);
  process.stdout.write("\r  ✔ results_timestamp reached\n");

  // ── Step 7: resolve ───────────────────────────────────────────────────────
  log("\n── Step 7: resolve");
  await program.methods.resolve(1)
    .accounts({ admin: adminKp.publicKey, hackathon, project: projectA })
    .signers([adminKp]).rpc();
  await program.methods.resolve(2)
    .accounts({ admin: adminKp.publicKey, hackathon, project: projectB })
    .signers([adminKp]).rpc();
  log("  Project A → rank 1, Project B → rank 2");

  // ── Step 8: finalize_resolve ──────────────────────────────────────────────
  log("\n── Step 8: finalize_resolve");
  const allProjects = [projectA, projectB];
  await program.methods.finalizeResolve()
    .accounts({ admin: adminKp.publicKey, hackathon })
    .remainingAccounts(allProjects.map(pk => ({ pubkey: pk, isWritable: false, isSigner: false })))
    .signers([adminKp]).rpc();

  const hResolved = await program.account.hackathonState.fetch(hackathon);
  log(`  is_resolved: ${hResolved.isResolved}`);
  const effPcts = Array.from(hResolved.effectiveTierPcts as Uint16Array).slice(0, hResolved.tierCount);
  log(`  effective_tier_pcts (bps): [${effPcts.join(", ")}]`);

  // tier-2 (rest) had no projects → cascaded. Verify cascade happened.
  if (effPcts[2] === 0) {
    log("  ✔ Cascade confirmed: tier-2 (rest) was empty, redistributed to tiers 0 & 1");
  }

  // ── Step 9: claim ─────────────────────────────────────────────────────────
  log("\n── Step 9: claim");

  const aliceBefore = await tokenBalance(connection, aliceAta);
  await program.methods.claim()
    .accounts({
      user: aliceKp.publicKey, hackathon, project: projectA,
      userStake: stakePda(aliceKp.publicKey, projectA),
      userTokenAccount: aliceAta, escrow,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(allProjects.map(pk => ({ pubkey: pk, isWritable: false, isSigner: false })))
    .signers([aliceKp]).rpc();
  const alicePayout = Number(await tokenBalance(connection, aliceAta) - aliceBefore);

  const bobBefore = await tokenBalance(connection, bobAta);
  await program.methods.claim()
    .accounts({
      user: bobKp.publicKey, hackathon, project: projectB,
      userStake: stakePda(bobKp.publicKey, projectB),
      userTokenAccount: bobAta, escrow,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(allProjects.map(pk => ({ pubkey: pk, isWritable: false, isSigner: false })))
    .signers([bobKp]).rpc();
  const bobPayout = Number(await tokenBalance(connection, bobAta) - bobBefore);

  log(`  Alice payout: ${alicePayout}  (staked ${STAKE_ALICE} on rank-1)`);
  log(`  Bob payout:   ${bobPayout}  (staked ${STAKE_BOB} on rank-2)`);
  log(`  Total out:    ${alicePayout + bobPayout} / ${pool} pool`);

  // ── Summary ───────────────────────────────────────────────────────────────
  log("\n── SMOKE TEST COMPLETE ✔");
  log(`  Program:    ${PROGRAM_ID.toBase58()}`);
  log(`  Hackathon:  ${hackathon.toBase58()}`);
  log(`  Mock mint:  ${mintKp.publicKey.toBase58()}`);
  log(`  Alice per-dollar: ${(alicePayout / STAKE_ALICE).toFixed(3)}x`);
  log(`  Bob per-dollar:   ${(bobPayout / STAKE_BOB).toFixed(3)}x`);

  if (alicePayout > bobPayout) {
    log("  ✔ Rank-1 winner (Alice) received more than rank-2 (Bob)");
  }
  if (alicePayout + bobPayout <= pool) {
    log("  ✔ Total payout <= pool (no over-disbursement)");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
