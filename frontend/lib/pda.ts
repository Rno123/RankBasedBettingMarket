import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

// Note: SHA-256 is computed in browser via Web Crypto API — see hashUrl()
// PDA seeds mirror the on-chain derivation exactly.

// name is optional: omit for the current deployed program (2-seed legacy PDA).
// Pass name after redeploy when the 3-seed multi-hackathon program is live.
export function hackathonPda(admin: PublicKey, name?: string): PublicKey {
  const seeds = name
    ? [Buffer.from("hackathon"), admin.toBuffer(), Buffer.from(name, "utf8")]
    : [Buffer.from("hackathon"), admin.toBuffer()];
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

export function escrowPda(hackathon: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), hackathon.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function projectPdaFromHash(
  hackathon: PublicKey,
  urlHash: Uint8Array,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), hackathon.toBuffer(), Buffer.from(urlHash)],
    PROGRAM_ID,
  )[0];
}

export async function projectPdaFromUrl(
  hackathon: PublicKey,
  url: string,
): Promise<PublicKey> {
  const hash = await hashUrl(url);
  return projectPdaFromHash(hackathon, hash);
}

export function stakePda(user: PublicKey, project: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), user.toBuffer(), project.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function whitelistPda(hackathon: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), hackathon.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function protocolAdminPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_admin"), wallet.toBuffer()],
    PROGRAM_ID,
  )[0];
}

/** SHA-256 of a UTF-8 string, using the browser's Web Crypto API. */
export async function hashUrl(url: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(url);
  // ArrayBuffer cast satisfies the strict BufferSource type in newer TS lib
  const digest = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return new Uint8Array(digest);
}
