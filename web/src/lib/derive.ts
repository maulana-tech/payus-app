import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { KEY_NS } from "./brand";

const utf8 = (s: string) => new TextEncoder().encode(s);

// The account master (passkey PRF or PIN escrow) is the only root secret.
// Everything below is re-derived on unlock and lives in page memory only.

/** Seed for the Ed25519 key that signs this account's public claims. */
export function profileSigningSeed(master: Uint8Array): Uint8Array {
  return hkdf(sha256, master, undefined, utf8(`${KEY_NS}.profile-sign.v1`), 32);
}

/** X25519 secret for app messages (encrypted payment requests). */
export function messagingSecret(master: Uint8Array): Uint8Array {
  return hkdf(sha256, master, undefined, utf8(`${KEY_NS}.msg.v1`), 32);
}

/** AES-256-GCM key for records kept on this device only. */
export function localVaultKey(master: Uint8Array): Uint8Array {
  return hkdf(sha256, master, undefined, utf8(`${KEY_NS}.vault.v1`), 32);
}
