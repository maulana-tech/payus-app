import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { listInvoices } from "../invoices/invoices.service";
import { recentPayments } from "../payments/payments.service";
import { requireUsername } from "../profiles/profiles.service";
import { balances, entriesFor } from "./ledger.service";

// What the overview screen shows. Every number here is read from the
// ledger or from the invoices themselves — nothing is cached or guessed.

export const ledgerRouter = createTRPCRouter({
  /** Every posting of this account, for the transactions grid. */
  entries: protectedProcedure.query(async ({ ctx }) =>
    entriesFor(await requireUsername(ctx.privyUserId)),
  ),
  summary: protectedProcedure.query(async ({ ctx }) => {
    const owner = await requireUsername(ctx.privyUserId);
    const [accounts, invoices, payments] = await Promise.all([
      balances(owner),
      listInvoices(owner),
      recentPayments(owner),
    ]);

    let outstandingMinor = 0n;
    let overdue = 0;
    let paidMinor = 0n;
    const today = new Date().toISOString().slice(0, 10);
    for (const invoice of invoices) {
      if (invoice.status === "pending") {
        outstandingMinor +=
          BigInt(invoice.totalMinor) - BigInt(invoice.paidMinor);
        if (invoice.dueDate < today) overdue += 1;
      }
      if (invoice.status === "paid") paidMinor += BigInt(invoice.paidMinor);
    }

    return {
      accounts,
      payments,
      invoices: {
        total: invoices.length,
        pending: invoices.filter((i) => i.status === "pending").length,
        overdue,
        outstandingMinor: outstandingMinor.toString(),
        paidMinor: paidMinor.toString(),
      },
      recentInvoices: invoices.slice(0, 5),
    };
  }),
});
