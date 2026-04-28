export type WhitelistRequestSubmitState =
  | "idle"
  | "loading"
  | "success"
  | "duplicate"
  | "error";
import { signatureToBase64 } from "@/lib/signature";

export async function submitWhitelistRequest(input: {
  hackathonPubkey: string;
  walletAddress: string;
  email: string;
  notes?: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<"success" | "duplicate"> {
  const message = new TextEncoder().encode(
    `hackbet:whitelist-request:${input.hackathonPubkey}`,
  );
  const signature = await input.signMessage(message);
  const signatureBase64 = signatureToBase64(signature);

  const res = await fetch("/api/whitelist-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hackathon_pubkey: input.hackathonPubkey,
      wallet_address: input.walletAddress,
      email: input.email,
      notes: input.notes || undefined,
      signature: signatureBase64,
    }),
  });

  const json = await res.json();
  if (res.status === 409) {
    return "duplicate";
  }
  if (!res.ok) {
    throw new Error(json.error ?? "Something went wrong.");
  }
  return "success";
}
