import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import { getReadonlyProgram } from "@/lib/program";
import { PROGRAM_ID } from "@/lib/constants";

function mockProjectPda(hackathonKey: PublicKey, githubUrl: string): string {
  const hash = createHash("sha256").update(githubUrl).digest();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathonKey.toBuffer(), hash],
    PROGRAM_ID,
  )[0].toBase58();
}

const TTL = 30_000;

const cache = new Map<string, { data: unknown; at: number }>();

/* ── Demo mode mock data ───────────────────────────────────────────────────── */

const PROTOCOL_ADMIN = "Cqrzur6cQ7MjY7jq92WwfqsDFPdDXfyXknfJsMnBXjkD";

interface MockProject {
  id: string;
  githubUrl: string;
  totalStaked: number;
  rank: number;
  depositAmountPaid: number;
  builderStaked: number;
  builderDeclared: boolean;
  submitted: boolean;
  isRefundEnabled: boolean;
  depositForfeited: boolean;
  depositRefunded: boolean;
}

const MOCK_PROJECTS: Record<string, MockProject[]> = {
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": [
    { id: "fp-deepgrid", githubUrl: "https://github.com/deepgrid/finance", totalStaked: 87_200_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 150_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "fp-novadex", githubUrl: "https://github.com/novadex/protocol", totalStaked: 64_500_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 100_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "fp-layerflow", githubUrl: "https://github.com/layerflow/ai", totalStaked: 41_800_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 80_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "fp-zenith", githubUrl: "https://github.com/zenith-fi/oracle", totalStaked: 28_100_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 50_000_000, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "fp-tapestry", githubUrl: "https://github.com/tapestry/identity", totalStaked: 15_600_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "fp-ferrum", githubUrl: "https://github.com/ferrum-labs/bridge", totalStaked: 9_300_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 250_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "fp-cipher", githubUrl: "https://github.com/cipher-dao/governance", totalStaked: 5_100_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "fp-stratos", githubUrl: "https://github.com/stratos-labs/yield", totalStaked: 2_830_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
  ],
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bxq": [
    { id: "rn-aurora", githubUrl: "https://github.com/aurora-protocol/defi", totalStaked: 72_100_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 200_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rn-bastion", githubUrl: "https://github.com/bastion-fi/wallet", totalStaked: 51_400_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 100_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rn-catalyst", githubUrl: "https://github.com/catalyst/nft", totalStaked: 33_700_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rn-driftwood", githubUrl: "https://github.com/driftwood/trade", totalStaked: 18_200_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 75_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rn-ember", githubUrl: "https://github.com/ember-labs/payments", totalStaked: 7_100_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
  ],
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s": [
    { id: "bp-nebula", githubUrl: "https://github.com/nebula-swap/amm", totalStaked: 34_200_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 120_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "bp-orbit", githubUrl: "https://github.com/orbit-protocol/lending", totalStaked: 22_500_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 80_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "bp-parallax", githubUrl: "https://github.com/parallax/zk-rollup", totalStaked: 15_800_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "bp-quasar", githubUrl: "https://github.com/quasar-finance/options", totalStaked: 9_400_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 50_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "bp-rift", githubUrl: "https://github.com/rift-protocol/perps", totalStaked: 5_600_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
  ],
  "So11111111111111111111111111111111111111112": [
    { id: "rd-solstice", githubUrl: "https://github.com/solstice-fi/aggregator", totalStaked: 21_300_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 250_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rd-terraform", githubUrl: "https://github.com/terraform-labs/infra", totalStaked: 14_700_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 100_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rd-umbra", githubUrl: "https://github.com/umbra-privacy/mixer", totalStaked: 8_900_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rd-vector", githubUrl: "https://github.com/vector-dao/treasury", totalStaked: 5_200_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "rd-wyvern", githubUrl: "https://github.com/wyvern-sdk/tools", totalStaked: 4_100_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 25_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
  ],
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": [
    { id: "mb-aether", githubUrl: "https://github.com/aether-mobile/wallet", totalStaked: 15_600_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 200_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "mb-borealis", githubUrl: "https://github.com/borealis-app/pay", totalStaked: 9_800_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 80_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "mb-celest", githubUrl: "https://github.com/celest-games/engine", totalStaked: 6_300_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "mb-dune", githubUrl: "https://github.com/dune-mobile/marketplace", totalStaked: 4_050_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "mb-elysian", githubUrl: "https://github.com/elysian-labs/social", totalStaked: 3_000_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 30_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
  ],
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": [
    { id: "dp-helios", githubUrl: "https://github.com/helios-network/routing", totalStaked: 11_200_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 150_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "dp-ion", githubUrl: "https://github.com/ion-storage/decentralized", totalStaked: 7_600_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 75_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "dp-jolt", githubUrl: "https://github.com/jolt-compute/grid", totalStaked: 5_300_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "dp-kinetic", githubUrl: "https://github.com/kinetic-iot/sensors", totalStaked: 3_100_000_000, rank: 0, depositAmountPaid: 0, builderStaked: 0, builderDeclared: false, submitted: false, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
    { id: "dp-lumen", githubUrl: "https://github.com/lumen-broadband/mesh", totalStaked: 1_900_000_000, rank: 0, depositAmountPaid: 10_000_000, builderStaked: 20_000_000, builderDeclared: true, submitted: true, isRefundEnabled: false, depositForfeited: false, depositRefunded: false },
  ],
};

function buildMockProject(p: MockProject, hackathonPubkey: PublicKey) {
  return {
    pubkey: mockProjectPda(hackathonPubkey, p.githubUrl),
    hackathon: hackathonPubkey.toBase58(),
    githubUrl: p.githubUrl,
    totalStaked: p.totalStaked.toString(),
    totalShares: (p.totalStaked * 12_500).toString(), // approx with mid-decay multiplier
    rank: p.rank,
    builderWallet: PROTOCOL_ADMIN,
    depositAmountPaid: p.depositAmountPaid.toString(),
    builderStaked: p.builderStaked.toString(),
    builderDeclared: p.builderDeclared,
    submitted: p.submitted,
    isRefundEnabled: p.isRefundEnabled,
    depositForfeited: p.depositForfeited,
    depositRefunded: p.depositRefunded,
  };
}

/* ── GET ──────────────────────────────────────────────────────────────────── */

export async function GET(
  _req: Request,
  segmentData: { params: Promise<{ hackathon: string }> },
) {
  const { hackathon } = await segmentData.params;

  /* Demo mode: return hardcoded projects */
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    const hackathonPubkey = new PublicKey(hackathon);
    const projects = (MOCK_PROJECTS[hackathon] ?? MOCK_PROJECTS["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"])
      .map((p) => buildMockProject(p, hackathonPubkey))
      .sort((a: any, b: any) => {
        if (a.rank === 0 && b.rank === 0) return Number(BigInt(b.totalStaked) - BigInt(a.totalStaked));
        if (a.rank === 0) return 1;
        if (b.rank === 0) return -1;
        return a.rank - b.rank;
      });
    return NextResponse.json(projects, headers());
  }

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
