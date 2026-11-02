import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DEFAULT_CURRENCY, toMinor } from "../../../features/invoices/money";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { mapGuardianError } from "../guardian/guardian.router";
import { proposePayout } from "../guardian/guardian.service";
import { listInvoices } from "../invoices/invoices.service";
import { recentPayments } from "../payments/payments.service";
import {
  listPayouts,
  PayoutRefusedError,
  payableMinor,
} from "../payments/payouts.service";
import { requireUsername } from "../profiles/profiles.service";
import { balances, entriesFor } from "./ledger.service";
import { createRule, listRules, planSplit, updateRule } from "./split.service";

// What the money screens read and write. Every number here comes from the
// ledger or from the invoices themselves — nothing is cached or guessed.

const target = z
  .string()
  .regex(
    /^(platform_fee|tax_reserve|merchant_payable|pos:[a-z0-9][a-z0-9-]{0,40})$/,
    "Choose a pot, tax, the platform fee, or what is yours.",
  );

const ruleInput = z.object({
  name: z.string().trim().min(1).max(40),
  target,
  kind: z.enum(["percent", "fixed"]),
  /** Basis points for a percent, minor units for a fixed cut. */
  value: z.string().regex(/^\d{1,15}$/),
  priority: z.number().int().min(0).max(99),
});

const owner = (ctx: { privyUserId: string }) =>
  requireUsername(ctx.privyUserId);

function mapError(e: unknown): never {
  if (e instanceof PayoutRefusedError)
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  if (
    e instanceof Error &&
    /not somewhere money can go|usable pot/.test(e.message)
  )
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  throw e;
}

export const ledgerRouter = createTRPCRouter({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const me = await owner(ctx);
    const [accounts, invoices, payments, payable, rules] = await Promise.all([
      balances(me),
      listInvoices(me),
      recentPayments(me),
      payableMinor(me),
      listRules(me),
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
      payableMinor: payable.toString(),
      rules: rules.map((rule) => ({ ...rule, value: rule.value.toString() })),
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

  /** Every posting of this account, for the transactions grid. */
  entries: protectedProcedure.query(async ({ ctx }) =>
    entriesFor(await owner(ctx)),
  ),

  /** What the rules would do with an amount, without writing anything. */
  previewSplit: protectedProcedure
    .input(z.object({ amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/) }))
    .query(async ({ ctx, input }) => {
      const allocations = await planSplit(
        await owner(ctx),
        toMinor(input.amount),
      );
      return allocations.map((allocation) => ({
        ...allocation,
        amountMinor: allocation.amountMinor.toString(),
      }));
    }),

  createRule: protectedProcedure
    .input(ruleInput)
    .mutation(async ({ ctx, input }) => {
      const rule = await createRule(await owner(ctx), input).catch(mapError);
      return { ...rule, value: rule.value.toString() };
    }),

  updateRule: protectedProcedure
    .input(
      ruleInput.partial().extend({
        id: z.string().min(8).max(24),
        state: z.enum(["active", "archived"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const rule = await updateRule(await owner(ctx), id, patch).catch(
        mapError,
      );
      return { ...rule, value: rule.value.toString() };
    }),

  payouts: protectedProcedure.query(async ({ ctx }) =>
    listPayouts(await owner(ctx)),
  ),

  /**
   * Asks to send what is owed. This writes a proposal and lets the Guardian
   * decide it — the owner's own button takes the same road the agents will.
   */
  release: protectedProcedure
    .input(
      z.object({
        amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
        destination: z.string().trim().email().max(200),
        /** Held by the form for one attempt, so a retry cannot pay twice. */
        intentKey: z.string().min(8).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      proposePayout({
        owner: await owner(ctx),
        payload: {
          amountMinor: toMinor(input.amount).toString(),
          currency: DEFAULT_CURRENCY,
          destination: input.destination,
          intentKey: input.intentKey,
        },
        proposedBy: "owner",
      }).catch(mapGuardianError),
    ),
});
