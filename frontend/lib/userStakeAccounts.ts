import type { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export interface UserStakeInfo {
  pubkey: PublicKey;
  user: PublicKey;
  project: PublicKey;
  amount: bigint;
  shares: bigint;
  stakeTimestamp: number;
  isClaimed: boolean;
}

const CURRENT_USER_STAKE_SIZE = 98;
const LEGACY_USER_STAKE_NO_SHARES_SIZE = 90;

function getView(data: Uint8Array) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readPubkey(data: Uint8Array, offset: number) {
  return new PublicKey(data.slice(offset, offset + 32));
}

function readU64(data: Uint8Array, offset: number) {
  return getView(data).getBigUint64(offset, true);
}

function readI64(data: Uint8Array, offset: number) {
  return Number(getView(data).getBigInt64(offset, true));
}

export function decodeUserStakeAccount(pubkey: PublicKey, data: Uint8Array): UserStakeInfo | null {
  if (data.length === CURRENT_USER_STAKE_SIZE) {
    return {
      pubkey,
      user: readPubkey(data, 8),
      project: readPubkey(data, 40),
      amount: readU64(data, 72),
      shares: readU64(data, 80),
      stakeTimestamp: readI64(data, 88),
      isClaimed: data[96] === 1,
    };
  }

  if (data.length === LEGACY_USER_STAKE_NO_SHARES_SIZE) {
    const amount = readU64(data, 72);

    return {
      pubkey,
      user: readPubkey(data, 8),
      project: readPubkey(data, 40),
      amount,
      // Legacy stake accounts predate the explicit shares field, so the best
      // available frontend fallback is a 1:1 amount-to-shares mapping.
      shares: amount,
      stakeTimestamp: readI64(data, 80),
      isClaimed: data[88] === 1,
    };
  }

  return null;
}

export async function fetchUserStakeAccount(
  program: Program<any>,
  stakePubkey: PublicKey,
): Promise<UserStakeInfo | null> {
  const accountInfo = await program.provider.connection.getAccountInfo(
    stakePubkey,
    program.provider.connection.commitment,
  );

  if (!accountInfo) return null;
  return decodeUserStakeAccount(stakePubkey, accountInfo.data);
}

export async function fetchUserStakeAccountsForWallet(
  program: Program<any>,
  walletPubkey: PublicKey,
): Promise<UserStakeInfo[]> {
  const discriminatorFilter = program.coder.accounts.memcmp("userStake");

  const accountInfos = await program.provider.connection.getProgramAccounts(program.programId, {
    commitment: program.provider.connection.commitment,
    filters: [
      { memcmp: { offset: discriminatorFilter.offset, bytes: discriminatorFilter.bytes } },
      { memcmp: { offset: 8, bytes: walletPubkey.toBase58() } },
    ],
  });

  return accountInfos
    .map(({ pubkey, account }) => decodeUserStakeAccount(pubkey, account.data))
    .filter((stake): stake is UserStakeInfo => stake !== null);
}
