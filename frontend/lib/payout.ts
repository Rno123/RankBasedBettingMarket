// Payout estimation utilities — mirrors on-chain arithmetic exactly.

// Integer square root matching Rust isqrt
export function isqrt(n: bigint): bigint {
  if (n <= 0n) return 0n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x > 0n && x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

// Time-weighted shares matching on-chain compute_shares.
// mult_bps decays linearly from 15000 (1.5×) at start to 10000 (1.0×) at cutoff.
export function computeShares(
  amount: bigint,
  nowSecs: number,
  startTimestamp: number,
  cutoffTimestamp: number,
): bigint {
  const window = cutoffTimestamp - startTimestamp;
  if (window <= 0) return (amount * 10000n) / 10000n;
  const elapsed = Math.max(0, Math.min(nowSecs - startTimestamp, window));
  const multBps = 15000n - (5000n * BigInt(elapsed)) / BigInt(window);
  return (amount * multBps) / 10000n;
}

/**
 * Estimate net payout assuming the project is the sole winner in a tier.
 * When a project is alone in its tier, isqrt(project.totalStaked) cancels
 * with C_total_t, so the formula reduces to the share-weighted form below.
 *
 * tierPct:        0–100 (configured tier percentage, sums to 100 across tiers)
 * protocolFeeBps: e.g. 150 = 1.5%
 */
export function estimatePayout(
  userShares: bigint,
  projectTotalShares: bigint,
  hackathonTotalPool: bigint,
  tierPct: number,
  protocolFeeBps: number,
): bigint {
  if (projectTotalShares === 0n || hackathonTotalPool === 0n || tierPct <= 0) return 0n;
  const gross = (userShares * BigInt(tierPct) * hackathonTotalPool) / (projectTotalShares * 100n);
  return (gross * BigInt(10000 - protocolFeeBps)) / 10000n;
}

// Format a ROI percentage relative to amount staked (+128% / -32%)
export function formatRoi(estimated: bigint, staked: bigint): string {
  if (staked === 0n) return "";
  const bps = ((estimated - staked) * 10000n) / staked;
  const sign = bps >= 0n ? "+" : "";
  const whole = bps / 100n;
  const frac = bps < 0n ? (-bps) % 100n : bps % 100n;
  return `${sign}${whole}.${frac.toString().padStart(2, "0")}%`;
}
