import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
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

function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}

function rScaled(rank: number, ci: bigint, rpc: number): bigint {
  const r = BigInt(Math.max(rpc, 1));
  if (rank === 1) return 55n * ci * r;
  if (rank === 2) return 30n * ci * r;
  if (rank === 3) return 10n * ci * r;
  return 5n * ci;
}

function expectedPayout(
  stakeAmt: bigint, rClaim: bigint, pool: bigint,
  totalStaked: bigint, rTotal: bigint,
): bigint {
  return (stakeAmt * rClaim * pool) / (totalStaked * rTotal);
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
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), Buffer.from(url)], PROGRAM_ID)[0];
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
): Promise<Fix> {
  const admin = Keypair.generate();
  await fund(ctx, admin.publicKey);
  const mint = await createMint(ctx);
  const hackathon = hackathonPda(admin.publicKey);
  const escrow    = escrowPda(hackathon);
  await program.methods.initializeHackathon(new BN(resultsTimestamp))
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
  const project = projectPda(fix.hackathon, url);
  await program.methods.registerProject(url)
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
      assert.deepEqual(h.judgeWeights, [55, 30, 10, 5]);
      assert.equal(h.restProjectCount, 0);
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

    // NOTE: Solana SDK enforces a 32-byte per-seed limit, which is more
    // restrictive than the program's 200-char URL check. Any URL > 32 bytes
    // fails at PDA derivation before reaching the program.
    it("rejects url > 32 bytes (SDK seed limit)", async () => {
      // 33 bytes: "https://github.com/xx/yyyyyyyyyyy"
      const url = "https://github.com/xx/yyyyyyyyyyy"; // 19+3+11 = 33 bytes
      let threw = false;
      try {
        await addProject(ctx, program, fix, url);
      } catch (e: any) {
        threw = true;
        assert.ok(
          e.message.includes("seed") || e.message.includes("UrlTooLong"),
          `unexpected error: ${e.message}`,
        );
      }
      assert.ok(threw, "should have thrown for URL > 32 bytes");
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
      await doResolve(program, fix, projects[0], 1);
      await doResolve(program, fix, projects[1], 4);
      await doResolve(program, fix, projects[2], 5);
      assert.equal((await program.account.projectAccount.fetch(projects[0])).rank, 1);
      assert.equal((await program.account.projectAccount.fetch(projects[1])).rank, 4);
    });

    it("finalize sets is_resolved and counts rest-rank projects", async () => {
      await doFinalizeResolve(program, fix, projects);
      const h = await program.account.hackathonState.fetch(fix.hackathon);
      assert.equal(h.isResolved, true);
      assert.equal(h.restProjectCount, 2); // ranks 4 and 5
    });

    it("rejects a second finalize_resolve", async () => {
      try { await doFinalizeResolve(program, fix, projects); assert.fail(); }
      catch (e: any) { assert.include(e.message, "AlreadyResolved"); }
    });

    it("rejects resolve after finalized", async () => {
      try { await doResolve(program, fix, projects[0], 2); assert.fail(); }
      catch (e: any) { assert.include(e.message, "AlreadyResolved"); }
    });

    it("rejects rank = 0", async () => {
      const fix2 = await newHackathon(ctx, program);
      const p = await addProject(ctx, program, fix2, "https://github.com/res/rank0");
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
      await doResolve(program, fix, project, 4);
      await doFinalizeResolve(program, fix, [project]);

      const before = await tokenBalance(ctx, alice.ata);
      await doClaim(program, fix, alice, project, [project]);
      assert.equal(Number(await tokenBalance(ctx, alice.ata) - before), 1_000);
    });
  });

  // ── TC3: five equal projects, rank-ordered payouts ────────────────────────
  //
  //  5 projects × 1_000 staked each, ranks 1-5, rpc = 2, pool = 5_000
  //  isqrt(1000) = 31
  //  r1=3410  r2=1860  r3=620  r4=155  r5=155   R_total=6200
  //  payouts: 2750 / 1500 / 500 / 125 / 125  (sum == 5000, zero dust)

  describe("TC3: five equal projects, payouts in rank order", () => {
    const STAKE = 1_000n;
    const POOL  = 5_000n;
    const RPC   = 2;
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
      const ci = isqrt(STAKE);
      const rTotal = RANKS.reduce((s, rank) => s + rScaled(rank, ci, RPC), 0n);
      for (let i = 0; i < 5; i++) {
        const exp = expectedPayout(STAKE, rScaled(RANKS[i], ci, RPC), POOL, STAKE, rTotal);
        assert.equal(payouts[i], Number(exp), `rank-${RANKS[i]} payout`);
      }
    });

    it("payouts are strictly decreasing by rank (except rank-4 == rank-5)", () => {
      assert.ok(payouts[0] > payouts[1], "rank1 > rank2");
      assert.ok(payouts[1] > payouts[2], "rank2 > rank3");
      assert.ok(payouts[2] > payouts[3], "rank3 > rank4");
      assert.equal(payouts[3], payouts[4],  "rank4 == rank5 (same weight)");
    });

    it("sum of payouts == total pool (zero integer dust)", () => {
      assert.equal(payouts.reduce((s, v) => s + v, 0), Number(POOL));
    });
  });

  // ── TC4: sqrt neutralizes sybil splitting ─────────────────────────────────
  //
  //  proj-A rank 1: 20 wallets × 1_000 → total_staked = 20_000
  //  proj-B rank 2: 1 whale   × 20_000 → total_staked = 20_000
  //  pool = 40_000, rpc = 0 (no rest projects)
  //
  //  isqrt(20_000) = 141 for BOTH projects  ← key insight
  //  r_A = 55*141 = 7755   r_B = 30*141 = 4230   R_total = 11_985
  //  each sybil payout = 1294    whale payout = 14117

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
      const pool  = SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE;
      const ciA   = isqrt(SYBIL_STAKE * BigInt(SYBIL_N));
      const ciB   = isqrt(WHALE_STAKE);
      const rA    = rScaled(1, ciA, 0);
      const rB    = rScaled(2, ciB, 0);
      const rTotal = rA + rB;
      const exp = expectedPayout(SYBIL_STAKE, rA, pool, SYBIL_STAKE * BigInt(SYBIL_N), rTotal);
      assert.equal(sybilPayouts[0], Number(exp));
    });

    it("whale payout matches formula", () => {
      const pool  = SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE;
      const ciA   = isqrt(SYBIL_STAKE * BigInt(SYBIL_N));
      const ciB   = isqrt(WHALE_STAKE);
      const rA    = rScaled(1, ciA, 0);
      const rB    = rScaled(2, ciB, 0);
      const rTotal = rA + rB;
      const exp = expectedPayout(WHALE_STAKE, rB, pool, WHALE_STAKE, rTotal);
      assert.equal(whalePayout, Number(exp));
    });

    it("sum of all payouts <= total pool", () => {
      const totalOut = sybilPayouts.reduce((s, v) => s + v, 0) + whalePayout;
      assert.ok(totalOut <= Number(SYBIL_STAKE * BigInt(SYBIL_N) + WHALE_STAKE));
    });
  });

  // ── TC5: lightly backed rank-1 vs crowded rank-2 ──────────────────────────
  //
  //  proj-light rank 1: alice stakes 1_000     → total_staked = 1_000
  //  proj-heavy rank 2: whale stakes 999_000   → total_staked = 999_000
  //  pool = 1_000_000, rpc = 0
  //
  //  isqrt(1_000) = 31   isqrt(999_000) = 999
  //  r_light = 55*31 = 1705    r_heavy = 30*999 = 29_970   R_total = 31_675
  //  alice payout = 53_827     whale payout = 946_172
  //  alice per-dollar ≈ 53.8×   whale per-dollar ≈ 0.95×

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
      const pool   = ALICE_STAKE + WHALE_STAKE;
      const rL     = rScaled(1, isqrt(ALICE_STAKE), 0);
      const rH     = rScaled(2, isqrt(WHALE_STAKE), 0);
      const rTotal = rL + rH;
      const exp = expectedPayout(ALICE_STAKE, rL, pool, ALICE_STAKE, rTotal);
      assert.equal(alicePayout, Number(exp));
    });

    it("whale payout matches formula", () => {
      const pool   = ALICE_STAKE + WHALE_STAKE;
      const rL     = rScaled(1, isqrt(ALICE_STAKE), 0);
      const rH     = rScaled(2, isqrt(WHALE_STAKE), 0);
      const rTotal = rL + rH;
      const exp = expectedPayout(WHALE_STAKE, rH, pool, WHALE_STAKE, rTotal);
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
      await doResolve(program, fix, p, 1);
      await doFinalizeResolve(program, fix, [p]);
      await doClaim(program, fix, u, p, [p]);
      try { await doClaim(program, fix, u, p, [p]); assert.fail(); }
      catch (e: any) { assert.include(e.message, "AlreadyClaimed"); }
    });
  });
});
