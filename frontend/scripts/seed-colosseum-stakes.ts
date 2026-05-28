import * as anchor from "@coral-xyz/anchor";
import { BN, Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PROGRAM_ID = new PublicKey("5QyJgZfUCLKZnoxSMu9ejraQ9365HrwBmn9WVPnUayDd");
const USDC_MINT = new PublicKey("9sGNYYMokaUVsa1dEEqiPV4DYT2wABt1BcX6FHqVZF15");
const RPC_URL = "https://solana-devnet.core.chainstack.com/9e97c8b2f2ab98524cb7057c9e1a512e";
const HACKATHON_PK = new PublicKey("BmMMgGm1B7bY8b3n6Z5N7K4PYy9gMQ9BkxxQuyeVXf4J");

const PROJECTS = [
  "https://github.com/colosseum-demo/solana-ai-agent",
  "https://github.com/colosseum-demo/defi-yield-optimizer",
  "https://github.com/colosseum-demo/nft-marketplace-v2",
  "https://github.com/colosseum-demo/cross-chain-bridge",
  "https://github.com/colosseum-demo/dao-governance-sdk",
];

// Varied amounts in USDC lamports
const AMOUNTS = [280_000_000, 195_000_000, 150_000_000, 90_000_000, 60_000_000];

function projectPda(hackathon: PublicKey, url: string) {
  const hash = createHash("sha256").update(url).digest();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), hash], PROGRAM_ID)[0];
}
function stakePda(user: PublicKey, project: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), user.toBuffer(), project.toBuffer()], PROGRAM_ID)[0];
}
function escrowPda(hackathon: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), hackathon.toBuffer()], PROGRAM_ID)[0];
}

async function main() {
  const walletPath = process.argv[2] || path.join(os.homedir(), ".config", "solana", "id.json");
  const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  const wallet = new Wallet(keypair);
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(require("../lib/hackathon_betting.json"), provider) as any;

  const admin = wallet.publicKey;
  const adminAta = getAssociatedTokenAddressSync(USDC_MINT, admin);
  const escrowPk = escrowPda(HACKATHON_PK);

  console.log(`Staking on Colosseum Frontier Demo 2026 as ${admin.toBase58().slice(0, 12)}...`);

  for (let i = 0; i < PROJECTS.length; i++) {
    const url = PROJECTS[i];
    const amount = AMOUNTS[i];
    const projectPk = projectPda(HACKATHON_PK, url);
    const userStakePk = stakePda(admin, projectPk);

    const existing = await connection.getAccountInfo(userStakePk);
    if (existing) {
      console.log(`  (already staked) ${url.split("/").pop()} — $${amount / 1_000_000}`);
      continue;
    }

    try {
      const tx = await program.methods.stake(new BN(amount)).accounts({
        user: admin, hackathon: HACKATHON_PK, project: projectPk,
        userStake: userStakePk, userTokenAccount: adminAta, escrow: escrowPk,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).transaction();
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      console.log(`  ✓ $${amount / 1_000_000} on ${url.split("/").pop()}`);
    } catch (e: any) {
      console.error(`  ✗ ${url.split("/").pop()}: ${e.message?.slice(0, 80)}`);
    }
  }

  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
