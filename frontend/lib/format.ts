import { TOKEN_DECIMALS } from "./constants";

export function formatTokens(raw: bigint, decimals = TOKEN_DECIMALS): string {
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${wholeStr}.${fracStr}` : `${wholeStr}`;
}

export function formatTokensRounded(raw: bigint, decimals = TOKEN_DECIMALS): string {
  const divisor = BigInt(10 ** decimals);
  const rounded = ((raw + divisor / 2n) / divisor) * divisor;
  return formatTokens(rounded, decimals);
}

export function parseTokens(amount: string, decimals = TOKEN_DECIMALS): bigint {
  const normalized = amount.trim();
  if (!normalized || !/^\d*(\.\d*)?$/.test(normalized)) return 0n;
  const [wholeRaw = "0", frac = ""] = normalized.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded);
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeUntil(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "ended";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function hackathonStatus(
  irlHackathonDeadlineTimestamp: number,
  cutoffTimestamp: number,
  isResolved: boolean,
): "open" | "cutoff" | "pending" | "resolved" {
  const now = Math.floor(Date.now() / 1000);
  if (isResolved) return "resolved";
  if (now >= irlHackathonDeadlineTimestamp) return "pending";
  if (now >= cutoffTimestamp) return "cutoff";
  return "open";
}

/** Extract repo name from a GitHub URL: https://github.com/org/repo → org/repo */
export function repoName(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, "").replace(/\/$/, "");
  } catch {
    return url;
  }
}
