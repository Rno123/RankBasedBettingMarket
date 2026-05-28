import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram, getConnection } from "@/lib/program";
import { PROGRAM_ID, HIDDEN_HACKATHONS, USDC_MINT } from "@/lib/constants";

// ProjectAccount discriminator = sha256("account:ProjectAccount")[:8]
const PROJECT_DISCRIMINATOR = "X1htXkgi8yH";
// Short TTL so admin state changes (resolve/unresolve) propagate quickly.
const TTL = 5_000;

let cache: { data: unknown; at: number } | null = null;

/* ── Demo mode mock data ───────────────────────────────────────────────────── */

const PROTOCOL_ADMIN = "Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD";

interface MockHackathon {
  id: string;
  name: string;
  totalPool: number;   // USDC lamports
  projectCount: number;
  deadlineDays: number; // days from now
  tierPcts: number[];
  tierExpectedCounts: number[];
}

const MOCK_HACKATHONS: MockHackathon[] = [
  {
    id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    name: "Solana Frontier 2026",
    totalPool: 245_830_000_000,
    projectCount: 247,
    deadlineDays: 18,
    tierPcts: [40, 25, 15, 10, 10],
    tierExpectedCounts: [1, 4, 8, 0, 0],
  },
  {
    id: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bxq",
    name: "Colosseum Renaissance S2",
    totalPool: 182_400_000_000,
    projectCount: 183,
    deadlineDays: 24,
    tierPcts: [35, 25, 20, 20],
    tierExpectedCounts: [1, 3, 6, 0],
  },
  {
    id: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    name: "Breakpoint Hacks 2026",
    totalPool: 87_500_000_000,
    projectCount: 94,
    deadlineDays: 31,
    tierPcts: [50, 30, 20],
    tierExpectedCounts: [3, 5, 0],
  },
  {
    id: "So11111111111111111111111111111111111111112",
    name: "Radar × Superteam",
    totalPool: 54_200_000_000,
    projectCount: 61,
    deadlineDays: 9,
    tierPcts: [60, 40],
    tierExpectedCounts: [1, 3],
  },
  {
    id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    name: "Solana Mobile Wave",
    totalPool: 38_750_000_000,
    projectCount: 42,
    deadlineDays: 14,
    tierPcts: [60, 40],
    tierExpectedCounts: [1, 3],
  },
  {
    id: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    name: "DePIN Frontier",
    totalPool: 29_100_000_000,
    projectCount: 33,
    deadlineDays: 22,
    tierPcts: [50, 30, 20],
    tierExpectedCounts: [2, 4, 0],
  },
];

function buildMockHackathon(h: MockHackathon) {
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + h.deadlineDays * 86400;
  const cutoff = deadline - 86400;
  return {
    pubkey: h.id,
    admin: PROTOCOL_ADMIN,
    usdcMint: USDC_MINT,
    feeRecipient: PROTOCOL_ADMIN,
    name: h.name,
    irlHackathonDeadlineTimestamp: deadline,
    cutoffTimestamp: cutoff,
    startTimestamp: now - 86400,
    totalPool: h.totalPool.toString(),
    depositAmount: "10000000",
    isResolved: false,
    requiresApproval: false,
    openStaking: true,
    protocolFeeBps: 150,
    tierCount: h.tierPcts.length,
    tierPcts: h.tierPcts,
    tierExpectedCounts: h.tierExpectedCounts,
    effectiveTierPcts: h.tierPcts.map(() => 0),
  };
}

/* ── GET ──────────────────────────────────────────────────────────────────── */

export async function GET() {
  /* Demo mode: return hardcoded hackathons */
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    const hackathons = MOCK_HACKATHONS.map(buildMockHackathon).sort(
      (a: any, b: any) => a.irlHackathonDeadlineTimestamp - b.irlHackathonDeadlineTimestamp,
    );
    const projectCounts: Record<string, number> = {};
    for (const h of MOCK_HACKATHONS) projectCounts[h.id] = h.projectCount;
    const payload = { hackathons, projectCounts };
    return NextResponse.json(payload, headers());
  }

  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.data, headers());
  }

  try {
    const program = getReadonlyProgram();
    const connection = getConnection();

    const [hackathonAccounts, projectSlices] = await Promise.all([
      (program.account as any).hackathonState.all([{ dataSize: 314 }]),
      connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ memcmp: { offset: 0, bytes: PROJECT_DISCRIMINATOR } }],
        dataSlice: { offset: 8, length: 32 },
      }),
    ]);

    const projectCounts: Record<string, number> = {};
    for (const { account } of projectSlices) {
      const key = new PublicKey(account.data).toBase58();
      projectCounts[key] = (projectCounts[key] ?? 0) + 1;
    }

    const hackathons = (hackathonAccounts as any[])
      .filter(({ publicKey }: any) => !HIDDEN_HACKATHONS.has(publicKey.toBase58()))
      .flatMap(({ publicKey, account: d }: any) => {
        if (d == null || d.tierCount == null || d.tierPcts == null) return [];
        return [{
          pubkey: publicKey.toBase58(),
          admin: d.admin.toBase58(),
          usdcMint: d.usdcMint.toBase58(),
          feeRecipient: d.feeRecipient.toBase58(),
          name: d.name ?? "",
          irlHackathonDeadlineTimestamp: Number(d.irlHackathonDeadlineTimestamp),
          cutoffTimestamp: Number(d.cutoffTimestamp),
          startTimestamp: Number(d.startTimestamp),
          totalPool: (d.totalPool ?? 0).toString(),
          depositAmount: (d.depositAmount ?? 0).toString(),
          isResolved: d.isResolved,
          requiresApproval: d.requiresApproval ?? false,
          openStaking: d.openStaking ?? true,
          protocolFeeBps: d.protocolFeeBps ?? 150,
          tierCount: d.tierCount,
          tierPcts: Array.from(d.tierPcts as number[]).slice(0, d.tierCount),
          tierExpectedCounts: Array.from(d.tierExpectedCounts as number[]).slice(0, d.tierCount),
          effectiveTierPcts: Array.from(d.effectiveTierPcts as number[]).slice(0, d.tierCount),
        }];
      })
      .sort((a: any, b: any) => {
        if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
        return a.irlHackathonDeadlineTimestamp - b.irlHackathonDeadlineTimestamp;
      });

    const payload = { hackathons, projectCounts };
    cache = { data: payload, at: Date.now() };
    return NextResponse.json(payload, headers());
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "RPC error" }, { status: 502 });
  }
}

function headers() {
  return { headers: { "Cache-Control": "no-store" } };
}
