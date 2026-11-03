import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { DEFAULT_CURRENCY } from "../../../features/invoices/money";
import { reversal, type Share } from "../../../features/refunds/reverse";
import { newId } from "../../../lib/ids";
import { getDb, isUniqueViolation, payments, refunds } from "../../db/client";
import * as paypal from "../../lib/paypal";
import { account } from "../ledger/accounts";
import { entriesOf, type Posting, post } from "../ledger/ledger.service";
import { applyInvoicePayment } from "./applyPayment";
import { capturedTotal } from "./payments.service";

// Giving money back. Two things make this safe to run twice: the refund row
// is keyed by PayPal's refund id, and the ledger transaction derived from it
// can only post once. So the API call and the webhook that follows it both
// land on the same refund, whichever arrives first.
//
// The money comes back out of the pots it went into — see
// `features/refunds/reverse.ts` for why, and for the arithmetic.

export class RefundRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundRefusedError";
  }
}

export type RefundView = {
  id: string;
  refundId: string;
  captureId: string;
  invoiceId: string;
  amountMinor: string;
  feeReturnedMinor: string;
  currency: string;
  status: "pending" | "completed" | "failed";
  source: "owner" | "paypal";
  reason: string | null;
  createdAt: string;
};

const toView = (row: typeof refunds.$inferSelect): RefundView => ({
  id: row.id,
  refundId: row.refundId,
  captureId: row.captureId,
  invoiceId: row.invoiceId,
  amountMinor: row.amountMinor,
  feeReturnedMinor: row.feeReturnedMinor,
  currency: row.currency,
  status: row.status,
  source: row.source,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
});

/** Everything already given back against one capture, as minor units. */
export async function refundedTotal(
  captureId: string,
  exceptRefundId?: string,
): Promise<bigint> {
  const rows = await getDb()
    .select()
    .from(refunds)
    .where(
      and(
        eq(refunds.captureId, captureId),
        inArray(refunds.status, ["completed", "pending"]),
      ),
    );
  return rows
    .filter((row) => row.refundId !== exceptRefundId)
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
}

/** Everything given back against one invoice, across all its captures. */
export async function refundedForInvoice(invoiceId: string): Promise<bigint> {
  const rows = await getDb()
    .select()
    .from(refunds)
    .where(
      and(eq(refunds.invoiceId, invoiceId), eq(refunds.status, "completed")),
    );
  return rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
}

/**
 * How a capture was divided, read back from the ledger rather than
 * recomputed: the rules may have changed since, and what matters is where
 * the money actually went.
 */
async function sharesOf(captureId: string, owner: string): Promise<Share[]> {
  const settled = await entriesOf(`settle:${captureId}`);
  const shares = settled
    .filter((entry) => BigInt(entry.creditMinor) > 0n)
    .map((entry) => ({
      account: entry.account,
      amountMinor: BigInt(entry.creditMinor),
    }));
  if (shares.length > 0) return shares;
  // Never settled: the money is still waiting to be divided, so it comes
  // straight back out of there.
  const captured = await entriesOf(`capture:${captureId}`);
  const inFlight = captured
    .filter((entry) => entry.account === account.inFlight(owner))
    .reduce((sum, entry) => sum + BigInt(entry.creditMinor), 0n);
  return inFlight > 0n
    ? [{ account: account.inFlight(owner), amountMinor: inFlight }]
    : [];
}

/**
 * Records a refund PayPal has told us about, and moves the ledger when it is
 * complete. Safe to call again with the same refund: the row is keyed by
 * PayPal's id and the posting by the transaction derived from it.
 */
export async function recordRefund(
  refund: paypal.Refund,
  context: {
    source: "owner" | "paypal";
    reason?: string | null;
    /** Set when this started here, so a retry finds the row. */
    intentKey?: string | null;
  },
): Promise<RefundView> {
  if (!refund.captureId)
    throw new RefundRefusedError(
      `Refund ${refund.refundId} does not name the capture it came out of.`,
    );
  const [payment] = await getDb()
    .select()
    .from(payments)
    .where(eq(payments.captureId, refund.captureId))
    .limit(1);
  if (!payment)
    throw new RefundRefusedError(
      `Refund ${refund.refundId} is against a capture that is not ours.`,
    );

  const status: "pending" | "completed" | "failed" =
    refund.status === "COMPLETED"
      ? "completed"
      : refund.status === "FAILED" || refund.status === "CANCELLED"
        ? "failed"
        : "pending";

  const db = getDb();
  let row = await byRefundId(refund.refundId);
  if (!row) {
    try {
      [row] = await db
        .insert(refunds)
        .values({
          id: newId(),
          owner: payment.owner,
          paymentId: payment.id,
          invoiceId: payment.invoiceId,
          captureId: refund.captureId,
          refundId: refund.refundId,
          amountMinor: refund.grossMinor.toString(),
          feeReturnedMinor: refund.feeReturnedMinor.toString(),
          currency: refund.currency,
          source: context.source,
          intentKey: context.intentKey ?? null,
          reason: context.reason ?? null,
          status,
        })
        .returning();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      row = await byRefundId(refund.refundId);
    }
  }
  if (!row) throw new RefundRefusedError("Could not record the refund.");

  if (status !== row.status) {
    [row] = await db
      .update(refunds)
      .set({ status, updatedAt: new Date() })
      .where(eq(refunds.id, row.id))
      .returning();
  }
  // Nothing has moved yet, and may never: a pending or failed refund is
  // recorded and left alone.
  if (status !== "completed") return toView(row);

  const before = await refundedTotal(refund.captureId, refund.refundId);
  const shares = await sharesOf(refund.captureId, payment.owner);
  const back = reversal(shares, before, before + refund.grossMinor);

  const postings: Posting[] = [
    ...back.map((share) => ({
      account: share.account,
      debitMinor: share.amountMinor,
    })),
    { account: account.paypalCash(), creditMinor: refund.netMinor },
  ];
  if (refund.feeReturnedMinor > 0n)
    postings.push({
      account: account.pspFee(),
      creditMinor: refund.feeReturnedMinor,
    });

  const given = back.reduce((sum, share) => sum + share.amountMinor, 0n);
  if (given !== refund.grossMinor)
    throw new RefundRefusedError(
      `Refund ${refund.refundId} is larger than what this capture still holds.`,
    );

  await post(
    {
      id: `refund:${refund.refundId}`,
      kind: "refund",
      owner: payment.owner,
      ref: `invoice:${payment.invoiceId}`,
      memo: context.reason
        ? `PayPal refund ${refund.refundId} · ${context.reason}`
        : `PayPal refund ${refund.refundId}`,
      currency: refund.currency,
    },
    postings,
  );

  // The invoice is owed again. `reportPayment` takes the absolute figure, so
  // what it gets is what is actually paid: captured, less what came back.
  const captured = await capturedTotal(payment.invoiceId);
  const returned = await refundedForInvoice(payment.invoiceId);
  const net = captured - returned;
  await applyInvoicePayment(
    payment.owner,
    payment.invoiceId,
    (net > 0n ? net : 0n).toString(),
    { await: true },
  );

  return toView(row);
}

/**
 * Gives money back from here. The owner's own action, so the Guardian is not
 * asked — it guards the agents, not the person whose money it is.
 */
export async function startRefund(
  owner: string,
  input: {
    paymentId: string;
    /** Leave out for everything still refundable. */
    amountMinor?: bigint;
    reason?: string;
    /** Held by the form for one attempt, so a retry cannot refund twice. */
    intentKey: string;
  },
): Promise<RefundView> {
  const [payment] = await getDb()
    .select()
    .from(payments)
    .where(and(eq(payments.id, input.paymentId), eq(payments.owner, owner)))
    .limit(1);
  if (!payment) throw new RefundRefusedError("No such payment.");
  if (!payment.captureId || payment.status !== "captured")
    throw new RefundRefusedError("That payment was never captured.");

  // A retry of one attempt is that attempt, not a second refund. This is
  // checked before anything else, because the amount left will already have
  // gone down by the refund the first try made.
  const previous = await byAttempt(payment.id, input.intentKey);
  if (previous) return toView(previous);

  const captured = BigInt(payment.capturedMinor ?? "0");
  const already = await refundedTotal(payment.captureId);
  const left = captured - already;
  if (left <= 0n)
    throw new RefundRefusedError("That payment has already been given back.");

  const amount = input.amountMinor ?? left;
  if (amount <= 0n)
    throw new RefundRefusedError("Refund an amount above zero.");
  if (amount > left)
    throw new RefundRefusedError(
      `Only ${left} minor units of that payment are still refundable.`,
    );

  const refund = await paypal
    .refundCapture({
      captureId: payment.captureId,
      // PayPal takes the whole remaining amount when none is named, and a
      // full refund returns more of its fee than a partial one does.
      amountMinor: amount === left ? undefined : amount,
      currency: payment.currency || DEFAULT_CURRENCY,
      requestId: `refund-${input.intentKey}`,
      note: input.reason,
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new RefundRefusedError(
        `PayPal refused the refund: ${message.slice(0, 200)}`,
      );
    });

  return recordRefund(refund, {
    source: "owner",
    reason: input.reason ?? null,
    intentKey: input.intentKey,
  });
}

async function byAttempt(paymentId: string, intentKey: string) {
  const [row] = await getDb()
    .select()
    .from(refunds)
    .where(
      and(eq(refunds.paymentId, paymentId), eq(refunds.intentKey, intentKey)),
    )
    .limit(1);
  return row ?? null;
}

async function byRefundId(refundId: string) {
  const [row] = await getDb()
    .select()
    .from(refunds)
    .where(eq(refunds.refundId, refundId))
    .limit(1);
  return row ?? null;
}

/** What was given back against one invoice, for the invoice screens. */
export async function listRefundsForInvoice(
  owner: string,
  invoiceId: string,
): Promise<RefundView[]> {
  const rows = await getDb()
    .select()
    .from(refunds)
    .where(and(eq(refunds.owner, owner), eq(refunds.invoiceId, invoiceId)));
  return rows.map(toView);
}

export type RefundablePayment = {
  paymentId: string;
  captureId: string;
  capturedMinor: string;
  refundedMinor: string;
  refundableMinor: string;
  currency: string;
  capturedAt: string;
};

/**
 * The captured payments behind an invoice and what is still refundable on
 * each. Read from the payments and the refunds, never from the invoice:
 * what was taken and what came back are both facts of their own.
 */
export async function refundablePayments(
  owner: string,
  invoiceId: string,
): Promise<RefundablePayment[]> {
  const rows = await getDb()
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.owner, owner),
        eq(payments.invoiceId, invoiceId),
        eq(payments.status, "captured"),
      ),
    );
  const out: RefundablePayment[] = [];
  for (const row of rows) {
    if (!row.captureId) continue;
    const captured = BigInt(row.capturedMinor ?? "0");
    const returned = await refundedTotal(row.captureId);
    out.push({
      paymentId: row.id,
      captureId: row.captureId,
      capturedMinor: captured.toString(),
      refundedMinor: returned.toString(),
      refundableMinor: (captured > returned
        ? captured - returned
        : 0n
      ).toString(),
      currency: row.currency,
      capturedAt: row.updatedAt.toISOString(),
    });
  }
  return out;
}
