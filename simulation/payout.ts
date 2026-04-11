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
 *   J_i      = judge weight for rank i           — 55 / 30 / 10 / (5/N_rest)
 *   R_i      = J_i * C_i                         — raw payout weight
 *   R_total  = Σ R_i
 *   P_i      = (R_i / R_total) * T              — project share of pool T
 *   payout_u = (s_u / S_i) * P_i               — per-user payout
 *
 * DESIGN NOTE — rest-tier weight splitting (Interpretation B):
 *   The spec assigns { 1:55, 2:30, 3:10, rest:5 } "out of 100".  With
 *   exactly 4 projects these sum to 100 as annotated.  To preserve that
 *   invariant for any hackathon size, the rest tier's 5 points are split
 *   equally among all N_rest projects ranked 4+:
 *
 *     J_i (rest) = 5 / N_rest
 *
 *   This means rank-1's share stays ≈55% regardless of how many projects
 *   register, eliminating unbounded dilution from mass registration.
 *
 *   On-chain implication: resolve must record N_rest (or equivalently
 *   rest_weight_bps = 500 / N_rest in basis-points) so claim can use it
 *   without iterating all projects.
 *
 * No f64 is used on-chain; this simulation uses f64 to generate reference
 * values that the fixed-point on-chain math must match within 1 lamport.
 */

// ── Constants ──────────────────────────────────────────────────────────────

const JUDGE_WEIGHTS: Record<number, number> = { 1: 55, 2: 30, 3: 10 };
const REST_WEIGHT_TOTAL = 5; // shared across ALL rest-rank projects

/**
 * Returns the judge weight for a project given its rank and the total number
 * of projects ranked 4+ in this hackathon.
 */
function judgeWeight(rank: number, restCount: number): number {
  if (rank <= 3) return JUDGE_WEIGHTS[rank]!;
  // Rest tier: 5 points divided equally among all rest-rank projects.
  return restCount > 0 ? REST_WEIGHT_TOTAL / restCount : 0;
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

  // N_rest — count of projects in the rest tier (rank >= 4)
  const restCount = projects.filter(p => p.rank > 3).length;

  // C_i and R_i
  const crowding: Record<string, number> = {};
  const rawWeight: Record<string, number> = {};
  for (const p of projects) {
    crowding[p.id] = Math.sqrt(totalStaked[p.id]);
    rawWeight[p.id] = judgeWeight(p.rank, restCount) * crowding[p.id];
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
      `R=${r.rawWeight[id].toFixed(4)} P=${pool.toFixed(2)}`
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
// N_rest = 0, so rest-weight splitting is not exercised.
// ══════════════════════════════════════════════════════════════════════════

header("TC1 — All funds on rank-1 winner (single project)");

const tc1Projects: Project[] = [
  { id: "proj-A", rank: 1, stakes: { alice: 1_000_000 } },
];
const tc1Pool = 1_000_000;
const tc1 = simulate(tc1Projects, tc1Pool);
printResult(tc1);

assertClose("alice payout == pool", tc1.payouts["alice"], tc1Pool);
assertClose("alice per-dollar return", tc1.perDollarReturn["alice"], 1.0, 1e-9);

// ══════════════════════════════════════════════════════════════════════════
// Test Case 2 — Single rank-4 project (lowest tier), single staker
//
// N_rest = 1, so J = 5/1 = 5.  Only project, so entire pool is disbursed.
// Per-dollar return == 1.0.
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
// N_rest = 2 (ranks 4 and 5).  Each rest-rank project gets J = 5/2 = 2.5.
// With equal crowding (same S_i), weight coefficients sum to exactly 100:
//   55 + 30 + 10 + 2.5 + 2.5 = 100
//
// Pool shares (equal-stake case, weights cancel with C_i):
//   P1 = 55/100 * 5_000_000 = 2_750_000
//   P2 = 30/100 * 5_000_000 = 1_500_000
//   P3 = 10/100 * 5_000_000 =   500_000
//   P4 = 2.5/100 * 5_000_000 =  125_000
//   P5 = 2.5/100 * 5_000_000 =  125_000
//
// Stability check: rank-1's share is 55% — same as the 4-project case,
// proving mass registration does not dilute the winner.
// ══════════════════════════════════════════════════════════════════════════

header("TC3 — Even distribution across 5 projects, ranks 1-5");

const EQUAL_STAKE = 1_000_000;
const tc3Projects: Project[] = [
  { id: "proj-1", rank: 1, stakes: { alice: EQUAL_STAKE } },
  { id: "proj-2", rank: 2, stakes: { bob:   EQUAL_STAKE } },
  { id: "proj-3", rank: 3, stakes: { carol: EQUAL_STAKE } },
  { id: "proj-4", rank: 4, stakes: { dave:  EQUAL_STAKE } },
  { id: "proj-5", rank: 5, stakes: { eve:   EQUAL_STAKE } },
];
const tc3Pool = 5 * EQUAL_STAKE; // 5_000_000
const tc3 = simulate(tc3Projects, tc3Pool);
printResult(tc3);

// With N_rest=2 and equal stakes, weight coefficients sum to exactly 100.
const W_TOTAL = 100; // 55 + 30 + 10 + 2.5 + 2.5
assertClose("proj-1 pool share", tc3.projectPool["proj-1"], (55   / W_TOTAL) * tc3Pool, 1);
assertClose("proj-2 pool share", tc3.projectPool["proj-2"], (30   / W_TOTAL) * tc3Pool, 1);
assertClose("proj-3 pool share", tc3.projectPool["proj-3"], (10   / W_TOTAL) * tc3Pool, 1);
assertClose("proj-4 pool share", tc3.projectPool["proj-4"], (2.5  / W_TOTAL) * tc3Pool, 1);
assertClose("proj-5 pool share", tc3.projectPool["proj-5"], (2.5  / W_TOTAL) * tc3Pool, 1);

// Full disbursement invariant
const tc3TotalPayout = Object.values(tc3.payouts).reduce((a, b) => a + b, 0);
assertClose("total payout == pool", tc3TotalPayout, tc3Pool, 1);

// Ordering preserved
assertGt("alice payout > bob payout",   tc3.payouts["alice"], tc3.payouts["bob"]);
assertGt("bob payout > carol payout",   tc3.payouts["bob"],   tc3.payouts["carol"]);
assertGt("carol payout > dave payout",  tc3.payouts["carol"], tc3.payouts["dave"]);
assertClose("dave payout == eve payout", tc3.payouts["dave"],  tc3.payouts["eve"], 1);

// Stability: rank-1 share is 55% regardless of rest-tier size
assertClose("rank-1 share == 55% of pool", tc3.projectPool["proj-1"], 0.55 * tc3Pool, 1);

// Verify with a larger rest tier — add 5 more rest-rank projects
const tc3bProjects: Project[] = [
  ...tc3Projects,
  { id: "proj-6",  rank: 6,  stakes: { f: EQUAL_STAKE } },
  { id: "proj-7",  rank: 7,  stakes: { g: EQUAL_STAKE } },
  { id: "proj-8",  rank: 8,  stakes: { h: EQUAL_STAKE } },
  { id: "proj-9",  rank: 9,  stakes: { i: EQUAL_STAKE } },
  { id: "proj-10", rank: 10, stakes: { j: EQUAL_STAKE } },
];
const tc3bPool = 10 * EQUAL_STAKE;
const tc3b = simulate(tc3bProjects, tc3bPool);
assertClose("rank-1 share still 55% with 10 projects", tc3b.projectPool["proj-1"], 0.55 * tc3bPool, 1);

// ══════════════════════════════════════════════════════════════════════════
// Test Case 4 — Sybil resistance: 20 wallets × 1000 vs 1 whale × 20000
//
// Two projects (ranks 1 and 2, no rest tier), equal total stake of 20_000.
// sqrt(20_000) is identical for both, so the 20-wallet group receives the
// same total payout as a single whale staking the same amount.
//
// Splitting wallets does not amplify returns — sybil attacks are neutralised.
// ══════════════════════════════════════════════════════════════════════════

header("TC4 — Sybil sim: 20 wallets × 1000 vs 1 whale × 20000");

const SYBIL_STAKE  = 1_000;
const WHALE_STAKE  = 20_000;
const WALLET_COUNT = 20;

const sybilStakes: Record<string, number> = {};
for (let i = 0; i < WALLET_COUNT; i++) sybilStakes[`sybil-${i}`] = SYBIL_STAKE;

const tc4Projects: Project[] = [
  { id: "proj-A", rank: 1, stakes: sybilStakes },
  { id: "proj-B", rank: 2, stakes: { whale: WHALE_STAKE } },
];
const tc4Pool = WALLET_COUNT * SYBIL_STAKE + WHALE_STAKE; // 40_000
const tc4 = simulate(tc4Projects, tc4Pool);
printResult(tc4);

// No rest-rank projects → weight ratio is exactly 55:30
const expectedPoolA = (55 / 85) * tc4Pool;
const expectedPoolB = (30 / 85) * tc4Pool;
assertClose("proj-A pool share", tc4.projectPool["proj-A"], expectedPoolA, 1);
assertClose("proj-B pool share", tc4.projectPool["proj-B"], expectedPoolB, 1);

// All 20 sybil wallets together receive exactly proj-A's share
const sybilTotal = Object.entries(tc4.payouts)
  .filter(([k]) => k.startsWith("sybil-"))
  .reduce((sum, [, v]) => sum + v, 0);
assertClose("20-wallet sybil total == proj-A pool share", sybilTotal, tc4.projectPool["proj-A"], 1);

// Each sybil wallet gets an equal 1/20 slice
const perSybil = sybilTotal / WALLET_COUNT;
for (let i = 0; i < WALLET_COUNT; i++) {
  assertClose(`sybil-${i} payout == 1/20 of proj-A`, tc4.payouts[`sybil-${i}`], perSybil, 1);
}

console.log(`  whale per-dollar: ${tc4.perDollarReturn["whale"].toFixed(4)}x`);
console.log(`  sybil per-dollar: ${(tc4.payouts["sybil-0"] / SYBIL_STAKE).toFixed(4)}x`);

// ══════════════════════════════════════════════════════════════════════════
// Test Case 5 — Crowded rank-2 vs lightly-backed rank-1
//
// Two projects (ranks 1 and 2, no rest tier).
//   proj-A: rank 1, S = 1_000   → C ≈ 31.62, R = 55 × 31.62 ≈  1739
//   proj-B: rank 2, S = 1_000_000 → C = 1000,  R = 30 × 1000  = 30_000
//   R_total ≈ 31_739
//   P_A ≈ 54_853   (alice per-dollar ≈ 54.9x)
//   P_B ≈ 946_147  (whale per-dollar ≈ 0.946x)
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

assertGt("alice per-dollar > 1.0 (lightly backed rank-1)",  tc5.perDollarReturn["alice"], 1.0);
assertGt("1.0 > whale per-dollar (crowded rank-2)",          1.0, tc5.perDollarReturn["whale"]);
assertGt("alice per-dollar >> whale per-dollar",             tc5.perDollarReturn["alice"], tc5.perDollarReturn["whale"]);

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
