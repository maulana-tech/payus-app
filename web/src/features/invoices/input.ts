import { z } from "zod";
import { CURRENCIES, type Currency, DEFAULT_CURRENCY, toMinor } from "./money";
import { RECURRENCES } from "./recurrence";
import type { InvoiceState } from "./types";

const MAX_MINOR = 1_000_000_000n * 100n; // 1B units

const unitPrice = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a price.");

const line = z
  .object({
    description: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(10000),
    unitPrice,
  })
  .strict();

/** Total in the invoice currency's minor unit. */
export function invoiceTotal(
  items: { quantity: number; unitPrice: string }[],
  _currency: Currency = DEFAULT_CURRENCY,
): bigint {
  return items.reduce(
    (total, item) => total + BigInt(item.quantity) * toMinor(item.unitPrice),
    0n,
  );
}

export const invoiceInput = z
  .object({
    number: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._/-]{0,39}$/, "Enter an invoice number."),
    clientName: z.string().trim().min(1).max(120),
    clientEmail: z
      .union([z.string().trim().email().max(200), z.literal("")])
      .optional()
      .transform((v) => v || null),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const date = new Date(`${v}T00:00:00Z`);
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === v
        );
      }, "Choose a valid due date."),
    notes: z.string().trim().max(1000).default(""),
    items: z.array(line).min(1).max(25),
    currency: z.enum(CURRENCIES).default(DEFAULT_CURRENCY),
    recurrence: z.enum(RECURRENCES).default("none"),
  })
  .strict()
  .refine((v) => {
    try {
      const total = invoiceTotal(v.items, v.currency);
      return total > 0n && total <= MAX_MINOR;
    } catch {
      return false;
    }
  }, "Use prices with up to 2 decimals and a positive total.");

export type InvoiceInput = z.input<typeof invoiceInput>;

export function invoiceStatus(
  status: InvoiceState,
  dueDate: string,
  now = new Date(),
) {
  return status === "pending" && now.toISOString().slice(0, 10) > dueDate
    ? "overdue"
    : status;
}

export const invoiceToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
export const invoiceId = z.string().regex(/^[0-9A-Za-z]{8,24}$/);

/**
 * Edits a pending invoice nobody has paid yet; the link stays the same. The
 * owner's list never shows the client email, so an empty one keeps it.
 */
export const invoiceUpdateInput = z
  .object({
    id: invoiceId,
    invoice: invoiceInput,
    keepClientEmail: z.boolean().default(false),
  })
  .strict();

/** "INV-2026-001" → "INV-2026-002", skipping numbers already used. */
export function suggestNextNumber(number: string, taken: Set<string>): string {
  const match = /^(.*?)(\d+)$/.exec(number);
  const base = match ? match[1] : `${number}-`;
  let n = match ? Number(match[2]) : 1;
  const width = match ? match[2].length : 1;
  for (let tries = 0; tries < 1000; tries++) {
    n += 1;
    const next = `${base}${String(n).padStart(width, "0")}`.slice(0, 40);
    if (!taken.has(next)) return next;
  }
  return "";
}
