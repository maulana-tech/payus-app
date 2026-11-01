import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { KEY_NS } from "./brand";
import { bytesToHex, hexToBytes } from "./crypto";

// Anonymous public-key encryption for small app payloads (payment requests):
// ephemeral X25519 → HKDF-SHA256 → AES-256-GCM. Only the holder of the
// recipient's messaging secret can open it; the server stores ciphertext.
export type Sealed = { epk: string; nonce: string; ct: string };

const INFO = new TextEncoder().encode(`${KEY_NS}.sealed.v1`);

function key(shared: Uint8Array, epk: Uint8Array, recipient: Uint8Array) {
  return hkdf(sha256, shared, concatBytes(epk, recipient), INFO, 32);
}

export function messagingPubkeyHex(secret: Uint8Array): string {
  return bytesToHex(x25519.getPublicKey(secret));
}

export function seal(payload: unknown, recipientPubHex: string): Sealed {
  const recipient = hexToBytes(recipientPubHex);
  const ephSecret = randomBytes(32);
  const epk = x25519.getPublicKey(ephSecret);
  const k = key(x25519.getSharedSecret(ephSecret, recipient), epk, recipient);
  const nonce = randomBytes(12);
  const ct = gcm(k, nonce).encrypt(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  ephSecret.fill(0);
  return { epk: bytesToHex(epk), nonce: bytesToHex(nonce), ct: bytesToHex(ct) };
}

export function open<T>(box: Sealed, secret: Uint8Array): T {
  const epk = hexToBytes(box.epk);
  const recipient = x25519.getPublicKey(secret);
  const k = key(x25519.getSharedSecret(secret, epk), epk, recipient);
  const pt = gcm(k, hexToBytes(box.nonce)).decrypt(hexToBytes(box.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
