import "server-only";
import { eq } from "drizzle-orm";
import { demoMaster, demoPrivyUserId, demoUser } from "../../../lib/demo";
import { messagingSecret, profileSigningSeed } from "../../../lib/derive";
import { messagingPubkeyHex } from "../../../lib/sealedBox";
import { signingPubkeyHex } from "../../../lib/signing";
import {
  canonicalClaim,
  signClaim,
  type UsernameClaim,
} from "../../../lib/usernameClaim";
import { getDb, profiles, users } from "../../db/client";

// The fixture behind demo mode: a user row and a profile for the username in
// NEXT_PUBLIC_DEMO_USER. The keys and the claim are derived and signed for
// real, so the account verifies like any other — what is skipped is only the
// recovery setup a human would go through, which exists to protect an
// account nobody can recreate from a username.
//
// `demoUser()` already returns null outside development, so none of this can
// run in a production build.

let ensured: string | null = null;

/** Creates the development demo account if it is missing. */
export async function ensureDemoAccount(): Promise<string | null> {
  const username = demoUser();
  if (!username) return null;
  return ensureDemoAccountFor(username);
}

/**
 * Creates one demo account. The public demo calls this with a name of its
 * own per visitor, which is why it takes one rather than reading the
 * environment: two sandboxes that share an account are one sandbox.
 */
export async function ensureDemoAccountFor(username: string): Promise<string> {
  const userId = demoPrivyUserId(username);
  if (ensured === userId) return userId;

  const master = demoMaster(username);
  const signSeed = profileSigningSeed(master);
  const claim: UsernameClaim = {
    v: 1,
    username,
    signPubkeyHex: signingPubkeyHex(signSeed),
    msgPubkeyHex: messagingPubkeyHex(messagingSecret(master)),
    issuedAt: new Date(0).toISOString(),
  };

  const db = getDb();
  await db
    .insert(users)
    .values({
      id: userId,
      email: `${username}@demo.invalid`,
      accountType: "business",
      businessName: "Demo Co",
    })
    .onConflictDoNothing();
  await db
    .insert(profiles)
    .values({
      username,
      userId,
      signPubkeyHex: claim.signPubkeyHex,
      msgPubkeyHex: claim.msgPubkeyHex,
      claimJson: canonicalClaim(claim),
      claimSigHex: signClaim(claim, signSeed),
    })
    .onConflictDoNothing();

  // If the username belongs to someone else, demo mode must not borrow it.
  const [row] = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1);
  if (row?.userId !== userId)
    throw new Error(`@${username} already belongs to another account.`);

  ensured = userId;
  return userId;
}
