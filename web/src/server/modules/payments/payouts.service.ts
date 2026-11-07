import "server-only";
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { DEFAULT_CURRENCY } from "../../../features/invoices/money";
import { isDemoOwner } from "../../../lib/demo";
import { newId } from "../../../lib/ids";
import { getDb, isUniqueViolation, payouts } from "../../db/client";
import { createPayout, payoutsEnabled } from "../../lib/paypal";
import { account } from "../ledger/accounts";
import { balance, post } from "../ledger/ledger.service";

// Releasing what is owed to a merchant. Two things keep a double payment
// impossible: the batch id PayPal dedupes on is derived from the intent, and
// the ledger transaction derived from that batch id can only post once.

export class PayoutRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutRefusedError";
  }
}

/** What is available to release right now. */
export const payableMinor = (owner: string) =>
  balance(account.merchantPayable(owner));

/**
 * PayPal's idempotency key, derived from the whole intent rather than
 * generated: the same intent can only ever send once, and PayPal replays its
 * own batch if we ask twice.
 *
 * `intentKey` is what gives an intent its identity — a nonce the release
 * form holds for as long as that attempt lives, or, once agents propose
 * payouts, the id of the approved proposal. It is part of the hash, so a
 * retry of one attempt dedupes while a deliberate second release does not.
 */
function senderBatchId(intent: {
  owner: string;
  amountMinor: bigint;
  currency: string;
  destination: string;
  intentKey: string;
}): string {
  const canonical = [
    intent.owner,
    intent.amountMinor.toString(),
    intent.currency,
    intent.destination.toLowerCase(),
    intent.intentKey,
  ].join("|");
  return `po_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

export type PayoutView = {
  id: string;
  senderBatchId: string;
  destination: string;
  amountMinor: string;
  currency: string;
  status: "pending" | "paid" | "failed" | "simulated";
  batchId: string | null;
  error: string | null;
  createdAt: string;
};

const toView = (row: typeof payouts.$inferSelect): PayoutView => ({
  id: row.id,
  senderBatchId: row.senderBatchId,
  destination: row.destination,
  amountMinor: row.amountMinor,
  currency: row.currency,
  status: row.status,
  batchId: row.batchId,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Releases money to the merchant. Without Payouts approved on the PayPal
 * account the movement is still recorded — as `payout.simulated`, which the
 * UI labels — so the books stay true and the claim stays honest.
 */
export async function releasePayout(
  owner: string,
  input: { amountMinor: bigint; destination: string; intentKey: string },
): Promise<PayoutView> {
  if (input.amountMinor <= 0n)
    throw new PayoutRefusedError("Release an amount above zero.");
  const available = await payableMinor(owner);
  if (input.amountMinor > available)
    throw new PayoutRefusedError(
      "That is more than is owed to you right now. Take a payment first.",
    );

  const currency = DEFAULT_CURRENCY;
  const batchId = senderBatchId({
    owner,
    amountMinor: input.amountMinor,
    currency,
    destination: input.destination,
    intentKey: input.intentKey,
  });

  // The same intent twice is a retry: hand back the first one.
  const existing = await byBatch(batchId);
  if (existing) return existing;

  const db = getDb();
  let row: typeof payouts.$inferSelect;
  try {
    [row] = await db
      .insert(payouts)
      .values({
        id: newId(),
        owner,
        senderBatchId: batchId,
        destination: input.destination,
        amountMinor: input.amountMinor.toString(),
        currency,
        status: "pending",
      })
      .returning();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await byBatch(batchId);
    if (raced) return raced;
    throw error;
  }

  // A demo account never sends. Payouts can be approved on a sandbox app,
  // and the public demo puts a Release button in front of strangers with a
  // free-text destination — so the one thing it may not do is reach PayPal
  // with it. Recorded as `payout.simulated` and labelled as such, the way
  // any deployment without the permission already behaves.
  const simulated = !payoutsEnabled() || isDemoOwner(owner);
  let providerBatch: string | null = null;
  if (!simulated) {
    try {
      const sent = await createPayout({
        senderBatchId: batchId,
        destination: input.destination,
        amountMinor: input.amountMinor,
        currency,
        note: `Payus release for @${owner}`,
      });
      providerBatch = sent.batchId;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await db
        .update(payouts)
        .set({
          status: "failed",
          error: message.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(eq(payouts.id, row.id))
        .returning();
      // Nothing is posted, because no money left the account. The row stays
      // as the record that it was tried.
      throw new PayoutRefusedError(
        `PayPal refused the payout: ${message.slice(0, 200)}`,
      );
    }
  }

  // The money leaves our PayPal balance and the debt goes with it.
  await post(
    {
      id: `payout:${batchId}`,
      kind: simulated ? "payout.simulated" : "payout",
      owner,
      ref: `payout:${row.id}`,
      memo: simulated
        ? "Simulated: Payouts is not enabled on this PayPal account"
        : `PayPal batch ${providerBatch}`,
      currency,
    },
    [
      {
        account: account.merchantPayable(owner),
        debitMinor: input.amountMinor,
      },
      { account: account.paypalCash(), creditMinor: input.amountMinor },
    ],
  );

  const [settled] = await db
    .update(payouts)
    .set({
      status: simulated ? "simulated" : "paid",
      batchId: providerBatch,
      updatedAt: new Date(),
    })
    .where(eq(payouts.id, row.id))
    .returning();
  return toView(settled);
}

async function byBatch(senderBatch: string): Promise<PayoutView | null> {
  const [row] = await getDb()
    .select()
    .from(payouts)
    .where(eq(payouts.senderBatchId, senderBatch))
    .limit(1);
  return row ? toView(row) : null;
}

export async function listPayouts(owner: string): Promise<PayoutView[]> {
  const rows = await getDb()
    .select()
    .from(payouts)
    .where(eq(payouts.owner, owner))
    .orderBy(desc(payouts.createdAt))
    .limit(20);
  return rows.map(toView);
}
