import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { newId } from "../../../lib/ids";
import { getDb, payments } from "../../db/client";
import * as paypal from "../../lib/paypal";
import { publicInvoice } from "../invoices/invoices.service";
import { account, type Posting, post } from "../ledger/ledger.service";
import { applyInvoicePayment, appOrigin } from "./applyPayment";
import {
  InvoiceNotPayableError,
  PaymentNotFoundError,
} from "./payments.errors";

// A payment lives in three steps: an order the payer approves, a capture
// PayPal confirms, and a posting that moves the money in our ledger. Only
// the last step is allowed to change what anyone is owed, and it is keyed by
// the capture id, so the capture route and the webhook may both run it.

/** Starts a PayPal order for what is still due on this invoice. */
export async function startPaypalOrder(invoiceToken: string): Promise<{
  paymentId: string;
  orderId: string;
  approveUrl: string | null;
  amountMinor: string;
  currency: string;
}> {
  const invoice = await publicInvoice(invoiceToken);
  if (!invoice) throw new PaymentNotFoundError("No such invoice.");
  if (invoice.status !== "pending")
    throw new InvoiceNotPayableError(
      `This invoice is already ${invoice.status}.`,
    );
  const due = BigInt(invoice.totalMinor) - BigInt(invoice.paidMinor);
  if (due <= 0n)
    throw new InvoiceNotPayableError("Nothing is left to pay on this invoice.");

  const paymentId = newId();
  const order = await paypal.createOrder({
    paymentId,
    amountMinor: due,
    currency: invoice.currency,
    description: invoice.notes || `Invoice ${invoice.number}`,
    invoiceNumber: invoice.number,
    returnUrl: `${appOrigin()}/i/${invoice.token}?paid=1`,
    cancelUrl: `${appOrigin()}/i/${invoice.token}`,
  });
  await getDb().insert(payments).values({
    id: paymentId,
    invoiceId: invoice.id,
    owner: invoice.username,
    provider: "paypal",
    orderId: order.orderId,
    status: "created",
    amountMinor: due.toString(),
    currency: invoice.currency,
  });
  return {
    paymentId,
    orderId: order.orderId,
    approveUrl: order.approveUrl,
    amountMinor: due.toString(),
    currency: invoice.currency,
  };
}

/** Captures an approved order and records the result. */
export async function capturePaypalOrder(orderId: string) {
  const row = await paymentByOrder(orderId);
  if (!row) throw new PaymentNotFoundError("No such order.");
  const capture = await paypal.captureOrder(orderId);
  return recordCapture(capture);
}

export async function paymentByOrder(orderId: string) {
  const [row] = await getDb()
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1);
  return row ?? null;
}

/**
 * The money path's only writer. Posts the capture to the ledger, marks the
 * payment captured and reports the invoice paid. Safe to run again with the
 * same capture: the ledger refuses a second posting and the invoice is
 * reported with the sum of its captures rather than a delta.
 */
export async function recordCapture(capture: paypal.Capture): Promise<{
  recorded: boolean;
  paidMinor: string;
  invoiceId: string;
  becamePaid: boolean;
}> {
  const row = capture.orderId
    ? await paymentByOrder(capture.orderId)
    : await paymentById(capture.paymentId);
  if (!row)
    throw new PaymentNotFoundError(
      `Capture ${capture.captureId} matches no payment of ours.`,
    );
  if (capture.status !== "COMPLETED" && capture.status !== "PENDING")
    throw new InvoiceNotPayableError(
      `Capture ${capture.captureId} is ${capture.status}.`,
    );

  const net = capture.grossMinor - capture.feeMinor;
  // The payer's money lands at PayPal minus their fee; the gross becomes a
  // liability towards the merchant until it is split and paid out.
  const { posted } = await post(
    {
      id: `capture:${capture.captureId}`,
      kind: "payment.captured",
      owner: row.owner,
      ref: `invoice:${row.invoiceId}`,
      memo: `PayPal capture ${capture.captureId}`,
      currency: capture.currency,
    },
    (
      [
        { account: account.paypalCash(), debitMinor: net },
        { account: account.pspFee(), debitMinor: capture.feeMinor },
        {
          account: account.inFlight(row.owner),
          creditMinor: capture.grossMinor,
        },
      ] satisfies Posting[]
    ).filter((p) => (p.debitMinor ?? p.creditMinor ?? 0n) > 0n),
  );

  const now = new Date();
  await getDb()
    .update(payments)
    .set({
      captureId: capture.captureId,
      status: "captured",
      capturedMinor: capture.grossMinor.toString(),
      feeMinor: capture.feeMinor.toString(),
      updatedAt: now,
    })
    .where(and(eq(payments.id, row.id), eq(payments.status, "created")));

  const paid = await capturedTotal(row.invoiceId);
  const applied = await applyInvoicePayment(
    row.owner,
    row.invoiceId,
    paid.toString(),
    { await: true },
  );
  return {
    recorded: posted,
    paidMinor: paid.toString(),
    invoiceId: row.invoiceId,
    becamePaid: applied.becamePaid,
  };
}

async function paymentById(id: string | null) {
  if (!id) return null;
  const [row] = await getDb()
    .select()
    .from(payments)
    .where(eq(payments.id, id))
    .limit(1);
  return row ?? null;
}

/** Everything captured against one invoice, as minor units. */
export async function capturedTotal(invoiceId: string): Promise<bigint> {
  const [row] = await getDb()
    .select({
      total: sql<string>`coalesce(sum(${payments.capturedMinor}), 0)`,
    })
    .from(payments)
    .where(
      and(eq(payments.invoiceId, invoiceId), eq(payments.status, "captured")),
    );
  return BigInt(row?.total ?? "0");
}
