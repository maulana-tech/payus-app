import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, profiles, users } from "../../db/client";
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
  await getDb()
    .insert(users)
    .values({
      id: userId,
      email: email ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { updatedAt: now, ...(email ? { email } : {}) },
    });
}

export async function me(userId: string, email?: string): Promise<MeOutput> {
  await ensureUser(userId, email);
  const db = getDb();
  const [[user], [profile]] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1),
  ]);
  return {
    recovery: user?.passkey ? "passkey" : user?.escrow ? "pin" : null,
    passkey: user?.passkey ?? null,
    username: profile?.username ?? null,
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
  await getDb()
    .update(users)
    .set({
      accountType: input.accountType,
      businessName,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  return { accountType: input.accountType, businessName };
}

// Recovery is write-once: a second method would mean a second master, and the
// account's keys derive from exactly one.
const noRecovery = and(isNull(users.escrow), isNull(users.passkey));

export async function saveEscrow(
  userId: string,
  input: EscrowInput,
): Promise<void> {
  await ensureUser(userId);
  const updated = await getDb()
    .update(users)
    .set({ escrow: { ...input, revision: 1 }, updatedAt: new Date() })
    .where(and(eq(users.id, userId), noRecovery))
    .returning({ id: users.id });
  if (updated.length !== 1) throw new RecoveryAlreadySetError();
}

export async function savePasskey(
  userId: string,
  input: PasskeyInput,
): Promise<void> {
  await ensureUser(userId);
  const updated = await getDb()
    .update(users)
    .set({ passkey: input, updatedAt: new Date() })
    .where(and(eq(users.id, userId), noRecovery))
    .returning({ id: users.id });
  if (updated.length !== 1) throw new RecoveryAlreadySetError();
}

export async function getEscrow(userId: string): Promise<EscrowOutput> {
  const [user] = await getDb()
    .select({ escrow: users.escrow })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.escrow ?? null;
}

export async function rotateEscrow(
  userId: string,
  input: RotateEscrowInput,
): Promise<{ revision: number }> {
  const revision = input.expectedRevision + 1;
  const db = getDb();
  // Only the revision we were shown may be replaced, so two tabs rotating at
  // once cannot both win.
  const updated = await db
    .update(users)
    .set({ escrow: { ...input.escrow, revision }, updatedAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        sql`(${users.escrow} -> 'revision')::int = ${input.expectedRevision}`,
      ),
    )
    .returning({ id: users.id });
  if (updated.length === 1) return { revision };
  const [user] = await db
    .select({ escrow: users.escrow })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.escrow) throw new EscrowMissingError();
  throw new EscrowRevisionConflictError();
}
