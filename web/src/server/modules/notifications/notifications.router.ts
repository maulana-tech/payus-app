import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getServerEnv } from "../../../env.server";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { usernameSchema } from "../profiles/profiles.schema";
import {
  disableByUnsubscribeToken,
  findSettings,
  upsertNotificationSettings,
} from "./notifications.repository";
import { notifyPaymentPing, sendTestEmail } from "./notifications.service";

const updateSettingsInput = z
  .object({
    email: z.string().trim(),
    enabled: z.boolean(),
    events: z.object({
      invoicePaid: z.boolean(),
      paymentPing: z.boolean(),
      requestReceived: z.boolean().default(true),
    }),
  })
  .superRefine((data, ctx) => {
    if (
      (data.enabled || data.email.length > 0) &&
      !z.string().email().safeParse(data.email).success
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid email",
        path: ["email"],
      });
  });

const limited = (key: string, limit: number, windowMs: number) => {
  if (!rateLimit(key, limit, windowMs).ok)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Try again shortly.",
    });
};

export const notificationsRouter = createTRPCRouter({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const settings = await findSettings(ctx.privyUserId);
    return {
      serviceAvailable: Boolean(getServerEnv().RESEND_API_KEY),
      settings: settings
        ? {
            email: settings.email,
            enabled: settings.enabled,
            events: settings.events,
          }
        : null,
    };
  }),

  updateSettings: protectedProcedure
    .input(updateSettingsInput)
    .mutation(({ ctx, input }) =>
      upsertNotificationSettings(
        ctx.privyUserId,
        input.email,
        input.enabled,
        input.events,
      ),
    ),

  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    limited(`notifications:test:${ctx.privyUserId}`, 3, 10 * 60_000);
    if (!(await sendTestEmail(ctx.privyUserId)))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Could not send a test email. Save your email first.",
      });
    return { success: true };
  }),

  /** Payer-side "I've paid" ping; carries no payment details. */
  paymentPing: publicProcedure
    .input(
      z
        .object({
          username: usernameSchema,
          nonce: z.string().regex(/^[0-9A-Za-z]{8,24}$/),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      limited(`notifications:ping:${ctx.ip ?? "unknown"}`, 10, 60 * 60_000);
      limited(`notifications:ping-to:${input.username}`, 20, 60 * 60_000);
      await notifyPaymentPing(input.username, input.nonce);
      return { ok: true };
    }),

  unsubscribe: publicProcedure
    .input(z.object({ token: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      limited(`notifications:unsubscribe:${ctx.ip ?? "unknown"}`, 30, 60_000);
      return { success: await disableByUnsubscribeToken(input.token) };
    }),
});
