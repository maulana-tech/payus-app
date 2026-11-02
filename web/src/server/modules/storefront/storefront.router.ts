import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  slugSchema,
  storefrontInput,
} from "../../../features/storefront/config";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { requireUsername } from "../profiles/profiles.service";
import { SlugTakenError, StorefrontNotFoundError } from "./storefront.errors";
import {
  createStorefront,
  listStorefronts,
  publishedStorefront,
  setPublished,
  updateStorefront,
} from "./storefront.service";

const owner = (ctx: { privyUserId: string }) =>
  requireUsername(ctx.privyUserId);

const storefrontId = z.string().min(8).max(24);

function mapError(e: unknown): never {
  if (e instanceof SlugTakenError)
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  if (e instanceof StorefrontNotFoundError)
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  throw e;
}

export const storefrontRouter = createTRPCRouter({
  mine: protectedProcedure.query(async ({ ctx }) =>
    listStorefronts(await owner(ctx)),
  ),

  create: protectedProcedure
    .input(storefrontInput)
    .mutation(async ({ ctx, input }) =>
      createStorefront(await owner(ctx), input).catch(mapError),
    ),

  update: protectedProcedure
    .input(z.object({ id: storefrontId, config: storefrontInput }).strict())
    .mutation(async ({ ctx, input }) =>
      updateStorefront(await owner(ctx), input.id, input.config).catch(
        mapError,
      ),
    ),

  setPublished: protectedProcedure
    .input(z.object({ id: storefrontId, published: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) =>
      setPublished(await owner(ctx), input.id, input.published).catch(mapError),
    ),

  /** The public page, which only ever resolves a published storefront. */
  public: publicProcedure
    .input(z.object({ slug: slugSchema }).strict())
    .query(({ input }) => publishedStorefront(input.slug)),
});
