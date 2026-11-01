import "server-only";
import { eq } from "drizzle-orm";
import { verifyClaim } from "../../../lib/usernameClaim";
import {
  getDb,
  isUniqueViolation,
  type ProfileRow,
  profiles,
  users,
} from "../../db/client";
import {
  InvalidClaimError,
  ProfileExistsError,
  UsernameTakenError,
} from "./profiles.errors";
import {
  type CreateProfileInput,
  isReservedUsername,
  type PublicProfile,
  usernameSchema,
} from "./profiles.schema";

const toPublic = (row: ProfileRow): PublicProfile => ({
  username: row.username,
  signPubkeyHex: row.signPubkeyHex,
  msgPubkeyHex: row.msgPubkeyHex,
  claimJson: row.claimJson,
  claimSigHex: row.claimSigHex,
});

export async function createProfile(
  userId: string,
  input: CreateProfileInput,
): Promise<PublicProfile> {
  const claim = verifyClaim(input.claimJson, input.claimSigHex.toLowerCase());
  if (!claim) throw new InvalidClaimError("bad signature");
  const username = usernameSchema.safeParse(claim.username);
  if (!username.success || username.data !== claim.username)
    throw new InvalidClaimError("invalid username");
  if (isReservedUsername(claim.username)) throw new UsernameTakenError();
  if (!/^[0-9a-f]{64}$/.test(claim.msgPubkeyHex ?? ""))
    throw new InvalidClaimError("invalid messaging key");

  const db = getDb();
  // The claim must be signed by the key this account's recovery reproduces.
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.escrow && !user?.passkey)
    throw new InvalidClaimError("set up recovery first");
  if (user.passkey && user.passkey.signPubkeyHex !== claim.signPubkeyHex)
    throw new InvalidClaimError("signing key does not match your passkey");

  if (await myProfile(userId)) throw new ProfileExistsError();
  try {
    const [row] = await db
      .insert(profiles)
      .values({
        username: claim.username,
        userId,
        signPubkeyHex: claim.signPubkeyHex,
        msgPubkeyHex: claim.msgPubkeyHex,
        claimJson: input.claimJson,
        claimSigHex: input.claimSigHex.toLowerCase(),
      })
      .returning();
    return toPublic(row);
  } catch (e) {
    // One profile per account, one account per username: the unique indexes
    // decide the race, and which one tripped says which error to report.
    if (isUniqueViolation(e)) {
      if (await myProfile(userId)) throw new ProfileExistsError();
      throw new UsernameTakenError();
    }
    throw e;
  }
}

export async function profileByUsername(
  username: string,
): Promise<PublicProfile | null> {
  const [row] = await getDb()
    .select()
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1);
  return row ? toPublic(row) : null;
}

export async function myProfile(userId: string): Promise<PublicProfile | null> {
  const [row] = await getDb()
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row ? toPublic(row) : null;
}

export async function usernameAvailable(username: string): Promise<boolean> {
  if (isReservedUsername(username)) return false;
  return !(await profileByUsername(username));
}

/** Owner username for a Privy user, or throws for callers that need one. */
export async function requireUsername(userId: string): Promise<string> {
  const profile = await myProfile(userId);
  if (!profile) throw new InvalidClaimError("create your username first");
  return profile.username;
}

/** True when @username exists; used before addressing a payment request. */
export async function profileExists(username: string): Promise<boolean> {
  return Boolean(await profileByUsername(username));
}
