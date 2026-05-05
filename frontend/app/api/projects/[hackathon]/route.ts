import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/program";

const TTL = 30_000;

const cache = new Map<string, { data: unknown; at: number }>();

export async function GET(
  _req: Request,
  segmentData: { params: Promise<{ hackathon: string }> },
) {
  const { hackathon } = await segmentData.params;

  const hit = cache.get(hackathon);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data, headers());
  }

  try {
    new PublicKey(hackathon);
  } catch {
    return NextResponse.json({ error: "Invalid hackathon pubkey" }, { status: 400 });
  }

  try {
    const program = getReadonlyProgram();
    const accounts = await (program.account as any).projectAccount.all([
      { memcmp: { offset: 8, bytes: hackathon } },
    ]);

    const projects = (accounts as any[])
      .map(({ publicKey, account: d }: any) => ({
        pubkey: publicKey.toBase58(),
        hackathon: d.hackathon.toBase58(),
        githubUrl: d.githubUrl,
        totalStaked: (d.totalStaked ?? 0).toString(),
        totalShares: (d.totalShares ?? 0).toString(),
        rank: d.rank,
        builderWallet: d.builderWallet.toBase58(),
        depositAmountPaid: (d.depositAmountPaid ?? 0).toString(),
        builderStaked: (d.builderStaked ?? 0).toString(),
        builderDeclared: d.builderDeclared ?? false,
        submitted: d.submitted,
        isRefundEnabled: d.isRefundEnabled,
        depositForfeited: d.depositForfeited,
        depositRefunded: d.depositRefunded,
      }))
      .sort((a: any, b: any) => {
        if (a.rank === 0 && b.rank === 0) return 0;
        if (a.rank === 0) return 1;
        if (b.rank === 0) return -1;
        return a.rank - b.rank;
      });

    cache.set(hackathon, { data: projects, at: Date.now() });
    return NextResponse.json(projects, headers());
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "RPC error" }, { status: 502 });
  }
}

function headers() {
  return { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } };
}
