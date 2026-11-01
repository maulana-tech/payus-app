import "server-only";
import { randomBytes } from "node:crypto";
import { toDecimal } from "../../../features/invoices/money";
import type { InvoiceView } from "../../../features/invoices/types";
import { getInvoices } from "../../db/mongo";
import { createInvoice, publicInvoice } from "../invoices/invoices.service";
import type { CheckoutInput, CheckoutView } from "./developer.schema";

// A checkout is an invoice created by the merchant's server. It is paid and
// settled exactly like one, and a signed webhook tells the merchant's server
// once it is reported paid.

export function toCheckout(invoice: InvoiceView, origin: string): CheckoutView {
  const paid = BigInt(invoice.paidMinor);
  return {
    id: invoice.id,
    object: "checkout",
    status:
      invoice.status === "pending"
        ? paid > 0n
          ? "partially_paid"
          : "open"
        : invoice.status,
    currency: invoice.currency,
    amount: toDecimal(BigInt(invoice.totalMinor)),
    amount_minor: invoice.totalMinor,
    paid_minor: invoice.paidMinor,
    reference: invoice.reference,
    description: invoice.notes,
    url: `${origin}/i/${invoice.token}`,
    embed_url: `${origin}/embed/i/${invoice.token}`,
    created_at: invoice.createdAt,
    paid_reported_at: invoice.paidReportedAt,
  };
}

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export async function createCheckout(
  owner: string,
  input: CheckoutInput,
): Promise<InvoiceView> {
  const id = randomBytes(5).toString("hex").toUpperCase();
  return createInvoice(owner, {
    number: `CO-${id}`,
    clientName: input.customer_name || "Checkout",
    clientEmail: input.customer_email ?? null,
    dueDate: input.due_date ?? inDays(7),
    notes: input.description,
    items: [
      {
        description: input.description || "Checkout",
        quantity: 1,
        unitPrice: input.amount,
      },
    ],
    currency: input.currency,
    recurrence: "none",
    source: "api",
    reference: input.reference ?? null,
  });
}

/** A checkout (any invoice) of `owner`, by id. */
export async function getCheckout(
  owner: string,
  id: string,
): Promise<InvoiceView | null> {
  const doc = await (await getInvoices()).findOne({ _id: id, owner });
  return doc ? publicInvoice(doc.token) : null;
}
