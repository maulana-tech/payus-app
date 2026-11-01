import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { requireUsername } from "../profiles/profiles.service";
import {
  PaymentLinkNotFoundError,
  PaymentLinkSlugUnavailableError,
} from "./paymentLinks.errors";
import {
  archiveLinkInput,
  createLinkInput,
  linkOutput,
  resolveLinkInput,
  updateLinkInput,
} from "./paymentLinks.schema";
import {
  createLink,
  listMyLinks,
  resolveLink,
  setLinkArchived,
  updateLink,
} from "./paymentLinks.service";

function mapError(e: unknown): never {
  if (e instanceof PaymentLinkSlugUnavailableError)
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  if (e instanceof PaymentLinkNotFoundError)
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  throw e;
}

export const paymentLinksRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createLinkInput)
    .output(linkOutput)
    .mutation(async ({ ctx, input }) =>
      createLink(await requireUsername(ctx.privyUserId), input).catch(mapError),
    ),
  mine: protectedProcedure
    .output(linkOutput.array())
    .query(async ({ ctx }) =>
      listMyLinks(await requireUsername(ctx.privyUserId)),
    ),
  update: protectedProcedure
    .input(updateLinkInput)
    .output(linkOutput)
    .mutation(async ({ ctx, input }) =>
      updateLink(await requireUsername(ctx.privyUserId), input).catch(mapError),
    ),
  setArchived: protectedProcedure
    .input(archiveLinkInput)
    .output(linkOutput)
    .mutation(async ({ ctx, input }) =>
      setLinkArchived(await requireUsername(ctx.privyUserId), input).catch(
        mapError,
      ),
    ),
  resolve: publicProcedure
    .input(resolveLinkInput)
    .output(linkOutput.nullable())
    .query(({ input }) => resolveLink(input)),
});
