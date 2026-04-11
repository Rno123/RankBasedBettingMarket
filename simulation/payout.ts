/**
 * simulation/payout.ts
 *
 * TypeScript reference implementation of the RankBasedBettingMarket payout
 * mechanism.  Outputs from these 5 test cases become the expected values
 * used as assertions in the on-chain Bankrun test suite (Step 5).
 *
 * Formulas (from spec):
 *   S_i      = total staked on project i
 *   C_i      = sqrt(S_i)                        — crowding adjustment
 *   J_i      = judge weight for rank i           — 55 / 30 / 10 / 5
 *   R_i      = J_i * C_i                         — raw payout weight
 *   R_total  = Σ R_i
 *   P_i      = (R_i / R_total) * T              — project share of pool T
 *   payout_u = (s_u / S_i) * P_i               — per-user payout
 *
 * No f64 is used on-chain; this simulation uses f64 to generate reference
 * values that the fixed-point on-chain math must match within 1 lamport.
 */

// ── Constants ──────────────────────────────────────────────────────────────

const JUDGE_WEIGHTS: Record<number, number> = { 1: 55, 2: 30, 3: 10 };
const REST_WEIGHT = 5; // rank 4 and beyond

function judgeWeight(rank: number): number {
  return JUDGE_WEIGHTS[rank] ?? REST_WEIGHT;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  rank: number;
  /** wallet label -> lamport amount staked */
  stakes: Record<string, number>;
}

interface SimResult {
  /** Total staked per project */
  totalStaked: Record<string, number>;
  /** sqrt(S_i) crowding factor */
  crowding: Record<string, number>;
  /** Raw payout weight R_i */
  rawWeight: Record<string, number>;
  /** Project share of pool P_i */
  projectPool: Record<string, number>;
  /** Per-wallet payout (summed across all projects) */
  payouts: Record<string, number>;
  /** payout / amount_staked for each wallet */
  perDollarReturn: Record<string, number>;
}

// ── Core simulation ────────────────────────────────────────────────────────

function simulate(projects: Project[], totalPool: number): SimResult {
  // S_i — total staked per project
  const totalStaked: Record<string, number> = {};
  for (const p of projects) {
    totalStaked[p.id] = Object.values(p.stakes).reduce((a, b) => a + b, 0);
  }

  // C_i and R_i
  const crowding: Record<string, number> = {};
  const rawWeight: Record<string, number> = {};
  for (const p of projects) {
    crowding[p.id] = Math.sqrt(totalStaked[p.id]);
    rawWeight[p.id] = judgeWeight(p.rank) * crowding[p.id];
  }

  const R_total = Object.values(rawWeight).reduce((a, b) => a + b, 0);

  // P_i — each project's share of the pool
  const projectPool: Record<string, number> = {};
  for (const p of projects) {
    projectPool[p.id] = (rawWeight[p.id] / R_total) * totalPool;
  }

  // Per-wallet payouts and per-dollar returns
  const payouts: Record<string, number> = {};
  const amountStaked: Record<string, number> = {};

  for (const p of projects) {
    for (const [wallet, amount] of Object.entries(p.stakes)) {
      const share = amount / totalStaked[p.id];
      payouts[wallet] = (payouts[wallet] ?? 0) + share * projectPool[p.id];
      amountStaked[wallet] = (amountStaked[wallet] ?? 0) + amount;
    }
  }

  const perDollarReturn: Record<string, number> = {};
  for (const [wallet, payout] of Object.entries(payouts)) {
    perDollarReturn[wallet] = payout / amountStaked[wallet];
  }

  return { totalStaked, crowding, rawWeight, projectPool, payouts, perDollarReturn };
}

// ── Assertion helpers ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assertClose(label: string, actual: number, expected: number, tol = 1.0): void {
  const diff = Math.abs(actual - expected);
  if (diff <= tol) {
    console.log(`  ✓ ${label}: ${actual.toFixed(4)} ≈ ${expected.toFixed(4)}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: got ${actual.toFixed(4)}, expected ${expected.toFixed(4)} (diff ${diff.toFixed(4)})`);
    failed++;
  }
}

function assertGt(label: string, a: number, b: number): void {
  if (a > b) {
    console.log(`  ✓ ${label}: ${a.toFixed(4)} > ${b.toFixed(4)}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: ${a.toFixed(4)} NOT > ${b.toFixed(4)}`);
    failed++;
  }
}

function header(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Test: ${title}`);
  console.log("─".repeat(60));
}

function printResult(r: SimResult): void {
  for (const [id, pool] of Object.entries(r.projectPool)) {
    console.log(
      `  [${id}] S=${r.totalStaked[id]} C=${r.crowding[id].toFixed(2)} ` +
      `R=${r.rawWeight[id].toFixed(2)} P=${pool.toFixed(2)}`
    );
  }
  for (const [wallet, payout] of Object.entries(r.payouts)) {
    console.log(
      `  ${wallet}: payout=${payout.toFixed(2)}  ` +
      `per$=${r.perDollarReturn[wallet].toFixed(4)}x`
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Test Case 1 — Single rank-1 project, single staker
//
// Only one project exists.  Regardless of rank weight, the full pool must
// be disbursed to the single participant.  Per-dollar return == 1.0.
// ══════════════════════════════════════════════════════════════════════════

header("TC1 — All funds on rank-1 winner (single project)");

const tc1Projects: Project[] = [
  { id: "proj-A", rank: 1, stakes: { alice: 1_000_000 } },
];
const tc1Pool = 1_000_000;
const tc1 = simulate(tc1Projects, tc1Pool);
printResult(tc1);

// Entire pool goes to alice
assertClose("alice payout == pool", tc1.payouts["alice"], tc1Pool);
assertClose("alice per-dollar return", tc1.perDollarReturn["alice"], 1.0, 1e-9);

// ══════════════════════════════════════════════════════════════════════════
// Test Case 2 — Single rank-4 project (lowest tier), single staker
//
// Even the "loser" project is the only project, so the entire pool must
// still be disbursed.  Per-dollar return == 1.0.
// ══════════════════════════════════════════════════════════════════════════

header("TC2 — All funds on rank-4 loser (single project)");

const tc2Projects: Project[] = [
  { id: "proj-A", rank: 4, stakes: { alice: 1_000_000 } },
];
const tc2Pool = 1_000_000;
const tc2 = simulate(tc2Projects, tc2Pool);
printResult(tc2);

assertClose("alice payout == pool", tc2.payouts["alice"], tc2Pool);
assertClose("alice per-dollar return", tc2.perDollarReturn["alice"], 1.0, 1e-9);

// ══════════════════════════════════════════════════════════════════════════
// Test Case 3 — 5 projects, ranks 1-5, equal stake per project
//
// With equal crowding (same S_i), payout ratios match judge weight ratios.
// Total pool is always fully disbursed (sum of P_i == T).
//
// Expected pool shares (J weights 55:30:10:5:5, R_total proportional):
//   P1 = 55/105 * 5_000_000 = 2_619_047.619
//   P2 = 30/105 * 5_000_000 = 1_428_571.429
//   P3 = 10/105 * 5_000_000 =   476_190.476
//   P4 =  5/105 * 5_000_000 =   238_095.238
//   P5 =  5/105 * 5_000_000 =   238_095.238
// ══════════════════════════════════════════════════════════════════════════

header("TC3 — Even distribution across 5 projects, ranks 1-5");

const EQUAL_STAKE = 1_000_000;
const tc3Projects: Project[] = [
  { id: "proj-1", rank: 1, stakes: { alice:   EQUAL_STAKE } },
  { id: "proj-2", rank: 2, stakes: { bob:     EQUAL_STAKE } },
  { id: "proj-3", rank: 3, stakes: { carol:   EQUAL_STAKE } },
  { id: "proj-4", rank: 4, stakes: { dave:    EQUAL_STAKE } },
  { id: "proj-5", rank: 5, stakes: { eve:     EQUAL_STAKE } },
];
const tc3Pool = 5 * EQUAL_STAKE;
const tc3 = simulate(tc3Projects, tc3Pool);
printResult(tc3);

const R_TOTAL_TC3 = 105; // 55+30+10+5+5 (equal C_i cancel)
assertClose("proj-1 pool share", tc3.projectPool["proj-1"], (55 / R_TOTAL_TC3) * tc3Pool, 1);
assertClose("proj-2 pool share", tc3.projectPool["proj-2"], (30 / R_TOTAL_TC3) * tc3Pool, 1);
assertClose("proj-3 pool share", tc3.projectPool["proj-3"], (10 / R_TOTAL_TC3) * tc3Pool, 1);
assertClose("proj-4 pool share", tc3.projectPool["proj-4"], ( 5 / R_TOTAL_TC3) * tc3Pool, 1);
assertClose("proj-5 pool share", tc3.projectPool["proj-5"], ( 5 / R_TOTAL_TC3) * tc3Pool, 1);

// Full disbursement invariant
const tc3TotalPayout = Object.values(tc3.payouts).reduce((a, b) => a + b, 0);
assertClose("total payout == pool", tc3TotalPayout, tc3Pool, 1);

// Rank-1 backer gets more than rank-2, which gets more than rank-3
assertGt("alice payout > bob payout", tc3.payouts["alice"], tc3.payouts["bob"]);
assertGt("bob payout > carol payout", tc3.payouts["bob"], tc3.payouts["carol"]);
assertGt("carol payout > dave payout", tc3.payouts["carol"], tc3.payouts["dave"]);
assertClose("dave payout == eve payout", tc3.payouts["dave"], tc3.payouts["eve"], 1);

// ══════════════════════════════════════════════════════════════════════════
// Test Case 4 — Sybil resistance: 20 wallets × 1000 vs 1 whale × 20000
//
// Two projects with identical total stake (20_000 each) but different
// distribution of wallets.  The sqrt crowding factor C = sqrt(20_000) is
// the same for both, so the group of 20 wallets receives the same total
// payout as a single whale would.
//
// Assertion: sum of the 20 wallets' payouts == what 1 wallet staking 20000
// would have received on the same project.
// ══════════════════════════════════════════════════════════════════════════

header("TC4 — Sybil sim: 20 wallets × 1000 vs 1 whale × 20000");

const SYBIL_STAKE = 1_000;
const WHALE_STAKE = 20_000;
const WALLET_COUNT = 20;

// 20 sybil wallets on proj-A (rank 1)
const sybilStakes: Record<string, number> = {};
for (let i = 0; i < WALLET_COUNT; i++) sybilStakes[`sybil-${i}`] = SYBIL_STAKE;

const tc4Projects: Project[] = [
  { id: "proj-A", rank: 1, stakes: sybilStakes },
  { id: "proj-B", rank: 2, stakes: { whale: WHALE_STAKE } },
];
const tc4Pool = WALLET_COUNT * SYBIL_STAKE + WHALE_STAKE; // 40_000
const tc4 = simulate(tc4Projects, tc4Pool);
printResult(tc4);

// Both projects have same C; pool share ratio == weight ratio 55:30
const expectedPoolA = (55 / 85) * tc4Pool;
const expectedPoolB = (30 / 85) * tc4Pool;
assertClose("proj-A pool share", tc4.projectPool["proj-A"], expectedPoolA, 1);
assertClose("proj-B pool share", tc4.projectPool["proj-B"], expectedPoolB, 1);

// Key invariant: all 20 sybil wallets together get exactly proj-A's pool share
const sybilTotal = Object.entries(tc4.payouts)
  .filter(([k]) => k.startsWith("sybil-"))
  .reduce((sum, [, v]) => sum + v, 0);
assertClose("20-wallet sybil total == proj-A pool share", sybilTotal, tc4.projectPool["proj-A"], 1);

// Each sybil wallet gets 1/20 of proj-A's share — equal treatment
const perSybil = sybilTotal / WALLET_COUNT;
for (let i = 0; i < WALLET_COUNT; i++) {
  assertClose(`sybil-${i} payout == 1/20 of proj-A`, tc4.payouts[`sybil-${i}`], perSybil, 1);
}

// Whale per-dollar return
console.log(`  whale per-dollar: ${tc4.perDollarReturn["whale"].toFixed(4)}x`);
console.log(`  sybil per-dollar: ${(tc4.payouts["sybil-0"] / SYBIL_STAKE).toFixed(4)}x`);

// ══════════════════════════════════════════════════════════════════════════
// Test Case 5 — Crowded rank-2 vs lightly-backed rank-1
//
// Demonstrates that per-dollar return is dramatically higher for the lightly
// backed rank-1 project vs the crowded rank-2 project.
//
//   proj-A: rank 1, S = 1_000   → C ≈ 31.62, R = 55 × 31.62 = 1739
//   proj-B: rank 2, S = 1_000_000 → C = 1000,  R = 30 × 1000 = 30_000
//   R_total ≈ 31_739
//   P_A = (1739 / 31739) × 1_001_000 ≈ 54_852
//   P_B = (30000 / 31739) × 1_001_000 ≈ 946_148
//   alice per-dollar ≈ 54.9x
//   whale per-dollar ≈ 0.946x
// ══════════════════════════════════════════════════════════════════════════

header("TC5 — Crowded rank-2 vs lightly-backed rank-1 (per-dollar return)");

const LIGHT_STAKE = 1_000;
const HEAVY_STAKE = 1_000_000;

const tc5Projects: Project[] = [
  { id: "proj-A", rank: 1, stakes: { alice: LIGHT_STAKE } },
  { id: "proj-B", rank: 2, stakes: { whale: HEAVY_STAKE } },
];
const tc5Pool = LIGHT_STAKE + HEAVY_STAKE;
const tc5 = simulate(tc5Projects, tc5Pool);
printResult(tc5);

// Alice should get much more than 1x return
assertGt("alice per-dollar > 1.0 (lightly backed rank-1)", tc5.perDollarReturn["alice"], 1.0);
// Whale (crowded rank-2) gets less than 1x return
assertGt("1.0 > whale per-dollar (crowded rank-2)", 1.0, tc5.perDollarReturn["whale"]);
// Alice's per-dollar return is dramatically better than the whale's
assertGt("alice per-dollar >> whale per-dollar", tc5.perDollarReturn["alice"], tc5.perDollarReturn["whale"]);
// Full disbursement
const tc5TotalPayout = Object.values(tc5.payouts).reduce((a, b) => a + b, 0);
assertClose("full disbursement", tc5TotalPayout, tc5Pool, 1);

// ══════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════

console.log(`\n${"═".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("Step 2 PASSED — all payout simulations correct.");
} else {
  console.error("Step 2 FAILED — fix errors above before proceeding.");
  process.exit(1);
}
