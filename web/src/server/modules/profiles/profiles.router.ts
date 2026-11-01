import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import {
  InvalidClaimError,
  ProfileExistsError,
  UsernameTakenError,
} from "./profiles.errors";
import {
  createProfileInput,
  publicProfileOutput,
  usernameInput,
} from "./profiles.schema";
import {
  createProfile,
  myProfile,
  profileByUsername,
  usernameAvailable,
} from "./profiles.service";

function mapError(error: unknown): never {
  if (
    error instanceof UsernameTakenError ||
    error instanceof ProfileExistsError
  )
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  if (error instanceof InvalidClaimError)
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw error;
}

export const profilesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createProfileInput)
    .output(publicProfileOutput)
    .mutation(({ ctx, input }) =>
      createProfile(ctx.privyUserId, input).catch(mapError),
    ),
  me: protectedProcedure
    .output(publicProfileOutput.nullable())
    .query(({ ctx }) => myProfile(ctx.privyUserId)),
  byUsername: publicProcedure
    .input(usernameInput)
    .output(publicProfileOutput.nullable())
    .query(({ input }) => profileByUsername(input.username)),
  available: publicProcedure
    .input(usernameInput)
    .output(z.object({ available: z.boolean() }))
    .query(async ({ ctx, input }) => {
      if (
        !rateLimit(`username-available:${ctx.ip ?? "unknown"}`, 60, 60_000).ok
      )
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      return { available: await usernameAvailable(input.username) };
    }),
});
