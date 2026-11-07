import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  invoiceId,
  invoiceInput,
  invoiceToken,
  invoiceUpdateInput,
} from "../../../features/invoices/input";
import { toMinor } from "../../../features/invoices/money";
import { MAX_UPLOAD_CHARS } from "../../../features/uploads/table";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { applyInvoicePayment } from "../payments/applyPayment";
import {
  listRefundsForInvoice,
  RefundRefusedError,
  refundablePayments,
  startRefund,
} from "../payments/refunds.service";
import { requireUsername } from "../profiles/profiles.service";
import { readImport } from "./import.service";
import {
  InvoiceClosedError,
  InvoiceLockedError,
  InvoiceNotFoundError,
  InvoiceNumberTakenError,
} from "./invoices.errors";
import {
  createInvoice,
  listInvoices,
  publicInvoice,
  stopRecurring,
  updateInvoice,
  voidInvoice,
} from "./invoices.service";

function mapError(e: unknown): never {
  if (
    e instanceof InvoiceNumberTakenError ||
    e instanceof InvoiceClosedError ||
    e instanceof InvoiceLockedError
  )
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  if (e instanceof InvoiceNotFoundError)
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  if (e instanceof RefundRefusedError)
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  throw e;
}

export const invoicesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(invoiceInput)
    .mutation(async ({ ctx, input }) =>
      createInvoice(await requireUsername(ctx.privyUserId), input).catch(
        mapError,
      ),
    ),
  /**
   * What a spreadsheet would become, without becoming it. Nothing is
   * written here — an importer that writes first and reports afterwards
   * leaves work that is harder to undo than it was to do.
   */
  previewImport: protectedProcedure
    .input(
      z
        .object({
          csv: z.string().min(1).max(MAX_UPLOAD_CHARS),
          defaultDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .strict(),
    )
    .query(({ input }) => readImport(input.csv, input.defaultDueDate)),

  /**
   * Creates the rows that passed. The file is read again here rather than
   * trusting a list the browser sends back: the preview is for the person,
   * not a contract with the server.
   */
  commitImport: protectedProcedure
    .input(
      z
        .object({
          csv: z.string().min(1).max(MAX_UPLOAD_CHARS),
          defaultDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await requireUsername(ctx.privyUserId);
      const preview = readImport(input.csv, input.defaultDueDate);
      const results: {
        row: number;
        number: string;
        outcome: "created" | "already here" | "refused";
        detail?: string;
      }[] = [];

      for (const candidate of preview.rows) {
        if (!candidate.ok) continue;
        const parsed = invoiceInput.safeParse(candidate.draft);
        if (!parsed.success) continue;
        try {
          await createInvoice(owner, parsed.data);
          results.push({
            row: candidate.row,
            number: parsed.data.number,
            outcome: "created",
          });
        } catch (error) {
          // Re-importing the same file finds the numbers taken, which is
          // the idempotency: it reports rather than duplicates.
          results.push({
            row: candidate.row,
            number: parsed.data.number,
            outcome:
              error instanceof InvoiceNumberTakenError
                ? "already here"
                : "refused",
            detail:
              error instanceof InvoiceNumberTakenError
                ? undefined
                : error instanceof Error
                  ? error.message
                  : undefined,
          });
        }
      }
      return { results };
    }),

  update: protectedProcedure
    .input(invoiceUpdateInput)
    .mutation(async ({ ctx, input }) =>
      updateInvoice(
        await requireUsername(ctx.privyUserId),
        input.id,
        input.invoice,
        input.keepClientEmail,
      ).catch(mapError),
    ),
  list: protectedProcedure.query(async ({ ctx }) =>
    listInvoices(await requireUsername(ctx.privyUserId)),
  ),
  void: protectedProcedure
    .input(z.object({ id: invoiceId }).strict())
    .mutation(async ({ ctx, input }) =>
      voidInvoice(await requireUsername(ctx.privyUserId), input.id).catch(
        mapError,
      ),
    ),
  stopRecurring: protectedProcedure
    .input(z.object({ id: invoiceId }).strict())
    .mutation(async ({ ctx, input }) =>
      stopRecurring(await requireUsername(ctx.privyUserId), input.id).catch(
        mapError,
      ),
    ),
  reportPayment: protectedProcedure
    .input(
      z
        .object({
          id: invoiceId,
          paidMinor: z.string().regex(/^\d{1,17}$/),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await requireUsername(ctx.privyUserId);
      // The owner marking an invoice paid by hand goes down the same path as
      // a captured payment, so the merchant webhook and the emails are
      // identical either way.
      const result = await applyInvoicePayment(
        owner,
        input.id,
        input.paidMinor,
        {
          privyUserId: ctx.privyUserId,
        },
      ).catch(mapError);
      return result.invoice;
    }),
  /** What was taken against this invoice, and what is still refundable. */
  refundable: protectedProcedure
    .input(z.object({ id: invoiceId }).strict())
    .query(async ({ ctx, input }) => {
      const owner = await requireUsername(ctx.privyUserId);
      return {
        payments: await refundablePayments(owner, input.id),
        refunds: await listRefundsForInvoice(owner, input.id),
      };
    }),

  /**
   * Gives money back. The owner's own action: the Guardian guards what the
   * agents propose, not what the person whose money it is decides.
   */
  refund: protectedProcedure
    .input(
      z
        .object({
          paymentId: z.string().min(8).max(32),
          /** Leave out for everything still refundable on that payment. */
          amount: z
            .string()
            .regex(/^\d{1,12}(\.\d{1,2})?$/)
            .optional(),
          reason: z.string().trim().max(200).optional(),
          /** Held by the form for one attempt, so a retry cannot pay twice. */
          intentKey: z.string().min(8).max(64),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) =>
      startRefund(await requireUsername(ctx.privyUserId), {
        paymentId: input.paymentId,
        amountMinor: input.amount ? toMinor(input.amount) : undefined,
        reason: input.reason,
        intentKey: input.intentKey,
      }).catch(mapError),
    ),

  public: publicProcedure
    .input(z.object({ token: invoiceToken }).strict())
    .query(({ input }) => publicInvoice(input.token)),
});
