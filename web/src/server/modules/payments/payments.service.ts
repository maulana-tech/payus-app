import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  type Currency,
  formatMinor,
  MAX_ORDER_MINOR,
  toDecimal,
  toMinor,
} from "../../../features/invoices/money";
import { MAX_QUANTITY } from "../../../features/storefront/config";
import { newId } from "../../../lib/ids";
import { getDb, invoices, payments } from "../../db/client";
import * as paypal from "../../lib/paypal";
import { createInvoice, publicInvoice } from "../invoices/invoices.service";
import { account, type Posting, post } from "../ledger/ledger.service";
import { settleCapture } from "../ledger/settlement.service";
import { enqueue } from "../outbox/outbox.service";
import { topics } from "../outbox/topics";
import { resolveLink } from "../paymentLinks/paymentLinks.service";
import { publishedProduct } from "../storefront/storefront.service";
import { applyInvoicePayment, appOrigin } from "./applyPayment";
import {
  InvoiceNotPayableError,
  PaymentNotFoundError,
} from "./payments.errors";
import { capturedTotal, refundedForInvoice, settledForInvoice } from "./totals";

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

/**
 * Paying a payment link. A link is not a bill, so one is written the moment
 * someone decides to pay: the invoice carries the amount, the link that
 * produced it, and from there it is an ordinary payment.
 */
export async function startLinkOrder(input: {
  owner: string;
  slug: string;
  /** Only used when the link lets the payer choose. */
  amount?: string;
}) {
  const link = await resolveLink({ owner: input.owner, slug: input.slug });
  if (!link) throw new PaymentNotFoundError("No such payment link.");

  let amountMinor: bigint;
  try {
    amountMinor = link.amountMinor
      ? BigInt(link.amountMinor)
      : toMinor(input.amount ?? "");
  } catch {
    throw new InvoiceNotPayableError("Enter an amount like 25.00.");
  }
  if (amountMinor <= 0n)
    throw new InvoiceNotPayableError("Enter an amount like 25.00.");
  if (amountMinor > MAX_ORDER_MINOR)
    throw new InvoiceNotPayableError(
      `A single payment cannot come to more than ${formatMinor(MAX_ORDER_MINOR)}.`,
    );

  const invoice = await createInvoice(input.owner, {
    number: `LNK-${newId(8).toUpperCase()}`,
    clientName: "Payment link",
    clientEmail: null,
    dueDate: new Date().toISOString().slice(0, 10),
    notes: link.title,
    items: [
      {
        description: link.title,
        quantity: 1,
        unitPrice: toDecimal(amountMinor),
      },
    ],
    currency: link.currency as Currency,
    recurrence: "none",
    reference: `link:${link.slug}`,
  });
  return { ...(await startPaypalOrder(invoice.token)), token: invoice.token };
}

/**
 * Paying for one item on a storefront. Like a payment link, the invoice is
 * written at the moment someone decides to pay, so a storefront sale settles
 * down exactly the same path as everything else.
 */
export async function startStorefrontOrder(input: {
  slug: string;
  productId: string;
  /** Only used when the item lets the payer name the amount. */
  amount?: string;
  /** Only used when the item lets the payer choose how many. */
  quantity?: number;
}) {
  const found = await publishedProduct(input.slug, input.productId);
  if (!found) throw new PaymentNotFoundError("No such item for sale.");
  const { storefront, product } = found;

  if (product.soldOut)
    throw new InvoiceNotPayableError("That one is sold out.");

  // How many. The page may ask for a number; what it is allowed to be comes
  // from the stored item, never from the request.
  let count = 1n;
  if (product.quantity) {
    const asked = Math.trunc(Number(input.quantity ?? 1));
    const ceiling = Math.min(product.limit, MAX_QUANTITY);
    if (!Number.isFinite(asked) || asked < 1)
      throw new InvoiceNotPayableError("Choose how many you want.");
    if (asked > ceiling)
      throw new InvoiceNotPayableError(
        `You can order at most ${ceiling} of those at once.`,
      );
    count = BigInt(asked);
  }

  // What each costs. A fixed price is read from the shop; an open one is
  // read from the payer and then held to the bounds the shop set.
  let unitMinor: bigint;
  if (product.priceMinor) {
    unitMinor = BigInt(product.priceMinor);
  } else {
    try {
      unitMinor = toMinor(input.amount ?? "");
    } catch {
      throw new InvoiceNotPayableError("Enter an amount like 25.00.");
    }
    const floor = product.minMinor ? BigInt(product.minMinor) : 1n;
    const ceiling = product.maxMinor
      ? BigInt(product.maxMinor)
      : MAX_ORDER_MINOR;
    if (unitMinor < floor)
      throw new InvoiceNotPayableError(
        `The least for this is ${formatMinor(floor, storefront.currency)}.`,
      );
    if (unitMinor > ceiling)
      throw new InvoiceNotPayableError(
        `The most for this is ${formatMinor(ceiling, storefront.currency)}.`,
      );
  }
  if (unitMinor <= 0n)
    throw new InvoiceNotPayableError("Enter an amount like 25.00.");

  const totalMinor = unitMinor * count;
  if (totalMinor > MAX_ORDER_MINOR)
    throw new InvoiceNotPayableError(
      `A single order cannot come to more than ${formatMinor(MAX_ORDER_MINOR, storefront.currency)}.`,
    );

  const invoice = await createInvoice(storefront.owner, {
    number: `SHOP-${newId(8).toUpperCase()}`,
    clientName: "Storefront",
    clientEmail: null,
    dueDate: new Date().toISOString().slice(0, 10),
    notes: `${product.name} — ${storefront.title}`,
    items: [
      {
        description: product.name,
        quantity: Number(count),
        unitPrice: toDecimal(unitMinor),
      },
    ],
    currency: storefront.currency as Currency,
    recurrence: "none",
    reference: `shop:${storefront.slug}/${product.id}`,
  });
  return { ...(await startPaypalOrder(invoice.token)), token: invoice.token };
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

  // Divide it according to the owner's rules. The fast path keeps the demo
  // instant; if it fails, the queue retries it rather than leaving the money
  // sitting in `in_flight` unnoticed.
  try {
    await settleCapture({
      owner: row.owner,
      captureId: capture.captureId,
      invoiceId: row.invoiceId,
      grossMinor: capture.grossMinor,
      currency: capture.currency,
    });
  } catch {
    await enqueue(topics.settleCapture, {
      owner: row.owner,
      captureId: capture.captureId,
      invoiceId: row.invoiceId,
      grossMinor: capture.grossMinor.toString(),
      currency: capture.currency,
    });
  }

  // Net of refunds, not gross. A capture that followed a refund used to
  // report everything ever taken and quietly drop what had been given
  // back, so an invoice that was paid, refunded, then paid again read as
  // overpaid — and a partly refunded one could reach `paid` early.
  const paid = await settledForInvoice(row.invoiceId);
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

export { capturedTotal, refundedForInvoice, settledForInvoice };

export type PaymentActivity = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  capturedMinor: string;
  feeMinor: string;
  currency: string;
  capturedAt: string;
};

/** The owner's most recent captured payments, newest first. */
export async function recentPayments(
  owner: string,
  limit = 8,
): Promise<PaymentActivity[]> {
  const rows = await getDb()
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      invoiceNumber: invoices.number,
      clientName: invoices.clientName,
      capturedMinor: payments.capturedMinor,
      feeMinor: payments.feeMinor,
      currency: payments.currency,
      capturedAt: payments.updatedAt,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(and(eq(payments.owner, owner), eq(payments.status, "captured")))
    .orderBy(desc(payments.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    capturedMinor: row.capturedMinor ?? "0",
    feeMinor: row.feeMinor ?? "0",
    capturedAt: row.capturedAt.toISOString(),
  }));
}
