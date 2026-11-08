export type InvoiceState = "pending" | "paid" | "void";

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: string; // decimal in the invoice currency
};

/** What the owner and the public invoice page see. */
/**
 * One payment that actually landed, as the payer can check it.
 *
 * `reference` is PayPal's own capture id — the same string in the payer's
 * PayPal receipt — which is what makes this proof rather than a sentence.
 * It is not a secret: whoever holds the invoice token already holds the
 * invoice, and the payer has this id in their own account either way.
 */
export type InvoiceReceipt = {
  reference: string;
  amountFormatted: string;
  /** ISO time the capture was recorded. */
  at: string;
};

export type InvoiceView = {
  id: string;
  token: string;
  username: string;
  number: string;
  clientName: string;
  items: InvoiceLine[];
  currency: string;
  /** Minor units due, and the same total formatted for display. */
  totalMinor: string;
  totalFormatted: string;
  paidMinor: string;
  notes: string;
  dueDate: string;
  status: InvoiceState;
  /** "api" for checkouts created with the merchant API. */
  source: "dashboard" | "api";
  /** The merchant's order reference, for API checkouts. */
  reference: string | null;
  recurrence: "none" | "weekly" | "monthly";
  /** ISO time the next invoice of the series is issued, if it repeats. */
  nextIssueAt: string | null;
  paidReportedAt: string | null;
  /** Captures against this invoice, newest first. Empty until one lands. */
  receipts: InvoiceReceipt[];
  createdAt: string;
};
