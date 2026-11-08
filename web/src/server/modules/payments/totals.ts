import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb, payments, refunds } from "@/server/db/client";

// What an invoice has actually been paid, in one place.
//
// It lives here rather than beside either writer because both of them need
// both halves: a capture has to know what was given back, and a refund has
// to know what was taken. Keeping one in `payments.service` and the other
// in `refunds.service` meant the capture path could only reach half of the
// answer without importing its own importer — and so it used the half it
// had. Captured 1000, refunded 200, captured 200 again reported 1200.

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
 * What the invoice should say it has been paid: the absolute figure, never
 * a delta, so re-running a job cannot double-count — and never below zero,
 * because an invoice that was refunded more than it was paid is owed in
 * full, not owed a negative amount.
 */
export async function settledForInvoice(invoiceId: string): Promise<bigint> {
  const [captured, refunded] = await Promise.all([
    capturedTotal(invoiceId),
    refundedForInvoice(invoiceId),
  ]);
  const net = captured - refunded;
  return net > 0n ? net : 0n;
}
