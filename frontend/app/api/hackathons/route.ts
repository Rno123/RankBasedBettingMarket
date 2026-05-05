import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram, getConnection } from "@/lib/program";
import { PROGRAM_ID, HIDDEN_HACKATHONS } from "@/lib/constants";

// ProjectAccount discriminator = sha256("account:ProjectAccount")[:8]
const PROJECT_DISCRIMINATOR = "X1htXkgi8yH";
const TTL = 30_000;

let cache: { data: unknown; at: number } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.data, headers());
  }

  try {
    const program = getReadonlyProgram();
    const connection = getConnection();

    const [hackathonAccounts, projectSlices] = await Promise.all([
      (program.account as any).hackathonState.all(),
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
  return { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } };
}
