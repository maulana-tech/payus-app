import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getServerEnv } from "../../../env.server";
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
import { toCheckout } from "../developer/checkouts";
import { deliverEvent } from "../developer/developer.service";
import {
  emailInvoiceClient,
  notifyInvoicePaid,
} from "../notifications/notifications.service";
import { requireUsername } from "../profiles/profiles.service";
import {
  InvoiceClosedError,
  InvoiceLockedError,
  InvoiceNotFoundError,
  InvoiceNumberTakenError,
} from "./invoices.errors";
import {
  createInvoice,
  invoiceClientEmail,
  listInvoices,
  publicInvoice,
  reportPayment,
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
      const result = await reportPayment(owner, input).catch(mapError);
      if (result.becamePaid) {
        void notifyInvoicePaid(ctx.privyUserId, result.invoice).catch(() => {});
        // Signed webhook to the merchant's server, if they set one up.
        void deliverEvent(
          owner,
          result.invoice.source === "api" ? "checkout.paid" : "invoice.paid",
          toCheckout(
            result.invoice,
            (getServerEnv().APP_URL || "http://localhost:3000").replace(
              /\/$/,
              "",
            ),
          ),
        ).catch(() => {});
        void invoiceClientEmail(input.id)
          .then((email) =>
            email ? emailInvoiceClient(result.invoice, email) : undefined,
          )
          .catch(() => {});
      }
      return result.invoice;
    }),
  public: publicProcedure
    .input(z.object({ token: invoiceToken }).strict())
    .query(({ input }) => publicInvoice(input.token)),
});
