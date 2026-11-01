import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "./crypto";

// The account's public signing key (derived from the master, see derive.ts).
// It binds a @username to the account that claimed it: the server stores the
// key and the signature but can forge neither.

const encode = (text: string) => new TextEncoder().encode(text);

export function signingPubkeyHex(seed: Uint8Array): string {
  return bytesToHex(ed25519.getPublicKey(seed));
}

export function signMessage(message: string, seed: Uint8Array): string {
  return bytesToHex(ed25519.sign(encode(message), seed));
}

export function verifyMessage(
  message: string,
  sigHex: string,
  pubkeyHex: string,
): boolean {
  try {
    return ed25519.verify(
      hexToBytes(sigHex),
      encode(message),
      hexToBytes(pubkeyHex),
    );
  } catch {
    return false;
  }
}
