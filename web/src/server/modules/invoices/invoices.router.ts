import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  invoiceId,
  invoiceInput,
  invoiceToken,
  invoiceUpdateInput,
} from "../../../features/invoices/input";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { applyInvoicePayment } from "../payments/applyPayment";
import { requireUsername } from "../profiles/profiles.service";
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
  public: publicProcedure
    .input(z.object({ token: invoiceToken }).strict())
    .query(({ input }) => publicInvoice(input.token)),
});
