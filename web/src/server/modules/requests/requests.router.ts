import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { notifyRequestReceived } from "../notifications/notifications.service";
import { requireUsername } from "../profiles/profiles.service";
import {
  RequestClosedError,
  RequestNotFoundError,
  RequestRecipientError,
} from "./requests.errors";
import {
  createRequestInput,
  markPaidInput,
  requestIdInput,
  requestOutput,
} from "./requests.schema";
import {
  cancelRequest,
  createRequest,
  declineRequest,
  listRequests,
  markRequestPaid,
  pendingIncomingCount,
} from "./requests.service";

function mapError(e: unknown): never {
  if (e instanceof RequestRecipientError)
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  if (e instanceof RequestNotFoundError)
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  if (e instanceof RequestClosedError)
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  throw e;
}

export const requestsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createRequestInput)
    .output(requestOutput)
    .mutation(async ({ ctx, input }) => {
      const me = await requireUsername(ctx.privyUserId);
      if (!rateLimit(`requests:create:${me}`, 30, 60 * 60_000).ok)
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      const created = await createRequest(me, input).catch(mapError);
      void notifyRequestReceived(input.to, me, created.id).catch(() => {});
      return created;
    }),
  list: protectedProcedure
    .input(z.object({ direction: z.enum(["incoming", "outgoing"]) }).strict())
    .output(requestOutput.array())
    .query(async ({ ctx, input }) =>
      listRequests(await requireUsername(ctx.privyUserId), input.direction),
    ),
  pendingCount: protectedProcedure
    .output(z.number())
    .query(async ({ ctx }) =>
      pendingIncomingCount(await requireUsername(ctx.privyUserId)),
    ),
  markPaid: protectedProcedure
    .input(markPaidInput)
    .output(requestOutput)
    .mutation(async ({ ctx, input }) =>
      markRequestPaid(await requireUsername(ctx.privyUserId), input).catch(
        mapError,
      ),
    ),
  decline: protectedProcedure
    .input(requestIdInput)
    .output(requestOutput)
    .mutation(async ({ ctx, input }) =>
      declineRequest(await requireUsername(ctx.privyUserId), input.id).catch(
        mapError,
      ),
    ),
  cancel: protectedProcedure
    .input(requestIdInput)
    .output(requestOutput)
    .mutation(async ({ ctx, input }) =>
      cancelRequest(await requireUsername(ctx.privyUserId), input.id).catch(
        mapError,
      ),
    ),
});
