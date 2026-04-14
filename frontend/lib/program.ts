/* eslint-disable @typescript-eslint/no-explicit-any */
import { Connection } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import IDL from "./hackathon_betting.json";
import { RPC_URL } from "./constants";

export function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
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
