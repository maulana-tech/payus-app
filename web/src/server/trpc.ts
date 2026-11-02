import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  // A real session must carry both the id and the verified claim. A
  // development demo session has only the id, and says so.
  if (!ctx.privyUserId || !(ctx.privyClaim || ctx.demo)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ctx.authError
        ? "Your Privy session is invalid or expired."
        : "Sign in with Privy to continue.",
    });
  }
  return next({
    ctx: {
      ...ctx,
      privyUserId: ctx.privyUserId,
      privyClaim: ctx.privyClaim,
    },
  });
});
