/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import _IDL from "./hackathon_betting.json";
import { RPC_URL, PROGRAM_ID } from "./constants";

// Override the IDL's address field — the IDL may have been generated with a
// different keypair than the currently deployed program.
const IDL = { ..._IDL, address: PROGRAM_ID.toBase58() };

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) _connection = new Connection(RPC_URL, "confirmed");
  return _connection;
}

export function getReadonlyProgram(): Program<any> {
  const connection = getConnection();
  const dummyWallet = {
    publicKey: null as any,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  };
  const provider = new AnchorProvider(connection, dummyWallet as any, {
    commitment: "confirmed",
  });
  return new Program(IDL as any, provider);
}

export function getProgram(wallet: AnchorWallet): Program<any> {
  const connection = getConnection();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(IDL as any, provider);
}
