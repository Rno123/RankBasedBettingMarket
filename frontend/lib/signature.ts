export function signatureToBase64(signature: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(signature).toString("base64");
  }

  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}
