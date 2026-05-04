// Payout estimation utilities mirroring the on-chain arithmetic.

export interface SlipEstimateLegInput {
  amountLamports: bigint;
  projectTotalShares: bigint;
  existingUserShares?: bigint;
  existingUserAmount?: bigint;
}

export interface SlipEstimateLegResult {
  amountLamports: bigint;
  estimated: bigint;
  positionStaked: bigint;
  tierPct: number;
}

export interface SlipEstimateResult {
  legs: SlipEstimateLegResult[];
  combinedEstimated: bigint;
  combinedStaked: bigint;
}

// Time-weighted shares matching on-chain compute_shares.
// mult_bps decays linearly from 15000 (1.5x) at start to 10000 (1.0x) at cutoff.
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
 * Estimate net payout with equal split within a tier.
 * Every ranked project gets 1/N of the tier pool.
 *
 * tierPct:        0-100 (configured tier percentage)
 * projectsInTier: expected number of ranked projects sharing this tier
 * protocolFeeBps: e.g. 150 = 1.5%
 */
export function estimatePayout(
  userShares: bigint,
  projectTotalShares: bigint,
  hackathonTotalPool: bigint,
  tierPct: number,
  projectsInTier: number,
  protocolFeeBps: number,
): bigint {
  if (projectTotalShares === 0n || hackathonTotalPool === 0n || tierPct <= 0 || projectsInTier <= 0) return 0n;
  const gross = (userShares * BigInt(tierPct) * hackathonTotalPool)
    / (projectTotalShares * BigInt(projectsInTier) * 100n);
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

function normalizedWeightPoints(weights: number[]): bigint[] {
  const sanitized = weights.map((weight) => (
    Number.isFinite(weight) && weight > 0 ? weight : 0
  ));
  const scaled = sanitized.map((weight) => BigInt(Math.round(weight * 1000)));
  const total = scaled.reduce((sum, weight) => sum + weight, 0n);

  if (total > 0n) return scaled;
  return Array.from({ length: weights.length }, () => 1n);
}

export function splitSlipAmounts(total: bigint, weights: number[]): bigint[] {
  if (total <= 0n || weights.length === 0) return [];

  const normalized = normalizedWeightPoints(weights);
  const weightTotal = normalized.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal <= 0n) return Array.from({ length: weights.length }, () => 0n);

  let allocated = 0n;
  return normalized.map((weight, index) => {
    if (index === normalized.length - 1) {
      return total - allocated;
    }

    const amount = (total * weight) / weightTotal;
    allocated += amount;
    return amount;
  });
}

export function estimateSlipPayout(
  legs: SlipEstimateLegInput[],
  {
    nowSecs,
    startTimestamp,
    cutoffTimestamp,
    hackathonTotalPool,
    tierPcts,
    tierExpectedCounts,
    protocolFeeBps,
  }: {
    nowSecs: number;
    startTimestamp: number;
    cutoffTimestamp: number;
    hackathonTotalPool: bigint;
    tierPcts: number[];
    tierExpectedCounts: number[];
    protocolFeeBps: number;
  },
): SlipEstimateResult {
  if (legs.length === 0) {
    return { legs: [], combinedEstimated: 0n, combinedStaked: 0n };
  }

  const slipTotal = legs.reduce((sum, leg) => sum + leg.amountLamports, 0n);
  const nextPool = hackathonTotalPool + slipTotal;

  const results = legs.map((leg, index) => {
    const newShares = computeShares(
      leg.amountLamports,
      nowSecs,
      startTimestamp,
      cutoffTimestamp,
    );
    const totalUserShares = (leg.existingUserShares ?? 0n) + newShares;
    const totalProjectShares = leg.projectTotalShares + newShares;
    const tierPct = tierPcts[Math.min(index, Math.max(tierPcts.length - 1, 0))] ?? 0;
    const projectsInTier = tierExpectedCounts[Math.min(index, Math.max(tierExpectedCounts.length - 1, 0))] ?? 1;
    const estimated = estimatePayout(
      totalUserShares,
      totalProjectShares,
      nextPool,
      tierPct,
      projectsInTier,
      protocolFeeBps,
    );
    const positionStaked = (leg.existingUserAmount ?? 0n) + leg.amountLamports;

    return {
      amountLamports: leg.amountLamports,
      estimated,
      positionStaked,
      tierPct,
    };
  });

  return {
    legs: results,
    combinedEstimated: results.reduce((sum, leg) => sum + leg.estimated, 0n),
    combinedStaked: results.reduce((sum, leg) => sum + leg.positionStaked, 0n),
  };
}
