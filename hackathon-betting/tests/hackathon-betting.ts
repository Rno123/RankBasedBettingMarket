import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { createHash } from "crypto";
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

const PROGRAM_ID = new PublicKey("81k4nRYTKkAJmd5Fm9uKktYR82xLUNq4qAiYbuL7RP1o");
const T0         = 1_000_000_000;          // deterministic base Unix timestamp
const RESULTS_TS = T0 + 86_400 * 30;       // 30 days later
const CUTOFF_TS  = RESULTS_TS - 86_400;    // 29 days after T0

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

/** Map a 1-based rank to a 0-based tier index. */
function tierForRank(rank: number, tierCount: number): number {
  return Math.min(rank - 1, tierCount - 1);
}

/**
 * Proportional cascade (Option B): tiers with no projects redistribute their
 * configured pct proportionally to all occupied tiers.
 * Returns an array of effective basis points (sum ≤ 10_000).
 */
function computeEffectivePcts(tierPcts: number[], tierHasProjects: boolean[]): number[] {
  const n = tierPcts.length;
  let totalNonEmptyBps = 0;
  for (let i = 0; i < n; i++) {
    if (tierHasProjects[i]) totalNonEmptyBps += tierPcts[i] * 100;
  }
  const eff = new Array<number>(n).fill(0);
  if (totalNonEmptyBps === 0) return eff;
  let allocated = 0;
  let lastNonEmpty = -1;
  for (let i = 0; i < n; i++) { if (tierHasProjects[i]) lastNonEmpty = i; }
  for (let i = 0; i < n; i++) {
    if (!tierHasProjects[i]) continue;
    if (i === lastNonEmpty) {
      eff[i] = 10_000 - allocated;
    } else {
      const v = Math.floor(tierPcts[i] * 1_000_000 / totalNonEmptyBps);
      eff[i] = v;
      allocated += v;
    }
  }
  return eff;
}

/** Sum isqrt(stake) for all projects in a given tier. */
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

/**
 * Two-stage payout formula:
 *   payout = stake × ci × effectivePt × pool / (totalStaked × cTotalTier × 10_000)
 */
function expectedPayoutNew(
  stakeAmt: bigint, ci: bigint, effectivePt: number,
  pool: bigint, totalStaked: bigint, cTotalTier: bigint,
): bigint {
  return (stakeAmt * ci * BigInt(effectivePt) * pool) / (totalStaked * cTotalTier * 10_000n);
}

// ── PDA helpers ───────────────────────────────────────────────────────────────

function hackathonPda(admin: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("hackathon"), admin.toBuffer()], PROGRAM_ID)[0];
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

interface Fix { admin: Keypair; mint: PublicKey; hackathon: PublicKey; escrow: PublicKey; }
interface User { user: Keypair; ata: PublicKey; }

async function newHackathon(
  ctx: ProgramTestContext, program: Program<HackathonBetting>,
  resultsTimestamp = RESULTS_TS,
  tierPcts: number[]   = DEFAULT_TIER_PCTS,
  tierCounts: number[] = DEFAULT_TIER_COUNTS,
): Promise<Fix> {
  const admin = Keypair.generate();
  await fund(ctx, admin.publicKey);
  const mint = await createMint(ctx);
  const hackathon = hackathonPda(admin.publicKey);
  const escrow    = escrowPda(hackathon);
  await program.methods.initializeHackathon(new BN(resultsTimestamp), Buffer.from(tierPcts), Buffer.from(tierCounts))
    .accounts({ admin: admin.publicKey, hackathon, escrow, usdcMint: mint,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([admin]).rpc();
  return { admin, mint, hackathon, escrow };
}

async function newUser(ctx: ProgramTestContext, mint: PublicKey, tokens: number): Promise<User> {
  const user = Keypair.generate();
  await fund(ctx, user.publicKey);
  const ata = await createAta(ctx, mint, user.publicKey);
  await mintTokens(ctx, mint, ata, tokens);
  return { user, ata };
}

async function addProject(
  ctx: ProgramTestContext, program: Program<HackathonBetting>,
  fix: Fix, url: string,
): Promise<PublicKey> {
  const urlHash  = createHash("sha256").update(url).digest();
  const project  = projectPda(fix.hackathon, url); // uses hash internally
  await program.methods.registerProject(url, Array.from(urlHash))
    .accounts({ payer: ctx.payer.publicKey, hackathon: fix.hackathon, project,
                systemProgram: SystemProgram.programId })
    .signers([ctx.payer]).rpc();
  return project;
}

async function doStake(
  program: Program<HackathonBetting>, fix: Fix, u: User, project: PublicKey, amount: number,
) {
  await program.methods.stake(new BN(amount))
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(u.user.publicKey, project),
                userTokenAccount: u.ata, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([u.user]).rpc();
}

async function doUnstake(
  program: Program<HackathonBetting>, fix: Fix, u: User, project: PublicKey,
) {
  await program.methods.unstake()
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(u.user.publicKey, project),
                userTokenAccount: u.ata, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([u.user]).rpc();
}

async function doResolve(
  program: Program<HackathonBetting>, fix: Fix, project: PublicKey, rank: number,
) {
  await program.methods.resolve(rank)
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon, project })
    .signers([fix.admin]).rpc();
}

async function doFinalizeResolve(
  program: Program<HackathonBetting>, fix: Fix, allProjects: PublicKey[],
) {
  await program.methods.finalizeResolve()
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon })
    .remainingAccounts(allProjects.map(pk => ({ pubkey: pk, isWritable: false, isSigner: false })))
    .signers([fix.admin]).rpc();
}

async function doClaim(
  program: Program<HackathonBetting>, fix: Fix, u: User,
  project: PublicKey, allProjects: PublicKey[],
) {
  await program.methods.claim()
    .accounts({ user: u.user.publicKey, hackathon: fix.hackathon, project,
                userStake: stakePda(u.user.publicKey, project),
                userTokenAccount: u.ata, escrow: fix.escrow,
                tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .remainingAccounts(allProjects.map(pk => ({ pubkey: pk, isWritable: false, isSigner: false })))
    .signers([u.user]).rpc();
}

async function doEnableRefund(
  program: Program<HackathonBetting>, fix: Fix, project: PublicKey,
) {
  await program.methods.enableRefund()
    .accounts({ admin: fix.admin.publicKey, hackathon: fix.hackathon, project })
    .signers([fix.admin]).rpc();
}

async function doRefund(
  program: Program<HackathonBetting>, fix: Fix, u: User, project: PublicKey,
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
  let program: Program<HackathonBetting>;

  before(async () => {
    ctx = await startAnchor(".", [], []);
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
      assert.equal(h.resultsTimestamp.toNumber(), RESULTS_TS);
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
      assert.equal(h.resultsTimestamp.toNumber() - h.cutoffTimestamp.toNumber(), 86_400);
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
      assert.equal(p.totalStaked.toNumber(), 0);
      assert.equal(p.rank, 0);
      assert.equal(p.isRegistered, true);
    });

    // FIX-5: URL seed is now SHA-256(url) — always 32 bytes — so real GitHub
    // URLs (> 32 bytes) are fully supported up to the 200-char program limit.
    it("accepts real GitHub URLs longer than 32 bytes", async () => {
      const url = "https://github.com/some-org/some-long-repo-name"; // 47 bytes
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
  });

  // ── 3. stake ─────────────────────────────────────────────────────────────

  describe("3. stake", () => {
    let fix: Fix; let alice: User; let project: PublicKey;

    before(async () => {
      setClock(ctx, T0);
      fix = await newHackathon(ctx, program);
      alice = await newUser(ctx, fix.mint, 10_000);
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
      // cap is 1_000_000_000 (≤), so 1_000_000_001 exceeds it
      const carol = await newUser(ctx, fix.mint, 1_000_000_002);
      try { await doStake(program, fix, carol, project, 1_000_000_001); assert.fail(); }
      catch (e: any) { assert.include(e.message, "StakeCapExceeded"); }
    });

    it("rejects stake after results_timestamp", async () => {
      setClock(ctx, RESULTS_TS + 1);
      try { await doStake(program, fix, alice, project, 100); assert.fail(); }
      catch (e: any) { assert.include(e.message, "StakingClosed"); }
      finally { setClock(ctx, T0); }
    });
  });

  // ── 4. unstake ────────────────────────────────────────────────────────────

  describe("4. unstake — zero penalty", () => {
    let fix: Fix; let alice: User; let project: PublicKey;

    before(async () => {
      setClock(ctx, T0);
      fix = await newHackathon(ctx, program);
      alice = await newUser(ctx, fix.mint, 1_000);
      project = await addProject(ctx, program, fix, "https://github.com/unstake/zero");
      await doStake(program, fix, alice, project, 1_000);
    });

    it("returns full stake when unstaking immediately (t_elapsed=0)", async () => {
      const before = await tokenBalance(ctx, alice.ata);
      await doUnstake(program, fix, alice, project);
      const after = await tokenBalance(ctx, alice.ata);
      assert.equal(Number(after - before), 1_000);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.totalPool.toNumber(), 0);
    });
  });

  describe("4b. unstake — linear decay at midpoint", () => {
    let fix: Fix; let bob: User; let project: PublicKey;

    before(async () => {
      setClock(ctx, T0);
      fix = await newHackathon(ctx, program);
      bob = await newUser(ctx, fix.mint, 1_000);
      project = await addProject(ctx, program, fix, "https://github.com/unstake/decay");
      await doStake(program, fix, bob, project, 1_000);
    });

    it("applies 15% penalty at midpoint → returns 850", async () => {
      // midpoint of [T0, CUTOFF_TS]:  T0 + (CUTOFF_TS - T0)/2
      setClock(ctx, T0 + (CUTOFF_TS - T0) / 2);
      const before = await tokenBalance(ctx, bob.ata);
      await doUnstake(program, fix, bob, project);
      const after = await tokenBalance(ctx, bob.ata);
      // penalty_bps = 3000 * 0.5 = 1500 → return = 1000 * 8500/10000 = 850
      assert.equal(Number(after - before), 850);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.totalPool.toNumber(), 150, "penalty stays in pool");
    });

    it("rejects unstake after cutoff", async () => {
      setClock(ctx, CUTOFF_TS + 1);
      try { await doUnstake(program, fix, bob, project); assert.fail(); }
      catch (e: any) { assert.include(e.message, "CutoffPassed"); }
      finally { setClock(ctx, T0); }
    });
  });

  // ── 5. resolve + finalize_resolve ─────────────────────────────────────────

  describe("5. resolve + finalize_resolve", () => {
    let fix: Fix; let projects: PublicKey[];

    before(async () => {
      setClock(ctx, T0);
      fix = await newHackathon(ctx, program);
      projects = await Promise.all([
        addProject(ctx, program, fix, "https://github.com/res/1"),
        addProject(ctx, program, fix, "https://github.com/res/2"),
        addProject(ctx, program, fix, "https://github.com/res/3"),
      ]);
    });

    it("sets rank on each project", async () => {
      setClock(ctx, RESULTS_TS); // FIX-2: resolve only allowed at/after results_timestamp
      await doResolve(program, fix, projects[0], 1);
      await doResolve(program, fix, projects[1], 4);
      await doResolve(program, fix, projects[2], 5);
      assert.equal((await program.account.projectAccount.fetch(projects[0])).rank, 1);
      assert.equal((await program.account.projectAccount.fetch(projects[1])).rank, 4);
    });

    it("finalize sets is_resolved and cascades empty tiers", async () => {
      await doFinalizeResolve(program, fix, projects);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.isResolved, true);
      // Projects are ranks 1, 4, 5 → tiers 0, 2, 2 (tier-1 sub-winner is empty)
      // Tier-1's 30% cascades proportionally to tiers 0 and 2.
      assert.equal(h.effectiveTierPcts[1], 0, "tier-1 had no projects — cascaded away");
      assert.ok(h.effectiveTierPcts[0] > 5500, "tier-0 received cascade from tier-1");
    });

    it("rejects a second finalize_resolve", async () => {
      try { await doFinalizeResolve(program, fix, projects); assert.fail(); }
      catch (e: any) {
        // anchor-bankrun surfaces constraint errors differently across platforms:
        // some embed the error name, others include only the code number.
        const txt = [e.message, ...(e.logs ?? [])].join(" ");
        assert.ok(
          txt.includes("AlreadyResolved") || txt.includes("6003"),
          `Expected AlreadyResolved (6003), got: ${e.message}`,
        );
      }
    });

    it("rejects resolve after finalized", async () => {
      try { await doResolve(program, fix, projects[0], 2); assert.fail(); }
      catch (e: any) { assert.include(e.message, "AlreadyResolved"); }
    });

    it("rejects rank = 0", async () => {
      setClock(ctx, T0); // reset for hackathon creation (results_ts must be future)
      const fix2 = await newHackathon(ctx, program);
      const p = await addProject(ctx, program, fix2, "https://github.com/res/rank0");
      setClock(ctx, RESULTS_TS); // FIX-2: must be at/after results_timestamp
      try { await doResolve(program, fix2, p, 0); assert.fail(); }
      catch (e: any) { assert.include(e.message, "InvalidRank"); }
    });
  });

  // ── TC1: single rank-1, full pool ─────────────────────────────────────────

  describe("TC1: single rank-1 project — payout == full pool", () => {
    it("sole staker on rank-1 project receives entire pool", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const alice = await newUser(ctx, fix.mint, 1_000);
      const project = await addProject(ctx, program, fix, "https://github.com/tc1/win");
      await doStake(program, fix, alice, project, 1_000);
      setClock(ctx, RESULTS_TS); // FIX-2
      await doResolve(program, fix, project, 1);
      await doFinalizeResolve(program, fix, [project]);

      const before = await tokenBalance(ctx, alice.ata);
      await doClaim(program, fix, alice, project, [project]);
      assert.equal(Number(await tokenBalance(ctx, alice.ata) - before), 1_000);

      const s = await program.account.userStake.fetch(stakePda(alice.user.publicKey, project));
      assert.equal(s.isClaimed, true);
    });
  });

  // ── TC2: single rank-4, full pool ─────────────────────────────────────────

  describe("TC2: single rank-4 (rest-tier) project — payout == full pool", () => {
    it("sole staker on rest-rank project receives entire pool", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const alice = await newUser(ctx, fix.mint, 1_000);
      const project = await addProject(ctx, program, fix, "https://github.com/tc2/lose");
      await doStake(program, fix, alice, project, 1_000);
      setClock(ctx, RESULTS_TS); // FIX-2
      await doResolve(program, fix, project, 4);
      await doFinalizeResolve(program, fix, [project]);

      const before = await tokenBalance(ctx, alice.ata);
      await doClaim(program, fix, alice, project, [project]);
      assert.equal(Number(await tokenBalance(ctx, alice.ata) - before), 1_000);
    });
  });

  // ── TC3: five equal projects, rank-ordered payouts ────────────────────────
  //
  //  5 projects × 1_000 staked each, ranks 1-5, tiers [55%,30%,15%], pool=5_000
  //  tier-0 (rank 1):  eff=5500 bps, 1 project  → payout = 5500*5000/10000 = 2750
  //  tier-1 (rank 2):  eff=3000 bps, 1 project  → payout = 3000*5000/10000 = 1500
  //  tier-2 (rank 3,4,5): eff=1500 bps, 3 equal → each = 1500*5000/(3*10000) = 250
  //  sum = 2750+1500+250+250+250 = 5000 (zero dust with equal stakes)

  describe("TC3: five equal projects, payouts in rank order", () => {
    const STAKE = 1_000n;
    const POOL  = 5_000n;
    const RANKS = [1, 2, 3, 4, 5];
    let payouts: number[];

    before(async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const users: User[] = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < 5; i++) {
        const u = await newUser(ctx, fix.mint, Number(STAKE));
        const p = await addProject(ctx, program, fix, `https://github.com/tc3/p${i}`);
        await doStake(program, fix, u, p, Number(STAKE));
        users.push(u); projects.push(p);
      }
      setClock(ctx, RESULTS_TS); // FIX-2
      for (let i = 0; i < 5; i++) await doResolve(program, fix, projects[i], RANKS[i]);
      await doFinalizeResolve(program, fix, projects);

      payouts = [];
      for (let i = 0; i < 5; i++) {
        const before = await tokenBalance(ctx, users[i].ata);
        await doClaim(program, fix, users[i], projects[i], projects);
        payouts.push(Number(await tokenBalance(ctx, users[i].ata) - before));
      }
    });

    it("each payout matches the formula", () => {
      const stakes = RANKS.map(() => STAKE);
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, RANKS.map(r => true));
      for (let i = 0; i < 5; i++) {
        const tier   = tierForRank(RANKS[i], TIER_COUNT);
        const ci     = isqrt(STAKE);
        const cTotal = cTotalForTier(tier, TIER_COUNT, stakes, RANKS);
        const exp    = expectedPayoutNew(STAKE, ci, effPcts[tier], POOL, STAKE, cTotal);
        assert.equal(payouts[i], Number(exp), `rank-${RANKS[i]} payout`);
      }
    });

    it("payouts are strictly decreasing by rank tier (rest-tier projects equal)", () => {
      assert.ok(payouts[0] > payouts[1], "rank1 > rank2");
      assert.ok(payouts[1] > payouts[2], "rank2 > rank3 (tier-1 > tier-2)");
      assert.equal(payouts[2], payouts[3], "rank3 == rank4 (same rest tier)");
      assert.equal(payouts[3], payouts[4], "rank4 == rank5 (same rest tier)");
    });

    it("sum of payouts == total pool (zero integer dust)", () => {
      assert.equal(payouts.reduce((s, v) => s + v, 0), Number(POOL));
    });
  });

  // ── TC3b: asymmetric stakes — sum of payouts ≤ pool (FIX-10) ─────────────
  //
  //  TC3 used equal stakes so integer division happened to be exact (zero dust).
  //  This variant uses unequal stakes to verify the correct guarantee: sum ≤ pool.

  describe("TC3b: asymmetric stakes — sum of payouts <= pool", () => {
    it("unequal stakes: payouts sum <= pool (exact equality not guaranteed)", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const STAKES  = [900, 1100, 950, 1050, 1000]; // sum = 5000
      const RANKS   = [1, 2, 3, 4, 5];
      const users: User[]     = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < 5; i++) {
        const u = await newUser(ctx, fix.mint, STAKES[i]);
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
        await doClaim(program, fix, users[i], projects[i], projects);
        totalPayout += await tokenBalance(ctx, users[i].ata) - before;
      }
      assert.ok(totalPayout <= pool,
        `sum of payouts ${totalPayout} should be <= pool ${pool}`);
    });
  });

  // ── TC4: sqrt neutralizes sybil splitting ─────────────────────────────────
  //
  //  proj-A rank 1: 20 wallets × 1_000 → total_staked = 20_000
  //  proj-B rank 2: 1 whale   × 20_000 → total_staked = 20_000
  //  pool = 40_000, tiers [55%,30%,15%], no rest-tier projects
  //
  //  isqrt(20_000) = 141 for BOTH projects  ← key insight (sybil resistance)
  //  tier-2 (rest) empty → cascade: eff[0]=6470 bps, eff[1]=3530 bps
  //  each sybil payout ≈ 1294    whale payout ≈ 14120

  describe("TC4: sybil splitting is neutralized by sqrt crowding factor", () => {
    const SYBIL_N     = 20;
    const SYBIL_STAKE = 1_000n;
    const WHALE_STAKE = 20_000n;
    let sybilPayouts: number[];
    let whalePayout:  number;

    before(async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const projA = await addProject(ctx, program, fix, "https://github.com/tc4/sybil");
      const projB = await addProject(ctx, program, fix, "https://github.com/tc4/whale");

      const sybilUsers: User[] = [];
      for (let i = 0; i < SYBIL_N; i++) {
        const u = await newUser(ctx, fix.mint, Number(SYBIL_STAKE));
        await doStake(program, fix, u, projA, Number(SYBIL_STAKE));
        sybilUsers.push(u);
      }
      const whale = await newUser(ctx, fix.mint, Number(WHALE_STAKE));
      await doStake(program, fix, whale, projB, Number(WHALE_STAKE));

      setClock(ctx, RESULTS_TS); // FIX-2
      await doResolve(program, fix, projA, 1);
      await doResolve(program, fix, projB, 2);
      await doFinalizeResolve(program, fix, [projA, projB]);

      const allProjects = [projA, projB];
      sybilPayouts = [];
      for (const u of sybilUsers) {
        const before = await tokenBalance(ctx, u.ata);
        await doClaim(program, fix, u, projA, allProjects);
        sybilPayouts.push(Number(await tokenBalance(ctx, u.ata) - before));
      }
      const wBefore = await tokenBalance(ctx, whale.ata);
      await doClaim(program, fix, whale, projB, allProjects);
      whalePayout = Number(await tokenBalance(ctx, whale.ata) - wBefore);
    });

    it("both projects have identical crowding factor (equal total_staked)", () => {
      assert.equal(
        isqrt(SYBIL_STAKE * BigInt(SYBIL_N)),
        isqrt(WHALE_STAKE),
        "isqrt(20_000) == isqrt(20_000) — splitting gives no extra weight",
      );
    });

    it("all 20 sybil wallets receive identical payouts", () => {
      const first = sybilPayouts[0];
      for (const p of sybilPayouts) assert.equal(p, first);
    });

    it("each sybil payout matches formula", () => {
      const pool    = SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE;
      // tier-2 (rest) empty → cascade proportionally to tiers 0 and 1
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, [true, true, false]);
      const ciA     = isqrt(SYBIL_STAKE * BigInt(SYBIL_N));
      const exp     = expectedPayoutNew(
        SYBIL_STAKE, ciA, effPcts[0], pool, SYBIL_STAKE * BigInt(SYBIL_N), ciA,
      );
      assert.equal(sybilPayouts[0], Number(exp));
    });

    it("whale payout matches formula", () => {
      const pool    = SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE;
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, [true, true, false]);
      const ciB     = isqrt(WHALE_STAKE);
      const exp     = expectedPayoutNew(WHALE_STAKE, ciB, effPcts[1], pool, WHALE_STAKE, ciB);
      assert.equal(whalePayout, Number(exp));
    });

    it("sum of all payouts <= total pool", () => {
      const totalOut = sybilPayouts.reduce((s, v) => s + v, 0) + whalePayout;
      assert.ok(totalOut <= Number(SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE));
    });

    // FIX-11: verify end-to-end sybil resistance — the 20-wallet group receives
    // the same combined payout as a single wallet with equal total stake would.
    it("sybil group total == single-whale-on-same-project formula (sybil resistance)", () => {
      const pool    = SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE;
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, [true, true, false]);
      const ciA     = isqrt(SYBIL_STAKE * BigInt(SYBIL_N));
      // A single wallet staking all 20_000 on projA:
      const singleWhaleEquiv = Number(
        expectedPayoutNew(SYBIL_STAKE * BigInt(SYBIL_N), ciA, effPcts[0], pool,
                          SYBIL_STAKE * BigInt(SYBIL_N), ciA),
      );
      const sybilGroupTotal = sybilPayouts.reduce((s, v) => s + v, 0);
      // Integer truncation per wallet means sybilGroupTotal <= singleWhaleEquiv
      // with a maximum shortfall of SYBIL_N units (at most 1 lost per wallet).
      const dust = singleWhaleEquiv - sybilGroupTotal;
      assert.ok(
        dust >= 0 && dust <= SYBIL_N,
        `sybilGroupTotal=${sybilGroupTotal} singleWhaleEquiv=${singleWhaleEquiv} ` +
        `dust=${dust} must be in [0, ${SYBIL_N}] — sybil splitting must not exceed single-whale payout`,
      );
    });
  });

  // ── TC5: lightly backed rank-1 vs crowded rank-2 ──────────────────────────
  //
  //  proj-light rank 1: alice stakes 1_000     → total_staked = 1_000
  //  proj-heavy rank 2: whale stakes 999_000   → total_staked = 999_000
  //  pool = 1_000_000, tiers [55%,30%,15%], no rest-tier projects
  //
  //  tier-2 (rest) empty → cascade: eff[0]=6470 bps, eff[1]=3530 bps
  //  alice payout = 647_000     whale payout = 353_000
  //  alice per-dollar = 647×    whale per-dollar ≈ 0.353×

  describe("TC5: lightly backed rank-1 vs crowded rank-2", () => {
    const ALICE_STAKE = 1_000n;
    const WHALE_STAKE = 999_000n;
    let alicePayout: number;
    let whalePayout:  number;

    before(async () => {
      setClock(ctx, T0);
      const fix  = await newHackathon(ctx, program);
      const projL = await addProject(ctx, program, fix, "https://github.com/tc5/light");
      const projH = await addProject(ctx, program, fix, "https://github.com/tc5/heavy");
      const alice = await newUser(ctx, fix.mint, Number(ALICE_STAKE));
      const whale = await newUser(ctx, fix.mint, Number(WHALE_STAKE));
      await doStake(program, fix, alice, projL, Number(ALICE_STAKE));
      await doStake(program, fix, whale, projH, Number(WHALE_STAKE));
      setClock(ctx, RESULTS_TS); // FIX-2
      await doResolve(program, fix, projL, 1);
      await doResolve(program, fix, projH, 2);
      await doFinalizeResolve(program, fix, [projL, projH]);

      const allProjects = [projL, projH];
      const aBefore = await tokenBalance(ctx, alice.ata);
      await doClaim(program, fix, alice, projL, allProjects);
      alicePayout = Number(await tokenBalance(ctx, alice.ata) - aBefore);

      const wBefore = await tokenBalance(ctx, whale.ata);
      await doClaim(program, fix, whale, projH, allProjects);
      whalePayout = Number(await tokenBalance(ctx, whale.ata) - wBefore);
    });

    it("alice payout matches formula", () => {
      const pool    = ALICE_STAKE + WHALE_STAKE;
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, [true, true, false]);
      const ciL     = isqrt(ALICE_STAKE);
      const exp     = expectedPayoutNew(ALICE_STAKE, ciL, effPcts[0], pool, ALICE_STAKE, ciL);
      assert.equal(alicePayout, Number(exp));
    });

    it("whale payout matches formula", () => {
      const pool    = ALICE_STAKE + WHALE_STAKE;
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, [true, true, false]);
      const ciH     = isqrt(WHALE_STAKE);
      const exp     = expectedPayoutNew(WHALE_STAKE, ciH, effPcts[1], pool, WHALE_STAKE, ciH);
      assert.equal(whalePayout, Number(exp));
    });

    it("alice's per-dollar return >> whale's per-dollar return", () => {
      const aliceRatio = alicePayout / Number(ALICE_STAKE);
      const whaleRatio = whalePayout / Number(WHALE_STAKE);
      assert.ok(
        aliceRatio > whaleRatio,
        `alice=${aliceRatio.toFixed(2)}x > whale=${whaleRatio.toFixed(2)}x`,
      );
    });

    it("alice earns a profit (return > stake)", () => {
      assert.ok(alicePayout > Number(ALICE_STAKE));
    });

    it("whale is diluted (return < stake)", () => {
      assert.ok(whalePayout < Number(WHALE_STAKE));
    });
  });

  // ── FIX-8: all projects rank 1–3 (no rest tier) ──────────────────────────
  //
  //  When all projects occupy tiers 0-2 and none are in a "rest" position,
  //  the cascade leaves all effective_tier_pcts at their configured values.

  describe("FIX-8: all projects rank 1-3 — no rest tier, payouts match formula", () => {
    it("three top-ranked projects: effective pcts unchanged, payouts match formula", async () => {
      setClock(ctx, T0);
      const fix      = await newHackathon(ctx, program);
      const STAKES   = [1_000, 2_000, 1_500]; // sum = 4_500
      const RANKS    = [1, 2, 3];
      const users: User[]         = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < 3; i++) {
        const u = await newUser(ctx, fix.mint, STAKES[i]);
        const p = await addProject(ctx, program, fix, `https://github.com/fix8/p${i}`);
        await doStake(program, fix, u, p, STAKES[i]);
        users.push(u); projects.push(p);
      }
      setClock(ctx, RESULTS_TS);
      for (let i = 0; i < 3; i++) await doResolve(program, fix, projects[i], RANKS[i]);
      await doFinalizeResolve(program, fix, projects);

      const h = await program.account.hackathonState.fetch(fix.hackathon);
      // All 3 tiers occupied → no cascade → effective pcts == configured pcts in bps
      assert.equal(h.effectiveTierPcts[0], 5500, "tier-0 = 55%");
      assert.equal(h.effectiveTierPcts[1], 3000, "tier-1 = 30%");
      assert.equal(h.effectiveTierPcts[2], 1500, "tier-2 = 15%");

      const pool    = BigInt(STAKES.reduce((s, v) => s + v, 0));
      const stakesBN = STAKES.map(BigInt);
      // Each tier has exactly one project → cTotal = isqrt(stake) for that project
      const effPcts = computeEffectivePcts(DEFAULT_TIER_PCTS, [true, true, true]);

      for (let i = 0; i < 3; i++) {
        const before  = await tokenBalance(ctx, users[i].ata);
        await doClaim(program, fix, users[i], projects[i], projects);
        const payout  = Number(await tokenBalance(ctx, users[i].ata) - before);
        const tier    = tierForRank(RANKS[i], TIER_COUNT);
        const ci      = isqrt(stakesBN[i]);
        const cTotal  = cTotalForTier(tier, TIER_COUNT, stakesBN, RANKS);
        const exp     = Number(expectedPayoutNew(stakesBN[i], ci, effPcts[tier], pool, stakesBN[i], cTotal));
        assert.equal(payout, exp, `rank-${RANKS[i]} payout`);
      }
    });
  });

  // ── 11. Error paths ───────────────────────────────────────────────────────

  describe("11. error paths — claim", () => {
    it("rejects claim when hackathon not resolved", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u = await newUser(ctx, fix.mint, 500);
      const p = await addProject(ctx, program, fix, "https://github.com/err/nr");
      await doStake(program, fix, u, p, 500);
      try { await doClaim(program, fix, u, p, [p]); assert.fail(); }
      catch (e: any) { assert.include(e.message, "NotResolved"); }
    });

    it("rejects double claim", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u = await newUser(ctx, fix.mint, 500);
      const p = await addProject(ctx, program, fix, "https://github.com/err/dc");
      await doStake(program, fix, u, p, 500);
      setClock(ctx, RESULTS_TS); // FIX-2
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);
      await doClaim(program, fix, u, p, [p]);
      try { await doClaim(program, fix, u, p, [p]); assert.fail(); }
      catch (e: any) { assert.include(e.message, "AlreadyClaimed"); }
    });

    // FIX-12: rank-0 project (resolve was skipped) must be rejected at claim.
    // finalize_resolve requires at least one ranked project (AllTiersEmpty guard),
    // so we create a second project (p2) with rank 1 to satisfy that requirement.
    it("rejects claim when project rank is 0 (resolve was skipped)", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newUser(ctx, fix.mint, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/err/rank0claim");
      await doStake(program, fix, u, p, 500);
      // p2 is ranked so finalize_resolve has at least one occupied tier
      const u2 = await newUser(ctx, fix.mint, 100);
      const p2 = await addProject(ctx, program, fix, "https://github.com/err/rank0ranked");
      await doStake(program, fix, u2, p2, 100);
      // intentionally skip doResolve for p — p stays at rank 0
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p2, 1);
      await doFinalizeResolve(program, fix, [p, p2]);
      try { await doClaim(program, fix, u, p, [p, p2]); assert.fail(); }
      catch (e: any) { assert.include(e.message, "NotResolved"); }
    });
  });

  // ── Cascade tests ─────────────────────────────────────────────────────────

  describe("Cascade: grand winner not in pool — pool redistributes to lower tiers", () => {
    it("tier-0 empty → its 55% cascades proportionally to tiers 1 and 2", async () => {
      setClock(ctx, T0);
      // Create hackathon with [55,30,15] tiers
      const fix    = await newHackathon(ctx, program);
      // Register two projects — neither will be rank-1 (tier-0 stays empty)
      const pSub   = await addProject(ctx, program, fix, "https://github.com/cas/sub");
      const pRest  = await addProject(ctx, program, fix, "https://github.com/cas/rest");
      const uSub   = await newUser(ctx, fix.mint, 3_000);
      const uRest  = await newUser(ctx, fix.mint, 1_000);
      await doStake(program, fix, uSub,  pSub,  3_000);
      await doStake(program, fix, uRest, pRest, 1_000);

      setClock(ctx, RESULTS_TS);
      // rank 2 = tier-1 (sub-winner), rank 3 = tier-2 (rest) — tier-0 has NO project
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

      // Verify payouts use cascaded pcts
      const pool    = 4_000n;
      const effPcts = computeEffectivePcts([55,30,15], [false, true, true]);
      const allProjects = [pSub, pRest];

      const subBefore = await tokenBalance(ctx, uSub.ata);
      await doClaim(program, fix, uSub, pSub, allProjects);
      const subPayout = Number(await tokenBalance(ctx, uSub.ata) - subBefore);

      const restBefore = await tokenBalance(ctx, uRest.ata);
      await doClaim(program, fix, uRest, pRest, allProjects);
      const restPayout = Number(await tokenBalance(ctx, uRest.ata) - restBefore);

      // Each project is alone in its tier → cTotal = isqrt(stake)
      const expSub  = Number(expectedPayoutNew(3000n, isqrt(3000n), effPcts[1], pool, 3000n, isqrt(3000n)));
      const expRest = Number(expectedPayoutNew(1000n, isqrt(1000n), effPcts[2], pool, 1000n, isqrt(1000n)));
      assert.equal(subPayout,  expSub,  "sub-winner payout matches cascaded formula");
      assert.equal(restPayout, expRest, "rest payout matches cascaded formula");
      assert.ok(subPayout + restPayout <= 4_000, "total payout <= pool");
    });
  });

  // ── Refund tests ──────────────────────────────────────────────────────────

  describe("Refund: admin-authorised exceptional stake recovery", () => {
    it("staker on refund-enabled project recovers full original stake", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newUser(ctx, fix.mint, 1_000);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/happy");
      await doStake(program, fix, u, p, 1_000);

      // Admin enables refund (project never resolved)
      await doEnableRefund(program, fix, p);
      const proj = await program.account.projectAccount.fetch(p);
      assert.equal(proj.isRefundEnabled, true);

      // Finalize with the project unranked — need at least one ranked project
      const p2 = await addProject(ctx, program, fix, "https://github.com/ref/other");
      const u2 = await newUser(ctx, fix.mint, 500);
      await doStake(program, fix, u2, p2, 500);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p2, 1);
      await doFinalizeResolve(program, fix, [p, p2]);

      // User calls refund — receives full original stake, no penalty
      const before = await tokenBalance(ctx, u.ata);
      await doRefund(program, fix, u, p);
      const after  = await tokenBalance(ctx, u.ata);
      assert.equal(Number(after - before), 1_000, "full stake returned");

      const stake = await program.account.userStake.fetch(stakePda(u.user.publicKey, p));
      assert.equal(stake.isClaimed, true);
    });

    it("refund blocked if enable_refund not called", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newUser(ctx, fix.mint, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/blocked");
      await doStake(program, fix, u, p, 500);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);
      try { await doRefund(program, fix, u, p); assert.fail(); }
      catch (e: any) { assert.include(e.message, "RefundNotEnabled"); }
    });

    it("refund blocked after already claimed", async () => {
      setClock(ctx, T0);
      const fix = await newHackathon(ctx, program);
      const u   = await newUser(ctx, fix.mint, 500);
      const p   = await addProject(ctx, program, fix, "https://github.com/ref/dblclaim");
      await doStake(program, fix, u, p, 500);
      await doEnableRefund(program, fix, p);
      setClock(ctx, RESULTS_TS);
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);
      await doRefund(program, fix, u, p);
      try { await doRefund(program, fix, u, p); assert.fail(); }
      catch (e: any) { assert.include(e.message, "AlreadyClaimed"); }
    });
  });

  // ── Step 6: CU audit — claim instruction ─────────────────────────────────
  //
  // Measures compute units consumed by `claim` as the number of projects
  // passed in remaining_accounts grows.  The spec threshold is 200 000 CU
  // at 20 projects; if exceeded, R_total must be snapshotted at resolve time.

  describe("Step 6: CU audit — claim instruction", () => {
    // Use a generous CU ceiling so bankrun never kills the tx before we measure.
    let auditCtx: ProgramTestContext;
    let auditProg: Program<HackathonBetting>;

    before(async () => {
      auditCtx = await startAnchor(".", [], [], 1_400_000n);
      setClock(auditCtx, T0);
      const prov = new BankrunProvider(auditCtx);
      auditProg = new anchor.Program<HackathonBetting>(IDL, prov);
    });

    // Build the claim tx, send it via processTransaction, return CU consumed.
    async function measureClaimCU(nProjects: number): Promise<bigint> {
      setClock(auditCtx, T0); // reset before each run — clock persists across calls
      const fix = await newHackathon(auditCtx, auditProg);

      const users: User[]     = [];
      const projects: PublicKey[] = [];

      for (let i = 0; i < nProjects; i++) {
        // Short unique URLs: "g.io/a/0" … "g.io/a/49" (all ≤ 11 bytes)
        const url = `g.io/a/${i}`;
        const u = await newUser(auditCtx, fix.mint, 1_000);
        const p = await addProject(auditCtx, auditProg, fix, url);
        await doStake(auditProg, fix, u, p, 1_000);
        users.push(u);
        projects.push(p);
      }

      // Assign ranks: first 3 → ranks 1-3, rest → rank 4
      setClock(auditCtx, RESULTS_TS); // FIX-2
      for (let i = 0; i < nProjects; i++) {
        await doResolve(auditProg, fix, projects[i], i < 3 ? i + 1 : 4);
      }
      await doFinalizeResolve(auditProg, fix, projects);

      // Build claim tx for user[0] (rank-1 project) manually to capture meta
      const u = users[0];
      const p = projects[0];
      const tx = await auditProg.methods
        .claim()
        .accounts({
          user:             u.user.publicKey,
          hackathon:        fix.hackathon,
          project:          p,
          userStake:        stakePda(u.user.publicKey, p),
          userTokenAccount: u.ata,
          escrow:           fix.escrow,
          tokenProgram:     TOKEN_PROGRAM_ID,
          systemProgram:    SystemProgram.programId,
        })
        .remainingAccounts(
          projects.map(pk => ({ pubkey: pk, isWritable: false, isSigner: false })),
        )
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

    it("claim @ 50 projects — legacy tx size limit", async function () {
      this.timeout(300_000);
      // At 50 projects the legacy transaction packet (1 232 bytes max) is
      // exhausted by account keys alone (50 × 32 = 1 600 bytes) before the
      // program even runs.  This is a client-side serialisation constraint,
      // not a CU problem.  Production clients at this scale must use
      // Address Lookup Tables (ALTs) or batch claim across multiple txs.
      try {
        const cu = await measureClaimCU(50);
        results[50] = cu;
        console.log(`    claim @ 50 projects: ${cu.toLocaleString()} CU`);
      } catch (e: any) {
        // Expected: transaction too large for legacy format
        const isSizeErr =
          e.message?.includes("Transaction too large") ||
          e.message?.includes("invariant") ||
          e.message?.includes("serialize");
        if (isSizeErr) {
          console.log(
            "    claim @ 50 projects: ✗ legacy tx size exceeded " +
            "(expected — use ALTs for N>~35)",
          );
          // Not a CU failure — mark as known limitation and pass
          return;
        }
        throw e;
      }
    });

    it("verdict: 20-project CU vs 200 000 threshold", function () {
      const cu20 = results[20];
      if (cu20 === undefined) this.skip();   // guard if run in isolation

      console.log("\n    ── CU audit results ──────────────────────────────");
      console.log(`    N=5  : ${results[5]?.toLocaleString()} CU`);
      console.log(`    N=10 : ${results[10]?.toLocaleString()} CU`);
      console.log(`    N=20 : ${results[20]?.toLocaleString()} CU   ← threshold check`);
      console.log(`    N=50 : ${results[50]?.toLocaleString()} CU`);

      if (cu20 > THRESHOLD) {
        console.log(`\n    ⚠️  N=20 exceeds ${THRESHOLD.toLocaleString()} CU`);
        console.log("    → R_total snapshot required in finalize_resolve");
        assert.fail(
          `claim @ 20 projects (${cu20} CU) exceeds 200 000 CU threshold — ` +
          `implement R_total snapshot in finalize_resolve / claim`,
        );
      } else {
        console.log(
          `\n    ✓ VERDICT: claim is viable without snapshot at 20 projects ` +
          `(${cu20} CU < ${THRESHOLD} CU)`,
        );
      }
    });
  });
});
