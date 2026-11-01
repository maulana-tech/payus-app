import { signingPubkeyHex, signMessage, verifyMessage } from "./signing";

// A username claim binds @username to the keys this account derives on
// unlock. The server stores the claim and its signature but cannot forge
// either, so a compromised server cannot hand out someone else's username.
export type UsernameClaim = {
  v: 1;
  username: string;
  signPubkeyHex: string;
  msgPubkeyHex: string; // X25519, for encrypted payment requests
  issuedAt: string; // ISO timestamp
};

const FIELDS: (keyof UsernameClaim)[] = [
  "v",
  "username",
  "signPubkeyHex",
  "msgPubkeyHex",
  "issuedAt",
];

/** Fixed field order, no whitespace: the exact bytes that get signed. */
export function canonicalClaim(claim: UsernameClaim): string {
  return JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, claim[k]])));
}

export function signClaim(claim: UsernameClaim, seed: Uint8Array): string {
  return signMessage(canonicalClaim(claim), seed);
}

export { signingPubkeyHex };

/** Parses and verifies a stored claim; null when anything is off. */
export function verifyClaim(
  claimJson: string,
  sigHex: string,
): UsernameClaim | null {
  let claim: UsernameClaim;
  try {
    claim = JSON.parse(claimJson) as UsernameClaim;
  } catch {
    return null;
  }
  if (claim?.v !== 1 || canonicalClaim(claim) !== claimJson) return null;
  return verifyMessage(claimJson, sigHex, claim.signPubkeyHex) ? claim : null;
}
