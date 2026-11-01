import "server-only";
import type { MongoServerError } from "mongodb";
import { verifyClaim } from "../../../lib/usernameClaim";
import { getProfiles, getUsers, type ProfileDoc } from "../../db/mongo";
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

const toPublic = (doc: ProfileDoc): PublicProfile => ({
  username: doc._id,
  signPubkeyHex: doc.signPubkeyHex,
  msgPubkeyHex: doc.msgPubkeyHex,
  claimJson: doc.claimJson,
  claimSigHex: doc.claimSigHex,
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

  // The claim must be signed by the key this account's recovery reproduces.
  const user = await (await getUsers()).findOne({ _id: userId });
  if (!user?.escrow && !user?.passkey)
    throw new InvalidClaimError("set up recovery first");
  if (user.passkey && user.passkey.signPubkeyHex !== claim.signPubkeyHex)
    throw new InvalidClaimError("signing key does not match your passkey");

  const profiles = await getProfiles();
  if (await profiles.findOne({ userId })) throw new ProfileExistsError();
  const doc: ProfileDoc = {
    _id: claim.username,
    userId,
    signPubkeyHex: claim.signPubkeyHex,
    msgPubkeyHex: claim.msgPubkeyHex,
    claimJson: input.claimJson,
    claimSigHex: input.claimSigHex.toLowerCase(),
    createdAt: new Date(),
  };
  try {
    await profiles.insertOne(doc);
  } catch (e) {
    if ((e as MongoServerError).code === 11000) {
      if (await profiles.findOne({ userId })) throw new ProfileExistsError();
      throw new UsernameTakenError();
    }
    throw e;
  }
  return toPublic(doc);
}

export async function profileByUsername(
  username: string,
): Promise<PublicProfile | null> {
  const doc = await (await getProfiles()).findOne({ _id: username });
  return doc ? toPublic(doc) : null;
}

export async function myProfile(userId: string): Promise<PublicProfile | null> {
  const doc = await (await getProfiles()).findOne({ userId });
  return doc ? toPublic(doc) : null;
}

export async function usernameAvailable(username: string): Promise<boolean> {
  if (isReservedUsername(username)) return false;
  return !(await (await getProfiles()).findOne({ _id: username }));
}

/** Owner username for a Privy user, or throws for callers that need one. */
export async function requireUsername(userId: string): Promise<string> {
  const doc = await (await getProfiles()).findOne({ userId });
  if (!doc) throw new InvalidClaimError("create your username first");
  return doc._id;
}
