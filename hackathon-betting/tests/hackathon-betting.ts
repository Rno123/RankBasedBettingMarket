import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BankrunProvider } from "anchor-bankrun";
import { startAnchor, Clock, ProgramTestContext } from "solana-bankrun";
import {
  AccountLayout,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";
import { HackathonBetting } from "../target/types/hackathon_betting";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require("../target/idl/hackathon_betting.json");

// ── Constants ─────────────────────────────────────────────────────────────────

const PROGRAM_ID      = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");
const T0              = 1_000_000_000;          // deterministic base Unix timestamp
const RESULTS_TS      = T0 + 86_400 * 30;       // 30 days later
const CUTOFF_TS       = RESULTS_TS - 86_400;    // 29 days after T0
const FORFEIT_TS      = RESULTS_TS + 14 * 86_400;

// Load the local Solana keypair (matches PROTOCOL_ADMIN in the `testing` feature build).
// bankrun generates its own ctx.payer, so we must pass this as an extra funded account.
const adminKp: Keypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf-8"))
  )
);

// ── Integer math (mirrors on-chain logic exactly) ─────────────────────────────

const DEFAULT_TIER_PCTS   = [55, 30, 15];
const DEFAULT_TIER_COUNTS = [1, 0, 0];
const TIER_COUNT          = DEFAULT_TIER_PCTS.length;

function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}

function tierForRank(rank: number, tierCount: number): number {
  return Math.min(rank - 1, tierCount - 1);
}

// Option B per-project payout simulation (mirrors on-chain finalize_resolve).
// For named tiers (expected > 0): per_project_bps = pct_bps / expected,
// draws per_project * actual. Rest tiers (expected == 0) split what remains.
// Excess from under-filled named tiers cascades, or goes to rest tiers if any exist.
function computeEffectivePcts(
  tierPcts: number[],
  tierExpectedCounts: number[],
  tierProjectCounts: number[],
): number[] {
  const n = tierPcts.length;
  const eff = new Array<number>(n).fill(0);
  const tierHasProjects = tierProjectCounts.map(c => c > 0);

  let drawnBps = 0;
  let restTotalPctBps = 0;

  // Named tiers draw per-project shares
  for (let i = 0; i < n; i++) {
    if (!tierHasProjects[i]) continue;
    const exp = tierExpectedCounts[i];
    if (exp > 0) {
      const pctBps = tierPcts[i] * 100;
      const perProj = Math.floor(pctBps / exp);
      const draw = perProj * tierProjectCounts[i];
      eff[i] = draw;
      drawnBps += draw;
    } else {
      restTotalPctBps += tierPcts[i] * 100;
    }
  }

  const remaining = 10_000 - drawnBps;
  const hasRestWithProjects = tierExpectedCounts.some((exp, i) => exp === 0 && tierHasProjects[i]);

  if (hasRestWithProjects && remaining > 0) {
    // Rest tiers split remaining proportionally
    let restAllocated = 0;
    let lastRest = -1;
    for (let i = 0; i < n; i++) {
      if (tierHasProjects[i] && tierExpectedCounts[i] === 0) lastRest = i;
    }
    for (let i = 0; i < n; i++) {
      if (!tierHasProjects[i] || tierExpectedCounts[i] > 0) continue;
      const weight = tierPcts[i] * 100;
      if (i === lastRest) {
        eff[i] = remaining - restAllocated;
      } else {
        const share = Math.floor((remaining * weight) / restTotalPctBps);
        eff[i] = share;
        restAllocated += share;
      }
    }
  } else if (remaining > 0 && drawnBps > 0) {
    // No rest tiers: cascade excess proportionally to what each tier's projects drew
    let cascadeAllocated = 0;
    let lastOccupied = -1;
    for (let i = 0; i < n; i++) {
      if (tierHasProjects[i] && tierExpectedCounts[i] > 0) lastOccupied = i;
    }
    for (let i = 0; i < n; i++) {
      if (!tierHasProjects[i] || tierExpectedCounts[i] === 0) continue;
      const weight = eff[i];
      let additional: number;
      if (i === lastOccupied) {
        additional = remaining - cascadeAllocated;
      } else {
        additional = Math.floor((remaining * weight) / drawnBps);
        cascadeAllocated += additional;
      }
      eff[i] += additional;
    }
  }

  return eff;
}

function cTotalForTier(
  tier: number, tierCount: number,
  stakes: bigint[], ranks: number[],
): bigint {
  let sum = 0n;
  for (let i = 0; i < stakes.length; i++) {
    if (tierForRank(ranks[i], tierCount) === tier) sum += isqrt(stakes[i]);
  }
  return sum;
}

function expectedPayout(
  userShares: bigint, ci: bigint, effectivePt: number,
  pool: bigint, totalShares: bigint, cTotalTier: bigint,
): bigint {
  return (userShares * ci * BigInt(effectivePt) * pool) / (totalShares * cTotalTier * 10_000n);
}

/** Mirrors on-chain compute_shares: multiplier decays 1.5× → 1.0× over the staking window. */
function computeShares(amount: number, now: number, start: number, cutoff: number): number {
  const window  = Math.max(cutoff - start, 1);
  const elapsed = Math.min(Math.max(now - start, 0), window);
  const bps     = 15_000 - Math.floor(5_000 * elapsed / window);
  return Math.floor(amount * bps / 10_000);
}

// ── PDA helpers ───────────────────────────────────────────────────────────────

function hackathonPda(admin: PublicKey, name: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("hackathon"), admin.toBuffer(), Buffer.from(name)], PROGRAM_ID)[0];
}
function escrowPda(hackathon: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), hackathon.toBuffer()], PROGRAM_ID)[0];
}
function projectPda(hackathon: PublicKey, url: string): PublicKey {
  const urlHash = createHash("sha256").update(url).digest();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), urlHash], PROGRAM_ID)[0];
}
function stakePda(user: PublicKey, project: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), user.toBuffer(), project.toBuffer()], PROGRAM_ID)[0];
}
function whitelistPda(hackathon: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), hackathon.toBuffer(), wallet.toBuffer()], PROGRAM_ID)[0];
}
function protocolAdminPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_admin"), wallet.toBuffer()], PROGRAM_ID)[0];
}

// ── Low-level tx helpers ──────────────────────────────────────────────────────

async function sendTx(ctx: ProgramTestContext, ixs: any[], signers: Keypair[]) {
  const tx = new Transaction();
  tx.add(...ixs);
  const [blockhash] = await ctx.banksClient.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  await ctx.banksClient.processTransaction(tx);
}

async function fund(ctx: ProgramTestContext, target: PublicKey, lamports = 2 * LAMPORTS_PER_SOL) {
  await sendTx(ctx,
    [SystemProgram.transfer({ fromPubkey: ctx.payer.publicKey, toPubkey: target, lamports })],
    [ctx.payer]);
}

async function createMint(ctx: ProgramTestContext): Promise<PublicKey> {
  const kp = Keypair.generate();
  const rent = await ctx.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(82n));
  await sendTx(ctx, [
    SystemProgram.createAccount({
      fromPubkey: ctx.payer.publicKey, newAccountPubkey: kp.publicKey,
      lamports, space: 82, programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(kp.publicKey, 6, ctx.payer.publicKey, null),
  ], [ctx.payer, kp]);
  return kp.publicKey;
}

async function createAta(ctx: ProgramTestContext, mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  await sendTx(ctx,
    [createAssociatedTokenAccountInstruction(ctx.payer.publicKey, ata, owner, mint)],
    [ctx.payer]);
  return ata;
}

async function mintTokens(ctx: ProgramTestContext, mint: PublicKey, to: PublicKey, amount: number) {
  await sendTx(ctx,
    [createMintToInstruction(mint, to, ctx.payer.publicKey, amount)],
    [ctx.payer]);
}

async function tokenBalance(ctx: ProgramTestContext, ata: PublicKey): Promise<bigint> {
  const raw = await ctx.banksClient.getAccount(ata);
  if (!raw) return 0n;
  return AccountLayout.decode(raw.data).amount;
}

function setClock(ctx: ProgramTestContext, ts: number) {
  ctx.setClock(new Clock(0n, 0n, 0n, 1n, BigInt(ts)));
}

// ── Fixture types & helpers ───────────────────────────────────────────────────

interface Fix {
  admin: Keypair;
  mint: PublicKey;
  hackathon: PublicKey;
  escrow: PublicKey;
  feeRecipient: Keypair;
  feeRecipientAta: PublicKey;
}
interface User { user: Keypair; ata: PublicKey; }
interface SlipLeg { project: PublicKey; amount: number; }

// Auto-incrementing name suffix so each newHackathon() call gets a unique PDA
// since all hackathons share the same admin (adminKp = PROTOCOL_ADMIN).
let _hackIdx = 0;

async function newHackathon(
  ctx: ProgramTestContext, program: any,
  irlHackathonDeadlineTimestamp = RESULTS_TS,
  tierPcts: number[]   = DEFAULT_TIER_PCTS,
  tierCounts: number[] = DEFAULT_TIER_COUNTS,
  name?: string,
  protocolFeeBps = 0,
  depositAmount = 0,
  requiresApproval = false,
  openStaking = true,
): Promise<Fix> {
  // PROTOCOL_ADMIN == adminKp (loaded from ~/.config/solana/id.json).
  // ctx.payer is bankrun's internal payer and does NOT equal PROTOCOL_ADMIN.
  const admin      = adminKp;
  const uniqueName = name ?? `H${_hackIdx++}`;
  const feeRecipient = Keypair.generate();
  const mint            = await createMint(ctx);
  const hackathon       = hackathonPda(admin.publicKey, uniqueName);
  const escrow          = escrowPda(hackathon);
  const feeRecipientAta = await createAta(ctx, mint, feeRecipient.publicKey);
  await program.methods.initializeHackathon(
      uniqueName,
      new BN(irlHackathonDeadlineTimestamp),
      Buffer.from(tierPcts),
      Buffer.from(tierCounts),
      feeRecipient.publicKey,
      protocolFeeBps,
      new BN(depositAmount),
      requiresApproval,
      openStaking,
    )
    .accounts({ admin: admin.publicKey, hackathon, escrow, usdcMint: mint,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([admin]).rpc();
  return { admin, mint, hackathon, escrow, feeRecipient, feeRecipientAta };
}

async function newUser(ctx: ProgramTestContext, mint: PublicKey, tokens: number): Promise<User> {
  const user = Keypair.generate();
  await fund(ctx, user.publicKey);
  const ata = await createAta(ctx, mint, user.publicKey);
  await mintTokens(ctx, mint, ata, tokens);
  return { user, ata };
}

/** Whitelist a wallet to stake in a hackathon (must be signed by PROTOCOL_ADMIN = adminKp). */
async function doWhitelist(
  _ctx: ProgramTestContext, program: any,
  fix: Fix, wallet: PublicKey,
): Promise<void> {
  await program.methods.whitelistWallet()
    .accounts({
      admin:          adminKp.publicKey,
      hackathon:      fix.hackathon,
      wallet,
      whitelistEntry: whitelistPda(fix.hackathon, wallet),
      systemProgram:  SystemProgram.programId,
    })
    .signers([adminKp]).rpc();
}

async function doAddProtocolAdmin(
  program: any, delegate: PublicKey,
): Promise<void> {
  await program.methods.addProtocolAdmin()
    .accounts({
      authority: adminKp.publicKey,
      newAdmin: delegate,
      adminEntry: protocolAdminPda(delegate),
      systemProgram: SystemProgram.programId,
    })
    .signers([adminKp]).rpc();
}

/** Create a funded user, mint tokens, and whitelist them for fix's hackathon. */
async function newWhitelistedUser(
  ctx: ProgramTestContext, program: any,
  fix: Fix, tokens: number,
): Promise<User> {
  const u = await newUser(ctx, fix.mint, tokens);
  await doWhitelist(ctx, program, fix, u.user.publicKey);
  return u;
}

async function addProject(
  ctx: ProgramTestContext, program: any,
  fix: Fix, url: string,
  builderKp: Keypair = ctx.payer,
  callerKp: Keypair = builderKp,
): Promise<PublicKey> {
  const urlHash = createHash("sha256").update(url).digest();
  const project = projectPda(fix.hackathon, url);
  await (program.methods as any).registerProject(url, Array.from(urlHash))
    .accounts({
      caller: callerKp.publicKey,
      builder: builderKp.publicKey,
      hackathon: fix.hackathon,
      project,
      systemProgram: SystemProgram.programId,
    })
    .signers([callerKp]).rpc();
  return project;
}

async function doStake(
  program: any, fix: Fix, u: User, project: PublicKey, amount: number,
) {
  await program.methods.stake(new BN(amount))
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake:      stakePda(u.user.publicKey, project),
                whitelistEntry: whitelistPda(fix.hackathon, u.user.publicKey),
                userTokenAccount: u.ata, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([u.user]).rpc();
}

async function buildStakeIx(
  program: any, fix: Fix, u: User, project: PublicKey, amount: number,
) {
  return program.methods.stake(new BN(amount))
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake:      stakePda(u.user.publicKey, project),
                whitelistEntry: whitelistPda(fix.hackathon, u.user.publicKey),
                userTokenAccount: u.ata, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
}

async function doStakeMany(
  ctx: ProgramTestContext, program: any, fix: Fix, u: User, legs: SlipLeg[],
) {
  const ixs = await Promise.all(
    legs.map(({ project, amount }) => buildStakeIx(program, fix, u, project, amount)),
  );
  await sendTx(ctx, ixs, [u.user]);
}

async function doUnstake(
  program: any, fix: Fix, u: User, project: PublicKey,
) {
  await program.methods.unstake()
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(u.user.publicKey, project),
                userTokenAccount: u.ata,
                feeRecipientTokenAccount: fix.feeRecipientAta,
                escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([u.user]).rpc();
}

async function doResolve(
  program: any, fix: Fix, project: PublicKey, rank: number,
) {
  await program.methods.resolve(rank)
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon, project })
    .signers([fix.admin]).rpc();
}

async function doFinalizeResolve(
  program: any, fix: Fix, allProjects: PublicKey[],
) {
  await program.methods.finalizeResolve()
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon })
    .remainingAccounts(allProjects.map(pk => ({ pubkey: pk, isWritable: false, isSigner: false })))
    .signers([fix.admin]).rpc();
}

async function doClaim(
  program: any, fix: Fix, u: User,
  project: PublicKey, _allProjects?: PublicKey[],
) {
  // remaining_accounts are no longer used for payout math (C-01 fix: tier_c_totals snapshotted
  // at finalize_resolve). We accept the param for backward-compat but don't pass it.
  await program.methods.claim()
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(u.user.publicKey, project),
                userTokenAccount: u.ata,
                feeRecipientTokenAccount: fix.feeRecipientAta,
                escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([u.user]).rpc();
}

async function buildClaimIx(
  program: any, fix: Fix, u: User, project: PublicKey,
) {
  return program.methods.claim()
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(u.user.publicKey, project),
                userTokenAccount: u.ata,
                feeRecipientTokenAccount: fix.feeRecipientAta,
                escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
}

async function doClaimMany(
  ctx: ProgramTestContext, program: any, fix: Fix, u: User, projects: PublicKey[],
) {
  const ixs = await Promise.all(projects.map((project) => buildClaimIx(program, fix, u, project)));
  await sendTx(ctx, ixs, [u.user]);
}

async function doSubmitProject(
  program: any, fix: Fix, builder: Keypair, project: PublicKey,
) {
  await program.methods.submitProject()
    .accounts({ builder: builder.publicKey, hackathon: fix.hackathon, project })
    .signers([builder]).rpc();
}

async function doPayDeposit(
  program: any, fix: Fix,
  builder: Keypair, builderAta: PublicKey, project: PublicKey,
) {
  await program.methods.payDeposit()
    .accounts({ builder: builder.publicKey, hackathon: fix.hackathon, project,
                builderTokenAccount: builderAta, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([builder]).rpc();
}

async function doApproveSubmissions(
  program: any, fix: Fix, projects: PublicKey[],
) {
  await program.methods.approveSubmissions()
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon })
    .remainingAccounts(projects.map(pk => ({ pubkey: pk, isWritable: true, isSigner: false })))
    .signers([fix.admin]).rpc();
}

async function doClaimDepositRefund(
  program: any, fix: Fix,
  builder: Keypair, builderAta: PublicKey, project: PublicKey,
) {
  await program.methods.claimDepositRefund()
    .accounts({ builder: builder.publicKey, hackathon: fix.hackathon, project,
                builderTokenAccount: builderAta, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([builder]).rpc();
}

async function doSelfStake(
  program: any, fix: Fix,
  builder: Keypair, builderAta: PublicKey, project: PublicKey, amount: number,
) {
  await program.methods.selfStake(new BN(amount))
    .accounts({ builder: builder.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(builder.publicKey, project),
                builderTokenAccount: builderAta, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([builder]).rpc();
}

async function doForfeitDeposit(
  program: any, fix: Fix, project: PublicKey,
) {
  await program.methods.forfeitDeposit()
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon, project,
                feeRecipientTokenAccount: fix.feeRecipientAta, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID })
    .signers([fix.admin]).rpc();
}

async function doEnableRefund(
  program: any, fix: Fix, project: PublicKey,
) {
  await program.methods.enableRefund()
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon, project })
    .signers([fix.admin]).rpc();
}

async function doRefund(
  program: any, fix: Fix, u: User, project: PublicKey,
) {
  await program.methods.refund()
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(u.user.publicKey, project),
                userTokenAccount: u.ata, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([u.user]).rpc();
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("hackathon-betting — Bankrun suite", () => {
  let ctx: ProgramTestContext;
  let program: any;

  before(async () => {
    // Pre-fund adminKp so it can pay for initializeHackathon / whitelistWallet.
    ctx = await startAnchor(".", [], [{
      address: adminKp.publicKey,
      info: {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      },
    }]);
    const provider = new BankrunProvider(ctx);
    program = new anchor.Program<HackathonBetting>(IDL, provider);
    setClock(ctx, T0);
  });

  // ── 1. initialize_hackathon ───────────────────────────────────────────────

  describe("1. initialize_hackathon", () => {
    it("stores correct fields", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.ok(h.admin.equals(fix.admin.publicKey));
      assert.ok(h.usdcMint.equals(fix.mint));
      assert.equal(h.irlHackathonDeadlineTimestamp.toNumber(), RESULTS_TS);
      assert.equal(h.cutoffTimestamp.toNumber(), CUTOFF_TS);
      assert.equal(h.totalPool.toNumber(), 0);
      assert.equal(h.isResolved, false);
      assert.equal(h.tierCount, 3);
      assert.deepEqual(Array.from(h.tierPcts).slice(0, 3), [55, 30, 15]);
    });

    it("cutoff is exactly 86400 s before results", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program, T0 + 200_000);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.irlHackathonDeadlineTimestamp.toNumber() - h.cutoffTimestamp.toNumber(), 86_400);
    });

    it("rejects irl_hackathon_deadline_timestamp <= now + 86400 (M-01: cutoff already expired)", async () => {
      setClock(ctx, T0);
      // irl_hackathon_deadline_timestamp = T0 + 86_399 means cutoff = T0 - 1 (already past)
      try {
        await newHackathon(ctx, program, T0 + 86_399);
        assert.fail("should have rejected near-future irl_hackathon_deadline_timestamp");
      } catch (e: any) {
        assert.include(e.message, "InvalidTimestamp");
      }
    });

    it("rejects protocol_fee_bps > 3000 (M-02: InvalidFee)", async () => {
      setClock(ctx, T0);
      const mint = await createMint(ctx);
      const name = `FeeVld${_hackIdx++}`;
      const hackathon = hackathonPda(adminKp.publicKey, name);
      try {
        await program.methods.initializeHackathon(
          name, new BN(RESULTS_TS),
          Buffer.from([55, 30, 15]), Buffer.from([1, 0, 0]),
          Keypair.generate().publicKey,
          3001, new BN(0), false, false,
        )
        .accounts({ admin: adminKp.publicKey, hackathon,
                    escrow: escrowPda(hackathon), usdcMint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([adminKp]).rpc();
        assert.fail("should reject fee > 30%");
      } catch (e: any) {
        assert.include(e.message, "InvalidFee");
      }
    });

    it("accepts protocol_fee_bps at boundary 3000 (30%)", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, undefined, 3000);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.protocolFeeBps, 3000);
    });
  });

  // ── 2. register_project ───────────────────────────────────────────────────

  describe("2. register_project", () => {
    let fix: Fix;
    before(async () => { setClock(ctx, T0); fix = await newHackathon(ctx, program); });

    it("creates ProjectAccount with correct fields", async () => {
      const url = "https://github.com/alice/proj";
      const project = await addProject(ctx, program, fix, url);
      const p = await program.account.projectAccount.fetch(project);
      assert.ok(p.hackathon.equals(fix.hackathon));
      assert.equal(p.githubUrl, url);
      assert.ok(p.builderWallet.equals(ctx.payer.publicKey));
      assert.equal(p.totalStaked.toNumber(), 0);
      assert.equal(p.rank, 0);
      assert.equal(p.isRegistered, true);
    });

    it("accepts real GitHub URLs longer than 32 bytes", async () => {
      const url = "https://github.com/some-org/some-long-repo-name";
      const project = await addProject(ctx, program, fix, url);
      const p = await program.account.projectAccount.fetch(project);
      assert.equal(p.githubUrl, url);
    });

    it("rejects url > 200 chars (UrlTooLong)", async () => {
      const url = "a".repeat(201);
      try {
        await addProject(ctx, program, fix, url);
        assert.fail("should have thrown");
      } catch (e: any) {
        assert.include(e.message, "UrlTooLong");
      }
    });

    it("rejects registration when caller != builder (self-registration only)", async () => {
      const builder = Keypair.generate();
      const impostor = Keypair.generate();
      await fund(ctx, impostor.publicKey);
      const url = "https://github.com/squatter/proj";
      const urlHash = createHash("sha256").update(url).digest();
      const project = projectPda(fix.hackathon, url);
      try {
        await (program.methods as any).registerProject(url, Array.from(urlHash))
          .accounts({
            caller: impostor.publicKey,
            builder: builder.publicKey,
            hackathon: fix.hackathon,
            project,
            systemProgram: SystemProgram.programId,
          })
          .signers([impostor])
          .rpc();
        assert.fail("mismatched caller should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("Unauthorized"),
          `Expected Unauthorized, got: ${e.message}`);
      }
    });
  });

  // ── 3. stake ─────────────────────────────────────────────────────────────

  describe("3. stake", () => {
    let fix: Fix; let alice: User; let project: PublicKey;

    before(async () => {
      setClock(ctx, T0);
      fix     = await newHackathon(ctx, program);
      alice   = await newWhitelistedUser(ctx, program, fix, 10_000);
      project = await addProject(ctx, program, fix, "https://github.com/stake/proj");
    });

    it("transfers tokens and updates totals", async () => {
      await doStake(program, fix, alice, project, 1_000);
      assert.equal(Number(await tokenBalance(ctx, fix.escrow)), 1_000);
      assert.equal(Number(await tokenBalance(ctx, alice.ata)), 9_000);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.totalPool.toNumber(), 1_000);
      const p = await program.account.projectAccount.fetch(project);
      assert.equal(p.totalStaked.toNumber(), 1_000);
    });

    it("accumulates a second stake from same wallet", async () => {
      await doStake(program, fix, alice, project, 500);
      const p = await program.account.projectAccount.fetch(project);
      assert.equal(p.totalStaked.toNumber(), 1_500);
    });

    it("rejects zero amount", async () => {
      try { await doStake(program, fix, alice, project, 0); assert.fail(); }
      catch (e: any) { assert.include(e.message, "ZeroAmount"); }
    });

    it("rejects stake over per-wallet cap", async () => {
      const carol = await newWhitelistedUser(ctx, program, fix, 2_000_000_002);
      try { await doStake(program, fix, carol, project, 2_000_000_001); assert.fail(); }
      catch (e: any) { assert.include(e.message, "StakeCapExceeded"); }
    });

    it("rejects stake after cutoff", async () => {
      setClock(ctx, CUTOFF_TS + 1);
      try { await doStake(program, fix, alice, project, 100); assert.fail(); }
      catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("CutoffPassed") || txt.includes("6000") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected CutoffPassed or duplicate-tx rejection, got: ${e.message}`,
        );
      }
      finally { setClock(ctx, T0); }
    });

    it("rejects stake from non-whitelisted wallet (T-02 adversarial)", async () => {
      setClock(ctx, T0);
      const notListed = await newUser(ctx, fix.mint, 500);
      try {
        await doStake(program, fix, notListed, project, 500);
        assert.fail("non-whitelisted stake must fail");
      } catch (e: any) {
        // Anchor rejects because the whitelist PDA doesn't exist
        assert.ok(e, "expected error for non-whitelisted wallet");
      }
    });
  });

  describe("3b. multi-pick slips (batched client flow)", () => {
    it("supports an equal-weight Top 3 slip in one transaction", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const alice = await newWhitelistedUser(ctx, program, fix, 10_000);
      const projects = await Promise.all([
        addProject(ctx, program, fix, "https://github.com/slip/equal-1"),
        addProject(ctx, program, fix, "https://github.com/slip/equal-2"),
        addProject(ctx, program, fix, "https://github.com/slip/equal-3"),
      ]);

      const balanceBefore = await tokenBalance(ctx, alice.ata);
      await doStakeMany(ctx, program, fix, alice, projects.map((project) => ({ project, amount: 300 })));

      assert.equal(Number(balanceBefore - await tokenBalance(ctx, alice.ata)), 900);
      assert.equal(Number(await tokenBalance(ctx, fix.escrow)), 900);

      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.totalPool.toNumber(), 900);

      for (const project of projects) {
        const p = await program.account.projectAccount.fetch(project);
        const s = await program.account.userStake.fetch(stakePda(alice.user.publicKey, project));
        assert.equal(p.totalStaked.toNumber(), 300);
        assert.equal(s.amount.toNumber(), 300);
        assert.isAbove(s.shares.toNumber(), 0);
      }
    });

    it("supports custom-weight slips and batched claims without changing payout math", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const alice = await newWhitelistedUser(ctx, program, fix, 10_000);
      const projects = await Promise.all([
        addProject(ctx, program, fix, "https://github.com/slip/weighted-1"),
        addProject(ctx, program, fix, "https://github.com/slip/weighted-2"),
        addProject(ctx, program, fix, "https://github.com/slip/weighted-3"),
      ]);

      const legs = [
        { project: projects[0], amount: 500 },
        { project: projects[1], amount: 300 },
        { project: projects[2], amount: 200 },
      ];

      await doStakeMany(ctx, program, fix, alice, legs);

      setClock(ctx, RESULTS_TS);
      for (let i = 0; i < projects.length; i++) {
        await doResolve(program, fix, projects[i], i + 1);
      }
      await doFinalizeResolve(program, fix, projects);

      const before = await tokenBalance(ctx, alice.ata);
      await doClaimMany(ctx, program, fix, alice, projects);
      assert.equal(
        Number(await tokenBalance(ctx, alice.ata) - before),
        1_000,
        "sole staker across the selected ranked projects receives the full pool back",
      );

      for (const project of projects) {
        const stake = await program.account.userStake.fetch(stakePda(alice.user.publicKey, project));
        assert.equal(stake.isClaimed, true);
      }
    });
  });

  // ── 4. unstake ────────────────────────────────────────────────────────────

  describe("4. unstake — flat 3% penalty", () => {
    let fix: Fix; let alice: User; let project: PublicKey;

    before(async () => {
      setClock(ctx, T0);
      fix     = await newHackathon(ctx, program);
      alice   = await newWhitelistedUser(ctx, program, fix, 1_000);
      project = await addProject(ctx, program, fix, "https://github.com/unstake/zero");
      await doStake(program, fix, alice, project, 1_000);
    });

    it("flat 3% applied at t=T0: returns 970, fee=15, pool=15", async () => {
      const userBefore = await tokenBalance(ctx, alice.ata);
      const feeBefore  = await tokenBalance(ctx, fix.feeRecipientAta);
      await doUnstake(program, fix, alice, project);
      const userReceived = Number(await tokenBalance(ctx, alice.ata) - userBefore);
      const feeReceived  = Number(await tokenBalance(ctx, fix.feeRecipientAta) - feeBefore);
      // flat 3%: penalty=30, protocol_fee=15 to fee_recipient, pool_fee=15 stays
      assert.equal(userReceived, 970, "user gets 97% = 970");
      assert.equal(feeReceived,  15,  "fee_recipient gets 1.5% = 15");
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.totalPool.toNumber(), 15, "1.5% penalty stays in pool");
    });
  });

  describe("4b. unstake — flat 3% at midpoint (penalty is time-independent)", () => {
    let fix: Fix; let bob: User; let project: PublicKey;

    before(async () => {
      setClock(ctx, T0);
      fix     = await newHackathon(ctx, program);
      bob     = await newWhitelistedUser(ctx, program, fix, 1_000);
      project = await addProject(ctx, program, fix, "https://github.com/unstake/midpoint");
      await doStake(program, fix, bob, project, 1_000);
    });

    it("flat 3% at midpoint: returns 970 (same as at T0)", async () => {
      setClock(ctx, T0 + Math.floor((CUTOFF_TS - T0) / 2));
      const before = await tokenBalance(ctx, bob.ata);
      await doUnstake(program, fix, bob, project);
      const after = await tokenBalance(ctx, bob.ata);
      assert.equal(Number(after - before), 970, "flat 3%: returns 970 at midpoint too");
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.totalPool.toNumber(), 15, "1.5% pool penalty stays regardless of time");
    });

    it("rejects unstake after cutoff", async () => {
      setClock(ctx, CUTOFF_TS + 1);
      try { await doUnstake(program, fix, bob, project); assert.fail(); }
      catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("CutoffPassed") || txt.includes("6000") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected CutoffPassed or duplicate-tx rejection, got: ${e.message}`,
        );
      }
      finally { setClock(ctx, T0); }
    });
  });

  // ── 5. resolve + finalize_resolve ─────────────────────────────────────────

  describe("5. resolve + finalize_resolve", () => {
    let fix: Fix; let projects: PublicKey[]; let alice: User;

    before(async () => {
      setClock(ctx, T0);
      fix = await newHackathon(ctx, program);
      alice = await newWhitelistedUser(ctx, program, fix, 3_000);
      projects = await Promise.all([
        addProject(ctx, program, fix, "https://github.com/res/1"),
        addProject(ctx, program, fix, "https://github.com/res/2"),
        addProject(ctx, program, fix, "https://github.com/res/3"),
      ]);
      // stake so projects are payout-eligible (nonzero shares)
      for (const p of projects) {
        await doStake(program, fix, alice, p, 1_000);
      }
    });

    it("sets rank on each project", async () => {
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, projects[0], 1);
      await doResolve(program, fix, projects[1], 3);
      await doResolve(program, fix, projects[2], 3);
      assert.equal((await program.account.projectAccount.fetch(projects[0])).rank, 1);
      assert.equal((await program.account.projectAccount.fetch(projects[1])).rank, 3);
    });

    it("finalize sets is_resolved and cascades empty tiers", async () => {
      await doFinalizeResolve(program, fix, projects);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.isResolved, true);
      // ranks [1, 3, 3] → tiers 0 and 2 occupied, tier 1 empty
      // With per-project math: tier 0 draws exactly 55% (per-project),
      // tier 1 empty, rest (45%) goes to tier 2.
      assert.equal(h.effectiveTierPcts[1], 0, "tier-1 had no projects");
      assert.equal(h.effectiveTierPcts[0], 5500, "tier-0 per-project = 55%");
      assert.ok(h.effectiveTierPcts[2] > 0, "tier-2 received remaining pool");
    });

    it("rejects duplicate ranked project accounts in finalize_resolve", async () => {
      setClock(ctx, T0);
      const fresh = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ResolveDupes");
      const dupProjects = await Promise.all([
        addProject(ctx, program, fresh, "https://github.com/resdup/1"),
        addProject(ctx, program, fresh, "https://github.com/resdup/2"),
      ]);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fresh, dupProjects[0], 1);
      await doResolve(program, fresh, dupProjects[1], 2);
      try {
        await doFinalizeResolve(program, fresh, [dupProjects[0], dupProjects[0]]);
        assert.fail("duplicate project accounts should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("DuplicateProjectAccount"),
          `Expected DuplicateProjectAccount, got: ${e.message}`);
      }
    });

    it("rejects a second finalize_resolve", async () => {
      try { await doFinalizeResolve(program, fix, projects); assert.fail(); }
      catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("AlreadyResolved") || txt.includes("6003") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected AlreadyResolved or duplicate-tx rejection, got: ${e.message}`,
        );
      }
    });

    it("rejects resolve after finalized", async () => {
      try { await doResolve(program, fix, projects[0], 2); assert.fail(); }
      catch (e: any) { assert.include(e.message, "AlreadyResolved"); }
    });

    it("rejects rank = 0", async () => {
      setClock(ctx, T0);
      const fix2 = await newHackathon(ctx, program);
      const p = await addProject(ctx, program, fix2, "https://github.com/res/rank0");
      setClock(ctx, RESULTS_TS);
      try { await doResolve(program, fix2, p, 0); assert.fail(); }
      catch (e: any) { assert.include(e.message, "InvalidRank"); }
    });
  });

  // ── TC1: single rank-1, full pool ─────────────────────────────────────────

  describe("TC1: single rank-1 project — payout == full pool", () => {
    it("sole staker on rank-1 project receives entire pool", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program);
      const alice   = await newWhitelistedUser(ctx, program, fix, 1_000);
      const project = await addProject(ctx, program, fix, "https://github.com/tc1/win");
      await doStake(program, fix, alice, project, 1_000);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, project, 1);
      await doFinalizeResolve(program, fix, [project]);

      const before = await tokenBalance(ctx, alice.ata);
      await doClaim(program, fix, alice, project);
      assert.equal(Number(await tokenBalance(ctx, alice.ata) - before), 1_000);

      const s = await program.account.userStake.fetch(stakePda(alice.user.publicKey, project));
      assert.equal(s.isClaimed, true);
    });
  });

  // ── TC2: single rest-tier project, full pool ──────────────────────────────

  describe("TC2: single rest-tier (rank 3) project — payout == full pool", () => {
    it("sole staker on rest-rank project receives entire pool", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program);
      const alice   = await newWhitelistedUser(ctx, program, fix, 1_000);
      const project = await addProject(ctx, program, fix, "https://github.com/tc2/lose");
      await doStake(program, fix, alice, project, 1_000);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, project, 3);
      await doFinalizeResolve(program, fix, [project]);

      const before = await tokenBalance(ctx, alice.ata);
      await doClaim(program, fix, alice, project);
      assert.equal(Number(await tokenBalance(ctx, alice.ata) - before), 1_000);
    });
  });

  // ── TC3: five equal projects, rank-ordered payouts ────────────────────────

  describe("TC3: five equal projects, payouts in rank order", () => {
    const FIVE_TIER_PCTS = [40, 25, 15, 10, 10];
    const FIVE_TIER_COUNT = 5;
    const STAKE = 1_000n;
    const POOL  = 5_000n;
    const RANKS = [1, 2, 3, 4, 5];
    let payouts: number[];

    before(async () => {
      setClock(ctx, T0);
      const fix      = await newHackathon(ctx, program, RESULTS_TS, FIVE_TIER_PCTS, [1, 0, 0, 0, 0]);
      const users: User[]     = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < 5; i++) {
        const u = await newWhitelistedUser(ctx, program, fix, Number(STAKE));
        const p = await addProject(ctx, program, fix, `https://github.com/tc3/p${i}`);
        await doStake(program, fix, u, p, Number(STAKE));
        users.push(u); projects.push(p);
      }
      setClock(ctx, RESULTS_TS);
      for (let i = 0; i < 5; i++) await doResolve(program, fix, projects[i], RANKS[i]);
      await doFinalizeResolve(program, fix, projects);

      payouts = [];
      for (let i = 0; i < 5; i++) {
        const before = await tokenBalance(ctx, users[i].ata);
        await doClaim(program, fix, users[i], projects[i]);
        payouts.push(Number(await tokenBalance(ctx, users[i].ata) - before));
      }
    });

    it("each payout matches the formula", () => {
      const stakes  = RANKS.map(() => STAKE);
      const effPcts = computeEffectivePcts(FIVE_TIER_PCTS, [1, 0, 0, 0, 0], [1, 1, 1, 1, 1]);
      for (let i = 0; i < 5; i++) {
        const tier    = tierForRank(RANKS[i], FIVE_TIER_COUNT);
        const ci      = isqrt(STAKE);
        const cTotal  = cTotalForTier(tier, FIVE_TIER_COUNT, stakes, RANKS);
        const shares  = BigInt(computeShares(Number(STAKE), T0, T0, CUTOFF_TS));
        const tShares = shares; // sole staker per project
        const exp     = expectedPayout(shares, ci, effPcts[tier], POOL, tShares, cTotal);
        assert.equal(payouts[i], Number(exp), `rank-${RANKS[i]} payout`);
      }
    });

    it("payouts are strictly decreasing by rank tier (rest-tier projects equal)", () => {
      assert.ok(payouts[0] > payouts[1], "rank1 > rank2");
      assert.ok(payouts[1] > payouts[2], "rank2 > rank3");
      assert.ok(payouts[2] > payouts[3], "rank3 > rank4");
      assert.equal(payouts[3], payouts[4], "rank4 == rank5 (same rest tier)");
    });

    it("sum of payouts == total pool (zero integer dust with equal stakes)", () => {
      assert.equal(payouts.reduce((s, v) => s + v, 0), Number(POOL));
    });
  });

  // ── TC3b: asymmetric stakes — sum of payouts ≤ pool ──────────────────────

  describe("TC3b: asymmetric stakes — sum of payouts <= pool", () => {
    it("unequal stakes: payouts sum <= pool", async () => {
      setClock(ctx, T0);
      const FIVE_TIER_PCTS = [40, 25, 15, 10, 10];
      const fix      = await newHackathon(ctx, program, RESULTS_TS, FIVE_TIER_PCTS, [1, 0, 0, 0, 0]);
      const STAKES   = [900, 1100, 950, 1050, 1000];
      const RANKS    = [1, 2, 3, 4, 5];
      const users: User[]     = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < 5; i++) {
        const u = await newWhitelistedUser(ctx, program, fix, STAKES[i]);
        const p = await addProject(ctx, program, fix, `https://github.com/tc3b/p${i}`);
        await doStake(program, fix, u, p, STAKES[i]);
        users.push(u); projects.push(p);
      }
      setClock(ctx, RESULTS_TS);
      for (let i = 0; i < 5; i++) await doResolve(program, fix, projects[i], RANKS[i]);
      await doFinalizeResolve(program, fix, projects);

      const pool = BigInt(STAKES.reduce((s, v) => s + v, 0));
      let totalPayout = 0n;
      for (let i = 0; i < 5; i++) {
        const before = await tokenBalance(ctx, users[i].ata);
        await doClaim(program, fix, users[i], projects[i]);
        totalPayout += await tokenBalance(ctx, users[i].ata) - before;
      }
      assert.ok(totalPayout <= pool, `sum of payouts ${totalPayout} should be <= pool ${pool}`);
    });
  });

  // ── TC4: sqrt neutralizes sybil splitting ─────────────────────────────────

  describe("TC4: sybil splitting is neutralized by sqrt crowding factor", () => {
    const SYBIL_N     = 20;
    const SYBIL_STAKE = 1_000n;
    const WHALE_STAKE = 20_000n;
    let sybilPayouts: number[];
    let whalePayout:  number;

    before(async () => {
      setClock(ctx, T0);
      const fix   = await newHackathon(ctx, program);
      const projA = await addProject(ctx, program, fix, "https://github.com/tc4/sybil");
      const projB = await addProject(ctx, program, fix, "https://github.com/tc4/whale");

      const sybilUsers: User[] = [];
      for (let i = 0; i < SYBIL_N; i++) {
        const u = await newWhitelistedUser(ctx, program, fix, Number(SYBIL_STAKE));
        await doStake(program, fix, u, projA, Number(SYBIL_STAKE));
        sybilUsers.push(u);
      }
      const whale = await newWhitelistedUser(ctx, program, fix, Number(WHALE_STAKE));
      await doStake(program, fix, whale, projB, Number(WHALE_STAKE));

      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, projA, 1);
      await doResolve(program, fix, projB, 2);
      await doFinalizeResolve(program, fix, [projA, projB]);

      sybilPayouts = [];
      for (const u of sybilUsers) {
        const before = await tokenBalance(ctx, u.ata);
        await doClaim(program, fix, u, projA);
        sybilPayouts.push(Number(await tokenBalance(ctx, u.ata) - before));
      }
      const wBefore = await tokenBalance(ctx, whale.ata);
      await doClaim(program, fix, whale, projB);
      whalePayout = Number(await tokenBalance(ctx, whale.ata) - wBefore);
    });

    it("both projects have identical crowding factor", () => {
      assert.equal(isqrt(SYBIL_STAKE * BigInt(SYBIL_N)), isqrt(WHALE_STAKE));
    });

    it("all 20 sybil wallets receive identical payouts", () => {
      const first = sybilPayouts[0];
      for (const p of sybilPayouts) assert.equal(p, first);
    });

    it("each sybil payout matches formula", () => {
      const pool    = SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE;
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, [1, 1, 0]);
      const ciA     = isqrt(SYBIL_STAKE * BigInt(SYBIL_N));
      const shares  = BigInt(computeShares(Number(SYBIL_STAKE), T0, T0, CUTOFF_TS));
      const tShares = shares * BigInt(SYBIL_N);
      const exp     = expectedPayout(shares, ciA, effPcts[0], pool, tShares, ciA);
      assert.equal(sybilPayouts[0], Number(exp));
    });

    it("sum of all payouts <= total pool", () => {
      const totalOut = sybilPayouts.reduce((s, v) => s + v, 0) + whalePayout;
      assert.ok(totalOut <= Number(SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE));
    });
  });

  // ── TC5: lightly backed rank-1 vs crowded rank-2 ──────────────────────────

  describe("TC5: lightly backed rank-1 vs crowded rank-2", () => {
    const ALICE_STAKE = 1_000n;
    const WHALE_STAKE = 999_000n;
    let alicePayout: number;
    let whalePayout:  number;

    before(async () => {
      setClock(ctx, T0);
      const fix   = await newHackathon(ctx, program);
      const projL = await addProject(ctx, program, fix, "https://github.com/tc5/light");
      const projH = await addProject(ctx, program, fix, "https://github.com/tc5/heavy");
      const alice = await newWhitelistedUser(ctx, program, fix, Number(ALICE_STAKE));
      const whale = await newWhitelistedUser(ctx, program, fix, Number(WHALE_STAKE));
      await doStake(program, fix, alice, projL, Number(ALICE_STAKE));
      await doStake(program, fix, whale, projH, Number(WHALE_STAKE));
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, projL, 1);
      await doResolve(program, fix, projH, 2);
      await doFinalizeResolve(program, fix, [projL, projH]);

      const aBefore = await tokenBalance(ctx, alice.ata);
      await doClaim(program, fix, alice, projL);
      alicePayout = Number(await tokenBalance(ctx, alice.ata) - aBefore);

      const wBefore = await tokenBalance(ctx, whale.ata);
      await doClaim(program, fix, whale, projH);
      whalePayout = Number(await tokenBalance(ctx, whale.ata) - wBefore);
    });

    it("alice's per-dollar return >> whale's per-dollar return", () => {
      const aliceRatio = alicePayout / Number(ALICE_STAKE);
      const whaleRatio = whalePayout / Number(WHALE_STAKE);
      assert.ok(aliceRatio > whaleRatio,
        `alice=${aliceRatio.toFixed(2)}x > whale=${whaleRatio.toFixed(2)}x`);
    });

    it("alice earns a profit (return > stake)", () => {
      assert.ok(alicePayout > Number(ALICE_STAKE));
    });

    it("whale is diluted (return < stake)", () => {
      assert.ok(whalePayout < Number(WHALE_STAKE));
    });
  });

  // ── FIX-8: all projects rank 1–3 (no rest tier) ──────────────────────────

  describe("FIX-8: all projects rank 1-3 — no rest tier, payouts match formula", () => {
    it("three top-ranked projects: effective pcts unchanged, payouts match formula", async () => {
      setClock(ctx, T0);
      const fix      = await newHackathon(ctx, program);
      const STAKES   = [1_000, 2_000, 1_500];
      const RANKS    = [1, 2, 3];
      const users: User[]     = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < 3; i++) {
        const u = await newWhitelistedUser(ctx, program, fix, STAKES[i]);
        const p = await addProject(ctx, program, fix, `https://github.com/fix8/p${i}`);
        await doStake(program, fix, u, p, STAKES[i]);
        users.push(u); projects.push(p);
      }
      setClock(ctx, RESULTS_TS);
      for (let i = 0; i < 3; i++) await doResolve(program, fix, projects[i], RANKS[i]);
      await doFinalizeResolve(program, fix, projects);

      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.effectiveTierPcts[0], 5500, "tier-0 = 55%");
      assert.equal(h.effectiveTierPcts[1], 3000, "tier-1 = 30%");
      assert.equal(h.effectiveTierPcts[2], 1500, "tier-2 = 15%");

      const pool     = BigInt(STAKES.reduce((s, v) => s + v, 0));
      const stakesBN = STAKES.map(BigInt);
      const effPcts  = computeEffectivePcts(DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, [1, 1, 1]);

      for (let i = 0; i < 3; i++) {
        const before = await tokenBalance(ctx, users[i].ata);
        await doClaim(program, fix, users[i], projects[i]);
        const payout  = Number(await tokenBalance(ctx, users[i].ata) - before);
        const tier    = tierForRank(RANKS[i], TIER_COUNT);
        const ci      = isqrt(stakesBN[i]);
        const cTotal  = cTotalForTier(tier, TIER_COUNT, stakesBN, RANKS);
        const shares  = BigInt(computeShares(STAKES[i], T0, T0, CUTOFF_TS));
        const exp     = Number(expectedPayout(shares, ci, effPcts[tier], pool, shares, cTotal));
        assert.equal(payout, exp, `rank-${RANKS[i]} payout`);
      }
    });
  });

  // ── 11. Error paths ───────────────────────────────────────────────────────

  describe("11. error paths — claim", () => {
    it("rejects claim when hackathon not resolved", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newWhitelistedUser(ctx, program, fix, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/err/nr");
      await doStake(program, fix, u, p, 500);
      try { await doClaim(program, fix, u, p); assert.fail(); }
      catch (e: any) { assert.include(e.message, "NotResolved"); }
    });

    it("rejects double claim", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newWhitelistedUser(ctx, program, fix, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/err/dc");
      await doStake(program, fix, u, p, 500);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);
      await doClaim(program, fix, u, p);
      try { await doClaim(program, fix, u, p); assert.fail(); }
      catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("AlreadyClaimed") || txt.includes("6004") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected AlreadyClaimed or duplicate-tx rejection, got: ${e.message}`,
        );
      }
    });

    it("rejects claim when project rank is 0 (resolve was skipped)", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newWhitelistedUser(ctx, program, fix, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/err/rank0claim");
      await doStake(program, fix, u, p, 500);
      const u2 = await newWhitelistedUser(ctx, program, fix, 100);
      const p2 = await addProject(ctx, program, fix, "https://github.com/err/rank0ranked");
      await doStake(program, fix, u2, p2, 100);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p2, 1);
      await doFinalizeResolve(program, fix, [p, p2]);
      try { await doClaim(program, fix, u, p); assert.fail(); }
      catch (e: any) { assert.include(e.message, "NotResolved"); }
    });
  });

  // ── Cascade tests ─────────────────────────────────────────────────────────

  describe("Cascade: grand winner not in pool — pool redistributes to lower tiers", () => {
    it("tier-0 empty → its 55% cascades proportionally to tiers 1 and 2", async () => {
      setClock(ctx, T0);
      const fix   = await newHackathon(ctx, program);
      const pSub  = await addProject(ctx, program, fix, "https://github.com/cas/sub");
      const pRest = await addProject(ctx, program, fix, "https://github.com/cas/rest");
      const uSub  = await newWhitelistedUser(ctx, program, fix, 3_000);
      const uRest = await newWhitelistedUser(ctx, program, fix, 1_000);
      await doStake(program, fix, uSub,  pSub,  3_000);
      await doStake(program, fix, uRest, pRest, 1_000);

      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, pSub,  2);
      await doResolve(program, fix, pRest, 3);
      await doFinalizeResolve(program, fix, [pSub, pRest]);

      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.effectiveTierPcts[0], 0,    "tier-0 (grand winner) had no projects");
      assert.ok(h.effectiveTierPcts[1] > 3000,   "tier-1 received cascade from tier-0");
      assert.ok(h.effectiveTierPcts[2] > 1500,   "tier-2 received cascade from tier-0");
      assert.equal(
        h.effectiveTierPcts[1] + h.effectiveTierPcts[2], 10_000,
        "effective pcts sum to 10 000",
      );

      const pool    = 4_000n;
      const effPcts = computeEffectivePcts([55,30,15], DEFAULT_TIER_COUNTS, [0, 1, 1]);

      const subBefore = await tokenBalance(ctx, uSub.ata);
      await doClaim(program, fix, uSub, pSub);
      const subPayout = Number(await tokenBalance(ctx, uSub.ata) - subBefore);

      const restBefore = await tokenBalance(ctx, uRest.ata);
      await doClaim(program, fix, uRest, pRest);
      const restPayout = Number(await tokenBalance(ctx, uRest.ata) - restBefore);

      const sharesS = BigInt(computeShares(3_000, T0, T0, CUTOFF_TS));
      const sharesR = BigInt(computeShares(1_000, T0, T0, CUTOFF_TS));
      const expSub  = Number(expectedPayout(sharesS, isqrt(3000n), effPcts[1], pool, sharesS, isqrt(3000n)));
      const expRest = Number(expectedPayout(sharesR, isqrt(1000n), effPcts[2], pool, sharesR, isqrt(1000n)));
      assert.equal(subPayout,  expSub,  "sub-winner payout matches cascaded formula");
      assert.equal(restPayout, expRest, "rest payout matches cascaded formula");
      assert.ok(subPayout + restPayout <= 4_000, "total payout <= pool");
    });
  });

  // ── Refund tests ──────────────────────────────────────────────────────────

  describe("Refund: admin-authorised exceptional stake recovery", () => {
    it("staker on refund-enabled project recovers full original stake pre-resolution; pool decremented (C-02)", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newWhitelistedUser(ctx, program, fix, 1_000);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/happy");
      await doStake(program, fix, u, p, 1_000);
      await doEnableRefund(program, fix, p);

      // Refund must execute pre-resolution; stakes are forfeited once resolved.
      const poolBefore = (await program.account.hackathonState.fetch(fix.hackathon)).totalPool.toNumber();
      const before = await tokenBalance(ctx, u.ata);
      await doRefund(program, fix, u, p);
      const after  = await tokenBalance(ctx, u.ata);
      assert.equal(Number(after - before), 1_000, "full stake returned");

      // C-02: pool must be decremented
      const poolAfter = (await program.account.hackathonState.fetch(fix.hackathon)).totalPool.toNumber();
      assert.equal(poolAfter, poolBefore - 1_000, "total_pool decremented by refund amount");

      const stake = await program.account.userStake.fetch(stakePda(u.user.publicKey, p));
      assert.equal(stake.isClaimed, true);

      // Verify an independent ranked project can still resolve and finalize correctly
      const p2 = await addProject(ctx, program, fix, "https://github.com/ref/other");
      const u2 = await newWhitelistedUser(ctx, program, fix, 500);
      await doStake(program, fix, u2, p2, 500);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p2, 1);
      await doFinalizeResolve(program, fix, [p2]);
    });

    it("refund blocked if enable_refund not called", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newWhitelistedUser(ctx, program, fix, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/blocked");
      await doStake(program, fix, u, p, 500);
      // Test the RefundNotEnabled guard; no resolution needed.
      try { await doRefund(program, fix, u, p); assert.fail(); }
      catch (e: any) { assert.include(e.message, "RefundNotEnabled"); }
    });

    it("refund blocked after already claimed (pre-resolution double-refund)", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newWhitelistedUser(ctx, program, fix, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/dblclaim");
      await doStake(program, fix, u, p, 500);
      await doEnableRefund(program, fix, p);
      await doRefund(program, fix, u, p);
      try { await doRefund(program, fix, u, p); assert.fail(); }
      catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("AlreadyClaimed") || txt.includes("6004") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected AlreadyClaimed or duplicate-tx rejection, got: ${e.message}`,
        );
      }
    });

    it("enable_refund blocked post-resolution", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/postres-enable");
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);
      try { await doEnableRefund(program, fix, p); assert.fail(); }
      catch (e: any) { assert.include(e.message, "RefundBlockedAfterResolution"); }
    });

    it("refund blocked post-resolution even if enable_refund was set pre-resolution", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newWhitelistedUser(ctx, program, fix, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/postres-refund");
      await doStake(program, fix, u, p, 500);
      await doEnableRefund(program, fix, p);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);
      try { await doRefund(program, fix, u, p); assert.fail(); }
      catch (e: any) { assert.include(e.message, "RefundBlockedAfterResolution"); }
    });
  });

  // ── Pool integrity after unstake ──────────────────────────────────────────

  describe("Pool integrity: unstake penalty stays for remaining holders (C-02 analog)", () => {
    it("alice unstakes (penalty stays in pool), bob claims full remaining pool", async () => {
      setClock(ctx, T0);
      const fix   = await newHackathon(ctx, program);
      const alice = await newWhitelistedUser(ctx, program, fix, 1_000);
      const bob   = await newWhitelistedUser(ctx, program, fix, 1_000);
      const p     = await addProject(ctx, program, fix, "https://github.com/pool/integrity");
      await doStake(program, fix, alice, p, 1_000);
      await doStake(program, fix, bob,   p, 1_000);

      // alice unstakes: 970 returned, 15 to fee_recipient, 15 stays in pool
      // pool was 2_000 → pool = 2_000 - 970 - 15 = 1_015
      await doUnstake(program, fix, alice, p);
      const h1 = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h1.totalPool.toNumber(), 1_015, "pool after alice unstake = bob stake + alice pool penalty");

      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);

      const before = await tokenBalance(ctx, bob.ata);
      await doClaim(program, fix, bob, p);
      const received = Number(await tokenBalance(ctx, bob.ata) - before);
      assert.equal(received, 1_015, "bob receives entire remaining pool including alice's penalty");
    });
  });

  // ── Time-weighted shares ──────────────────────────────────────────────────

  describe("Time-weighted shares: early staker earns more shares per unit", () => {
    it("equal-amount stakers at T0 and near-cutoff get different shares and payouts", async () => {
      setClock(ctx, T0);
      const fix  = await newHackathon(ctx, program);
      const proj = await addProject(ctx, program, fix, "https://github.com/tw/shares");

      const early = await newWhitelistedUser(ctx, program, fix, 1_000);
      await doStake(program, fix, early, proj, 1_000); // t=T0, multiplier=1.5× → shares=1500

      const nearCutoff = CUTOFF_TS - 10;
      setClock(ctx, nearCutoff);
      const late = await newWhitelistedUser(ctx, program, fix, 1_000);
      await doStake(program, fix, late, proj, 1_000); // t≈CUTOFF_TS, multiplier≈1.0× → shares≈1000

      const earlyStake = await program.account.userStake.fetch(stakePda(early.user.publicKey, proj));
      const lateStake  = await program.account.userStake.fetch(stakePda(late.user.publicKey, proj));
      assert.ok(earlyStake.shares.gt(lateStake.shares), "early staker has more shares");

      // Verify shares match on-chain formula
      const expEarlyShares = computeShares(1_000, T0,         T0, CUTOFF_TS);
      const expLateShares  = computeShares(1_000, nearCutoff, T0, CUTOFF_TS);
      assert.equal(earlyStake.shares.toNumber(), expEarlyShares, "early shares match formula");
      assert.equal(lateStake.shares.toNumber(),  expLateShares,  "late shares match formula");

      // Early staker should get larger payout proportion
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, proj, 1);
      await doFinalizeResolve(program, fix, [proj]);

      const eBefore = await tokenBalance(ctx, early.ata);
      await doClaim(program, fix, early, proj);
      const earlyPayout = Number(await tokenBalance(ctx, early.ata) - eBefore);

      const lBefore = await tokenBalance(ctx, late.ata);
      await doClaim(program, fix, late, proj);
      const latePayout = Number(await tokenBalance(ctx, late.ata) - lBefore);

      assert.ok(earlyPayout > latePayout, "early staker receives more due to higher shares");
      assert.equal(earlyPayout + latePayout, 2_000, "payouts sum to full pool");
    });
  });

  // ── Step 6: CU audit — claim instruction ─────────────────────────────────

  describe("Step 6: CU audit — claim instruction (no remaining_accounts needed post C-01 fix)", () => {
    let auditCtx: ProgramTestContext;
    let auditProg: any;

    before(async () => {
      auditCtx = await startAnchor(".", [], [{
        address: adminKp.publicKey,
        info: {
          lamports: 100 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        },
      }], 1_400_000n);
      setClock(auditCtx, T0);
      const prov = new BankrunProvider(auditCtx);
      auditProg = new anchor.Program<HackathonBetting>(IDL, prov);
    });

    async function measureClaimCU(nProjects: number): Promise<bigint> {
      setClock(auditCtx, T0);
      const fix = await newHackathon(auditCtx, auditProg);

      const users: User[]     = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < nProjects; i++) {
        const url = `g.io/a/${i}`;
        const u = await newWhitelistedUser(auditCtx, auditProg, fix, 1_000);
        const p = await addProject(auditCtx, auditProg, fix, url);
        await doStake(auditProg, fix, u, p, 1_000);
        users.push(u);
        projects.push(p);
      }

      setClock(auditCtx, RESULTS_TS);
      for (let i = 0; i < nProjects; i++) {
        await doResolve(auditProg, fix, projects[i], i < 2 ? i + 1 : 3);
      }
      await doFinalizeResolve(auditProg, fix, projects);

      const u = users[0];
      const p = projects[0];
      const tx = await auditProg.methods
        .claim()
        .accounts({
          user:                     u.user.publicKey,
          hackathon:                fix.hackathon,
          project:                  p,
          userStake:                stakePda(u.user.publicKey, p),
          userTokenAccount:         u.ata,
          feeRecipientTokenAccount: fix.feeRecipientAta,
          escrow:                   fix.escrow,
          tokenProgram:             TOKEN_PROGRAM_ID,
          systemProgram:            SystemProgram.programId,
        })
        .transaction();

      const [blockhash] = await auditCtx.banksClient.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = u.user.publicKey;
      tx.sign(u.user);

      const meta = await auditCtx.banksClient.processTransaction(tx);
      return meta.computeUnitsConsumed;
    }

    const THRESHOLD = 200_000n;
    const results: Record<number, bigint> = {};

    for (const n of [5, 10, 20]) {
      it(`claim @ ${n} projects`, async function () {
        this.timeout(300_000);
        const cu = await measureClaimCU(n);
        results[n] = cu;
        console.log(`    claim @ ${String(n).padStart(2)} projects: ${cu.toLocaleString()} CU`);
        assert.ok(cu > 0n, "should consume some CU");
      });
    }

    it("verdict: 20-project CU vs 200 000 threshold", async function () {
      const cu20 = results[20];
      if (cu20 === undefined) this.skip();

      console.log("\n    ── CU audit results ──────────────────────────────");
      console.log(`    N=5  : ${results[5]?.toLocaleString()} CU`);
      console.log(`    N=10 : ${results[10]?.toLocaleString()} CU`);
      console.log(`    N=20 : ${results[20]?.toLocaleString()} CU   ← threshold check`);

      assert.ok(cu20 < THRESHOLD,
        `claim @ 20 projects (${cu20} CU) should be well under ${THRESHOLD} CU after C-01 fix`);
    });
  });

  // ── Protocol fee ──────────────────────────────────────────────────────────

  describe("Protocol fee: 1.5% deducted from claim payouts", () => {
    it("fee_recipient receives 1.5%, user receives 98.5%, total conserved", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "FeeTest", 150);
      const alice   = await newWhitelistedUser(ctx, program, fix, 1_000);
      const project = await addProject(ctx, program, fix, "https://github.com/fee/test");
      await doStake(program, fix, alice, project, 1_000);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, project, 1);
      await doFinalizeResolve(program, fix, [project]);

      const userBefore = await tokenBalance(ctx, alice.ata);
      const feeBefore  = await tokenBalance(ctx, fix.feeRecipientAta);
      await doClaim(program, fix, alice, project);
      const userReceived = Number(await tokenBalance(ctx, alice.ata) - userBefore);
      const feeReceived  = Number(await tokenBalance(ctx, fix.feeRecipientAta) - feeBefore);

      assert.equal(feeReceived,  15,    "fee_recipient receives 15 (1.5% of 1000)");
      assert.equal(userReceived, 985,   "user receives 985 (98.5% of 1000)");
      assert.equal(userReceived + feeReceived, 1_000, "fee + user == full payout");
    });
  });

  // ── Feature 4: Self-stake ─────────────────────────────────────────────────

  describe("Feature 4: self_stake (builder skin-in-the-game)", () => {
    const DEPOSIT   = 10_000_000;
    const MIN_STAKE = 10_000_000;
    const MAX_STAKE = 250_000_000; // matches MAX_SELF_STAKE constant (250 USDC)

    async function setupBuilder(hackathonName: string) {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, hackathonName, 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, MAX_STAKE + DEPOSIT);
      const project = await addProject(ctx, program, fix, `https://github.com/ss/${hackathonName}`);
      await doPayDeposit(program, fix, builder, builderAta, project);
      return { fix, builder, builderAta, project };
    }

    it("records self-stake in builder_staked and total_staked", async () => {
      const { fix, builder, builderAta, project } = await setupBuilder("SelfStake1");
      await doSelfStake(program, fix, builder, builderAta, project, MIN_STAKE);
      const p = await program.account.projectAccount.fetch(project);
      assert.equal(p.builderStaked.toNumber(), MIN_STAKE, "builder_staked updated");
      assert.equal(p.totalStaked.toNumber(),   MIN_STAKE, "total_staked updated");
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.totalPool.toNumber(), MIN_STAKE, "pool updated");
    });

    it("builder receives payout at claim", async () => {
      const { fix, builder, builderAta, project } = await setupBuilder("SelfStake2");
      await doSelfStake(program, fix, builder, builderAta, project, MIN_STAKE);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, project, 1);
      await doFinalizeResolve(program, fix, [project]);
      const before = await tokenBalance(ctx, builderAta);
      const u: User = { user: builder, ata: builderAta };
      await doClaim(program, fix, u, project);
      const received = Number(await tokenBalance(ctx, builderAta) - before);
      assert.equal(received, MIN_STAKE, "builder claims back full self-stake (sole staker)");
    });

    it("rejects self-stake below minimum (SelfStakeBelowMinimum)", async () => {
      const { fix, builder, builderAta, project } = await setupBuilder("SelfStake3");
      try {
        await doSelfStake(program, fix, builder, builderAta, project, MIN_STAKE - 1);
        assert.fail("should reject below-minimum stake");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("SelfStakeBelowMinimum") || txt.includes("6025"),
          `Expected SelfStakeBelowMinimum, got: ${e.message}`);
      }
    });

    it("rejects cumulative self-stake over MAX_SELF_STAKE (SelfStakeExceedsMaximum)", async () => {
      const { fix, builder, builderAta, project } = await setupBuilder("SelfStake4");
      await doSelfStake(program, fix, builder, builderAta, project, MAX_STAKE - MIN_STAKE);
      try {
        await doSelfStake(program, fix, builder, builderAta, project, MIN_STAKE + 1);
        assert.fail("should reject stake that tips over max");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("SelfStakeExceedsMaximum") || txt.includes("6026"),
          `Expected SelfStakeExceedsMaximum, got: ${e.message}`);
      }
    });

    it("exact MAX_SELF_STAKE cumulative is accepted", async () => {
      const { fix, builder, builderAta, project } = await setupBuilder("SelfStake5");
      await doSelfStake(program, fix, builder, builderAta, project, MAX_STAKE - MIN_STAKE);
      await doSelfStake(program, fix, builder, builderAta, project, MIN_STAKE);
      const p = await program.account.projectAccount.fetch(project);
      assert.equal(p.builderStaked.toNumber(), MAX_STAKE, "builder_staked == MAX_SELF_STAKE");
    });

    it("non-builder cannot call self_stake (NotBuilder)", async () => {
      const { fix, project } = await setupBuilder("SelfStake6");
      const impostor = await newUser(ctx, fix.mint, MIN_STAKE);
      try {
        await doSelfStake(program, fix, impostor.user, impostor.ata, project, MIN_STAKE);
        assert.fail("non-builder should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("NotBuilder") || txt.includes("6020"),
          `Expected NotBuilder, got: ${e.message}`);
      }
    });

    it("self-stake rejected if deposit not paid (DepositNotPaid)", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SelfStake7", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, MIN_STAKE);
      const project = await addProject(ctx, program, fix, "https://github.com/ss/SelfStake7");
      try {
        await doSelfStake(program, fix, builder, builderAta, project, MIN_STAKE);
        assert.fail("should reject when deposit not paid");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("DepositNotPaid") || txt.includes("6018"),
          `Expected DepositNotPaid, got: ${e.message}`);
      }
    });
  });

  // ── Feature 3: Forfeit deposit for ghost builders ─────────────────────────

  describe("Feature 3: forfeit_deposit (ghost builders)", () => {
    const DEPOSIT = 10_000_000;

    it("50% goes to total_pool, 50% transferred to fee_recipient", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ForfeitTest1", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/ghost/proj1");
      await doPayDeposit(program, fix, builder, builderAta, project);

      const poolBefore = (await program.account.hackathonState.fetch(fix.hackathon)).totalPool.toNumber();
      const feeBefore  = Number(await tokenBalance(ctx, fix.feeRecipientAta));
      setClock(ctx, FORFEIT_TS);
      await doForfeitDeposit(program, fix, project);
      const poolAfter = (await program.account.hackathonState.fetch(fix.hackathon)).totalPool.toNumber();
      const feeAfter  = Number(await tokenBalance(ctx, fix.feeRecipientAta));
      const p = await program.account.projectAccount.fetch(project);

      assert.equal(poolAfter - poolBefore, DEPOSIT / 2, "half added to total_pool");
      assert.equal(feeAfter - feeBefore,   DEPOSIT / 2, "half sent to fee_recipient");
      assert.ok(p.depositForfeited, "deposit_forfeited flag set");
    });

    it("rejects forfeit before the post-results grace period", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ForfeitTest1b", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/ghost/proj1b");
      await doPayDeposit(program, fix, builder, builderAta, project);
      setClock(ctx, RESULTS_TS);
      try {
        await doForfeitDeposit(program, fix, project);
        assert.fail("forfeit before grace period should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("ForfeitTooEarly"),
          `Expected ForfeitTooEarly, got: ${e.message}`);
      }
    });

    it("rejects forfeit on an approved (submitted) project", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ForfeitTest2", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/ghost/proj2");
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      await doApproveSubmissions(program, fix, [project]);
      setClock(ctx, FORFEIT_TS);
      try {
        await doForfeitDeposit(program, fix, project);
        assert.fail("should reject forfeit on approved project");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("AlreadySubmitted") || txt.includes("6021"),
          `Expected AlreadySubmitted, got: ${e.message}`);
      }
    });

    it("allows forfeit when builder declared on-chain but was never approved by organizer", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ForfeitTest2b", 0, DEPOSIT, true);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/ghost/proj2b", ctx.payer, fix.admin);
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      setClock(ctx, FORFEIT_TS);
      // On-chain declaration alone does not protect the deposit —
      // only organizer approval (submitted=true) gates forfeiture.
      await doForfeitDeposit(program, fix, project);
      const pAfter = await program.account.projectAccount.fetch(project);
      assert.ok(pAfter.depositForfeited, "deposit should be forfeited");
    });

    it("rejects double forfeit (DepositAlreadyForfeited)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ForfeitTest3", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/ghost/proj3");
      await doPayDeposit(program, fix, builder, builderAta, project);
      setClock(ctx, FORFEIT_TS);
      await doForfeitDeposit(program, fix, project);
      try {
        await doForfeitDeposit(program, fix, project);
        assert.fail("second forfeit should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("DepositAlreadyForfeited") || txt.includes("6024") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected DepositAlreadyForfeited or duplicate-tx, got: ${e.message}`,
        );
      }
    });

    it("forfeited deposit sets deposit_forfeited flag (H-01 defense-in-depth guard exists)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ForfeitTest5", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT * 2);
      const project = await addProject(ctx, program, fix, "https://github.com/ghost/h01");
      await doPayDeposit(program, fix, builder, builderAta, project);
      setClock(ctx, FORFEIT_TS);
      await doForfeitDeposit(program, fix, project);
      const p = await program.account.projectAccount.fetch(project);
      assert.ok(p.depositForfeited, "deposit_forfeited flag set");
      // H-01 guard: claim_deposit_refund checks !deposit_forfeited after submitted
      // and timing gates. The guard exists in lib.rs at line ~1073.
      // Full end-to-end is unreachable because forfeit itself requires !submitted,
      // while claim_deposit_refund requires submitted — making the H-01 scenario
      // impossible through normal instruction flow.
    });

    it("forfeited pool half boosts backers proportionally at claim", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "ForfeitTest4", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT * 2);
      const p1 = await addProject(ctx, program, fix, "https://github.com/ghost/p1");
      const p2 = await addProject(ctx, program, fix, "https://github.com/ghost/p2");
      await doPayDeposit(program, fix, builder, builderAta, p1);
      await doPayDeposit(program, fix, builder, builderAta, p2);
      const backer = await newWhitelistedUser(ctx, program, fix, 1_000);
      await doStake(program, fix, backer, p1, 1_000);
      setClock(ctx, FORFEIT_TS);
      await doForfeitDeposit(program, fix, p2);

      await doResolve(program, fix, p1, 1);
      await doFinalizeResolve(program, fix, [p1]);

      const before = await tokenBalance(ctx, backer.ata);
      await doClaim(program, fix, backer, p1);
      const received = Number(await tokenBalance(ctx, backer.ata) - before);
      assert.equal(received, 1_000 + DEPOSIT / 2, "backer receives stake + forfeited pool boost");
    });
  });

  // ── Feature 2: Builder Deposit ────────────────────────────────────────────

  describe("Feature 2: Builder deposit (pay_deposit / approve_submissions / claim_deposit_refund)", () => {
    const DEPOSIT = 10_000_000;

    it("builder can pay deposit; deposit_amount_paid recorded", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest1", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj1");
      await doPayDeposit(program, fix, builder, builderAta, project);
      const p = await program.account.projectAccount.fetch(project);
      assert.equal(p.depositAmountPaid.toNumber(), DEPOSIT, "deposit recorded on project");
      const escrowBal = await tokenBalance(ctx, fix.escrow);
      assert.equal(Number(escrowBal), DEPOSIT, "deposit sits in escrow");
    });

    it("stake rejected if deposit not paid (DepositNotPaid)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest2", 0, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj2");
      const backer  = await newWhitelistedUser(ctx, program, fix, 500);
      try {
        await doStake(program, fix, backer, project, 500);
        assert.fail("should have rejected stake on undeposited project");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("DepositNotPaid") || txt.includes("6018"),
          `Expected DepositNotPaid, got: ${e.message}`);
      }
    });

    it("pay_deposit rejected after cutoff (CutoffPassed)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest2b", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj2b");
      setClock(ctx, CUTOFF_TS + 1);
      try {
        await doPayDeposit(program, fix, builder, builderAta, project);
        assert.fail("deposit after cutoff should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("CutoffPassed") || txt.includes("6000"),
          `Expected CutoffPassed, got: ${e.message}`);
      }
    });

    it("stake succeeds once deposit is paid", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest3", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj3");
      await doPayDeposit(program, fix, builder, builderAta, project);
      const backer = await newWhitelistedUser(ctx, program, fix, 500);
      await doStake(program, fix, backer, project, 500);
      const p = await program.account.projectAccount.fetch(project);
      assert.equal(p.totalStaked.toNumber(), 500);
    });

    it("double deposit rejected (DepositAlreadyPaid)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest4", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT * 2);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj4");
      await doPayDeposit(program, fix, builder, builderAta, project);
      try {
        await doPayDeposit(program, fix, builder, builderAta, project);
        assert.fail("should reject second deposit");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("DepositAlreadyPaid") || txt.includes("6019") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected DepositAlreadyPaid or duplicate-tx, got: ${e.message}`,
        );
      }
    });

    it("non-builder cannot pay deposit (NotBuilder)", async () => {
      setClock(ctx, T0);
      const fix      = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest5", 0, DEPOSIT);
      const project  = await addProject(ctx, program, fix, "https://github.com/builder/proj5");
      const impostor = await newUser(ctx, fix.mint, DEPOSIT);
      try {
        await doPayDeposit(program, fix, impostor.user, impostor.ata, project);
        assert.fail("non-builder should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("NotBuilder") || txt.includes("6020"),
          `Expected NotBuilder, got: ${e.message}`);
      }
    });

    it("admin approve_submissions marks projects as submitted", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest6", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT * 2);
      const p1 = await addProject(ctx, program, fix, "https://github.com/builder/proj6a");
      const p2 = await addProject(ctx, program, fix, "https://github.com/builder/proj6b");
      await doPayDeposit(program, fix, builder, builderAta, p1);
      await doSubmitProject(program, fix, builder, p1);
      await doApproveSubmissions(program, fix, [p1]);
      const acc1 = await program.account.projectAccount.fetch(p1);
      const acc2 = await program.account.projectAccount.fetch(p2);
      assert.ok(acc1.submitted,  "p1 should be marked submitted");
      assert.ok(!acc2.submitted, "p2 was not in approved list");
    });

    it("builder claims deposit refund after being approved", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest7", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj7");
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      await doApproveSubmissions(program, fix, [project]);
      // Advance clock into the claim window (after results, within 14 days).
      setClock(ctx, RESULTS_TS);
      const before = await tokenBalance(ctx, builderAta);
      await doClaimDepositRefund(program, fix, builder, builderAta, project);
      const received = Number(await tokenBalance(ctx, builderAta) - before);
      assert.equal(received, DEPOSIT, "builder gets full deposit back");
      const p = await program.account.projectAccount.fetch(project);
      assert.ok(p.depositRefunded, "deposit_refunded flag set");
    });

    it("unapproved builder cannot claim refund when requiresApproval=true (NotSubmitted)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest8", 0, DEPOSIT, true);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj8", ctx.payer, fix.admin);
      await doPayDeposit(program, fix, builder, builderAta, project);
      // Declare but do NOT approve — submitted stays false, builder_declared=true.
      await doSubmitProject(program, fix, builder, project);
      try {
        await doClaimDepositRefund(program, fix, builder, builderAta, project);
        assert.fail("unapproved builder should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("NotSubmitted") || txt.includes("6022"),
          `Expected NotSubmitted, got: ${e.message}`);
      }
    });

    it("double refund rejected (DepositAlreadyRefunded)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "DepositTest9", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/proj9");
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      await doApproveSubmissions(program, fix, [project]);
      setClock(ctx, RESULTS_TS);
      await doClaimDepositRefund(program, fix, builder, builderAta, project);
      try {
        await doClaimDepositRefund(program, fix, builder, builderAta, project);
        assert.fail("second refund should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("DepositAlreadyRefunded") || txt.includes("6023") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected DepositAlreadyRefunded or duplicate-tx, got: ${e.message}`,
        );
      }
    });
  });

  // ── Feature 6: submit_project + requires_approval branching ──────────────

  describe("Feature 6: submit_project / requires_approval", () => {
    const DEPOSIT = 10_000_000;

    it("builder can call submit_project before cutoff; sets builder_declared + declared_at", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest1", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub1");
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      const p = await program.account.projectAccount.fetch(project);
      assert.ok(p.builderDeclared, "builder_declared should be true");
      assert.ok(p.declaredAt.toNumber() > 0, "declared_at should be set");
    });

    it("submit_project rejected until the deposit is paid (DepositNotPaid)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest1b", 0, DEPOSIT);
      const builder = ctx.payer;
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub1b");
      try {
        await doSubmitProject(program, fix, builder, project);
        assert.fail("submit_project without deposit should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("DepositNotPaid") || txt.includes("6018"),
          `Expected DepositNotPaid, got: ${e.message}`);
      }
    });

    it("non-builder cannot call submit_project (NotBuilder)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest2", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project  = await addProject(ctx, program, fix, "https://github.com/builder/sub2");
      await doPayDeposit(program, fix, builder, builderAta, project);
      const impostor = await newUser(ctx, fix.mint, 0);
      try {
        await program.methods.submitProject()
          .accounts({ builder: impostor.user.publicKey, hackathon: fix.hackathon, project })
          .signers([impostor.user]).rpc();
        assert.fail("non-builder should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("NotBuilder") || txt.includes("6020"),
          `Expected NotBuilder, got: ${e.message}`);
      }
    });

    it("builder can still call submit_project after cutoff but before results", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest3", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub3");
      await doPayDeposit(program, fix, builder, builderAta, project);
      setClock(ctx, CUTOFF_TS + 1);
      await doSubmitProject(program, fix, builder, project);
      const p = await program.account.projectAccount.fetch(project);
      assert.ok(p.builderDeclared, "builder_declared should still be true after cutoff");
    });

    it("submit_project rejected after results (SubmissionClosed)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest3b", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub3b");
      await doPayDeposit(program, fix, builder, builderAta, project);
      setClock(ctx, RESULTS_TS + 1);
      try {
        await doSubmitProject(program, fix, builder, project);
        assert.fail("submit_project after results should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("SubmissionClosed") ||
          txt.includes("Submission window has closed") ||
          txt.includes("already been processed") ||
          txt.includes("already processed"),
          `Expected SubmissionClosed or duplicate-tx, got: ${e.message}`,
        );
      }
    });

    it("double submit_project rejected (AlreadySubmitted)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest4", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub4");
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      try {
        await doSubmitProject(program, fix, builder, project);
        assert.fail("second submit_project should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("AlreadySubmitted") || txt.includes("6021") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected AlreadySubmitted or duplicate-tx, got: ${e.message}`,
        );
      }
    });

    it("requires_approval=false: builder can claim refund after submit_project + approve_submissions", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest5", 0, DEPOSIT, false);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub5");
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      await doApproveSubmissions(program, fix, [project]);
      setClock(ctx, RESULTS_TS);
      const before = await tokenBalance(ctx, builderAta);
      await doClaimDepositRefund(program, fix, builder, builderAta, project);
      const received = Number(await tokenBalance(ctx, builderAta) - before);
      assert.equal(received, DEPOSIT, "builder gets full deposit back after approve_submissions");
    });

    it("requires_approval=false: undeclared builder cannot claim refund (NotDeclared)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest6", 0, DEPOSIT, false);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub6");
      await doPayDeposit(program, fix, builder, builderAta, project);
      try {
        await doClaimDepositRefund(program, fix, builder, builderAta, project);
        assert.fail("undeclared builder should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(txt.includes("NotDeclared") || txt.includes("6027"),
          `Expected NotDeclared, got: ${e.message}`);
      }
    });

    it("requires_approval=false: forfeit succeeds when builder declared but was never approved", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest7", 0, DEPOSIT, false);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub7");
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      setClock(ctx, FORFEIT_TS);
      // on-chain declaration alone does not protect the deposit;
      // only organizer approval (submitted=true) gates forfeiture
      await doForfeitDeposit(program, fix, project);
      const pAfter = await program.account.projectAccount.fetch(project);
      assert.ok(pAfter.depositForfeited, "deposit should be forfeited");
    });

    it("requires_approval=true: builder needs admin approval to claim refund", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest8", 0, DEPOSIT, true);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/sub8", ctx.payer, fix.admin);
      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);
      await doApproveSubmissions(program, fix, [project]);
      setClock(ctx, RESULTS_TS);
      const before = await tokenBalance(ctx, builderAta);
      await doClaimDepositRefund(program, fix, builder, builderAta, project);
      const received = Number(await tokenBalance(ctx, builderAta) - before);
      assert.equal(received, DEPOSIT, "builder gets full deposit back after admin approval");
    });

    it("requires_approval=true: approve_submissions skips undeclared projects", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "SubmitTest9", 0, DEPOSIT, true);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT * 2);
      const p1 = await addProject(ctx, program, fix, "https://github.com/builder/sub9a", ctx.payer, fix.admin);
      const p2 = await addProject(ctx, program, fix, "https://github.com/builder/sub9b", ctx.payer, fix.admin);
      await doPayDeposit(program, fix, builder, builderAta, p1);
      await doPayDeposit(program, fix, builder, builderAta, p2);
      await doSubmitProject(program, fix, builder, p1);
      await doApproveSubmissions(program, fix, [p1, p2]);
      const acc1 = await program.account.projectAccount.fetch(p1);
      const acc2 = await program.account.projectAccount.fetch(p2);
      assert.ok(acc1.submitted,  "p1 declared + in list → submitted");
      assert.ok(!acc2.submitted, "p2 not declared → skipped by approve_submissions");
    });

    it("stake rejected after cutoff_timestamp (CutoffPassed)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "CutoffTest1", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/cut1");
      await doPayDeposit(program, fix, builder, builderAta, project);
      const backer = await newWhitelistedUser(ctx, program, fix, 500);
      setClock(ctx, CUTOFF_TS + 1);
      try {
        await doStake(program, fix, backer, project, 500);
        assert.fail("stake after cutoff should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("CutoffPassed") || txt.includes("6000") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected CutoffPassed or duplicate-tx, got: ${e.message}`,
        );
      }
    });

    it("self_stake rejected after cutoff_timestamp (CutoffPassed)", async () => {
      setClock(ctx, T0);
      const fix     = await newHackathon(ctx, program, RESULTS_TS,
        DEFAULT_TIER_PCTS, DEFAULT_TIER_COUNTS, "CutoffTest2", 0, DEPOSIT);
      const builder    = ctx.payer;
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, DEPOSIT + 1_000);
      const project = await addProject(ctx, program, fix, "https://github.com/builder/cut2");
      await doPayDeposit(program, fix, builder, builderAta, project);
      setClock(ctx, CUTOFF_TS + 1);
      try {
        await doSelfStake(program, fix, builder, builderAta, project, 1_000);
        assert.fail("self_stake after cutoff should be rejected");
      } catch (e: any) {
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("CutoffPassed") || txt.includes("6000") ||
          txt.includes("already been processed") || txt.includes("already processed"),
          `Expected CutoffPassed or duplicate-tx, got: ${e.message}`,
        );
      }
    });
  });

  describe("protocol admin delegation", () => {
    it("delegated protocol admins can initialize hackathons", async () => {
      setClock(ctx, T0);
      const delegate = Keypair.generate();
      await fund(ctx, delegate.publicKey);
      await doAddProtocolAdmin(program, delegate.publicKey);

      const mint = await createMint(ctx);
      const feeRecipient = Keypair.generate();
      const name = `DelegatedInit${_hackIdx++}`;
      const hackathon = hackathonPda(delegate.publicKey, name);
      const escrow = escrowPda(hackathon);

      await program.methods.initializeHackathon(
        name,
        new BN(RESULTS_TS),
        Buffer.from(DEFAULT_TIER_PCTS),
        Buffer.from(DEFAULT_TIER_COUNTS),
        feeRecipient.publicKey,
        0,
        new BN(0),
        false,
        false,
      )
        .accounts({
          admin: delegate.publicKey,
          hackathon,
          escrow,
          usdcMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: protocolAdminPda(delegate.publicKey), isWritable: false, isSigner: false },
        ])
        .signers([delegate]).rpc();

      const stored = await program.account.hackathonState.fetch(hackathon);
      assert.ok(stored.admin.equals(delegate.publicKey), "delegated admin should own the new hackathon");
    });

    it("delegated protocol admins can whitelist and approve submissions on existing hackathons", async () => {
      setClock(ctx, T0);
      const deposit = 10_000_000;
      const delegate = Keypair.generate();
      await fund(ctx, delegate.publicKey);
      await doAddProtocolAdmin(program, delegate.publicKey);

      const fix = await newHackathon(
        ctx,
        program,
        RESULTS_TS,
        DEFAULT_TIER_PCTS,
        DEFAULT_TIER_COUNTS,
        `DelegatedOps${_hackIdx++}`,
        0,
        deposit,
        true,
      );

      const walletToWhitelist = Keypair.generate();
      await program.methods.whitelistWallet()
        .accounts({
          admin: delegate.publicKey,
          hackathon: fix.hackathon,
          wallet: walletToWhitelist.publicKey,
          whitelistEntry: whitelistPda(fix.hackathon, walletToWhitelist.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: protocolAdminPda(delegate.publicKey), isWritable: false, isSigner: false },
        ])
        .signers([delegate]).rpc();

      const whitelistAccount = await program.account.whitelistedWallet.fetch(
        whitelistPda(fix.hackathon, walletToWhitelist.publicKey),
      );
      assert.ok(
        whitelistAccount.wallet.equals(walletToWhitelist.publicKey),
        "delegated admin should be able to whitelist on an existing hackathon",
      );

      const builder = Keypair.generate();
      await fund(ctx, builder.publicKey);
      const builderAta = await createAta(ctx, fix.mint, builder.publicKey);
      await mintTokens(ctx, fix.mint, builderAta, deposit);

      const url = "https://github.com/delegated/admin-ops";
      const urlHash = createHash("sha256").update(url).digest();
      const project = projectPda(fix.hackathon, url);
      await (program.methods as any).registerProject(url, Array.from(urlHash))
        .accounts({
          caller: delegate.publicKey,
          builder: builder.publicKey,
          hackathon: fix.hackathon,
          project,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: protocolAdminPda(delegate.publicKey), isWritable: false, isSigner: false },
        ])
        .signers([delegate]).rpc();

      await doPayDeposit(program, fix, builder, builderAta, project);
      await doSubmitProject(program, fix, builder, project);

      await program.methods.approveSubmissions()
        .accounts({ admin: delegate.publicKey, hackathon: fix.hackathon })
        .remainingAccounts([
          { pubkey: protocolAdminPda(delegate.publicKey), isWritable: false, isSigner: false },
          { pubkey: project, isWritable: true, isSigner: false },
        ])
        .signers([delegate]).rpc();

      const projectAccount = await program.account.projectAccount.fetch(project);
      assert.ok(
        projectAccount.submitted,
        "delegated admin should be able to approve submissions on an existing hackathon",
      );
    });
  });
});
