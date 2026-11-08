import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MAX_HTML,
  slugSchema,
  storefrontInput,
} from "../../../features/storefront/config";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { requireUsername } from "../profiles/profiles.service";
import { sanitizeShopHtml } from "./sanitize";
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

  /**
   * What a block of HTML will become. The editor previews through this so
   * the author sees the sanitised copy, not their draft — there is one
   * sanitiser and it lives on the server.
   */
  /**
   * The sanitiser, run for the editor so the preview is the server's answer
   * and not the browser's guess.
   *
   * A mutation, although it changes nothing. tRPC sends a query as GET with
   * its input encoded into the URL, and this input is a whole page: a
   * 38,000-character design became a 58,000-character URL and came back
   * **431 Request Header Fields Too Large**, so the preview silently
   * stopped updating. A mutation travels in the body, where a document
   * belongs.
   *
   * The alternative was `allowMethodOverride` on the server, which lets any
   * query arrive as POST. One procedure is not worth widening what this API
   * accepts for all of them.
   */
  previewHtml: protectedProcedure
    .input(z.object({ html: z.string().max(MAX_HTML) }).strict())
    .mutation(({ input }) => sanitizeShopHtml(input.html)),

  /** The public page, which only ever resolves a published storefront. */
  public: publicProcedure
    .input(z.object({ slug: slugSchema }).strict())
    .query(({ input }) => publishedStorefront(input.slug)),
});
