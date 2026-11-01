import "server-only";
import { getProfiles, getUsers } from "../../db/mongo";
import {
  EscrowMissingError,
  EscrowRevisionConflictError,
  RecoveryAlreadySetError,
} from "./accounts.errors";
import type {
  AccountTypeOutput,
  EscrowInput,
  EscrowOutput,
  MeOutput,
  PasskeyInput,
  RotateEscrowInput,
  SetAccountTypeInput,
} from "./accounts.schema";

async function ensureUser(userId: string, email?: string) {
  const now = new Date();
  await (await getUsers()).updateOne(
    { _id: userId },
    {
      $setOnInsert: { createdAt: now },
      $set: { updatedAt: now, ...(email ? { email } : {}) },
    },
    { upsert: true },
  );
}

export async function me(userId: string, email?: string): Promise<MeOutput> {
  await ensureUser(userId, email);
  const [user, profile] = await Promise.all([
    (await getUsers()).findOne({ _id: userId }),
    (await getProfiles()).findOne({ userId }),
  ]);
  return {
    recovery: user?.passkey ? "passkey" : user?.escrow ? "pin" : null,
    passkey: user?.passkey ?? null,
    username: profile?._id ?? null,
    accountType: user?.accountType ?? null,
    businessName: user?.businessName ?? null,
  };
}

/** Personal, freelancer or business: changeable at any time. */
export async function setAccountType(
  userId: string,
  input: SetAccountTypeInput,
): Promise<AccountTypeOutput> {
  await ensureUser(userId);
  const businessName =
    input.accountType === "personal" ? null : input.businessName || null;
  await (await getUsers()).updateOne(
    { _id: userId },
    {
      $set: {
        accountType: input.accountType,
        businessName,
        updatedAt: new Date(),
      },
    },
  );
  return { accountType: input.accountType, businessName };
}

// Recovery is write-once: a second method would mean a second master, and the
// account's keys derive from exactly one.
const noRecovery = {
  escrow: { $exists: false },
  passkey: { $exists: false },
};

export async function saveEscrow(
  userId: string,
  input: EscrowInput,
): Promise<void> {
  await ensureUser(userId);
  const result = await (await getUsers()).updateOne(
    { _id: userId, ...noRecovery },
    { $set: { escrow: { ...input, revision: 1 }, updatedAt: new Date() } },
  );
  if (result.matchedCount !== 1) throw new RecoveryAlreadySetError();
}

export async function savePasskey(
  userId: string,
  input: PasskeyInput,
): Promise<void> {
  await ensureUser(userId);
  const result = await (await getUsers()).updateOne(
    { _id: userId, ...noRecovery },
    { $set: { passkey: input, updatedAt: new Date() } },
  );
  if (result.matchedCount !== 1) throw new RecoveryAlreadySetError();
}

export async function getEscrow(userId: string): Promise<EscrowOutput> {
  const user = await (await getUsers()).findOne({ _id: userId });
  return user?.escrow ?? null;
}

export async function rotateEscrow(
  userId: string,
  input: RotateEscrowInput,
): Promise<{ revision: number }> {
  const revision = input.expectedRevision + 1;
  const users = await getUsers();
  const result = await users.updateOne(
    { _id: userId, "escrow.revision": input.expectedRevision },
    {
      $set: {
        escrow: { ...input.escrow, revision },
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 1) return { revision };
  if (!(await users.findOne({ _id: userId }))?.escrow)
    throw new EscrowMissingError();
  throw new EscrowRevisionConflictError();
}
