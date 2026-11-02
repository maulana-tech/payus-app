import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ClaudeNotConfiguredError,
  ClaudeRefusedError,
  ClaudeShapeError,
  claudeConfigured,
} from "../../lib/claude";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { mapGuardianError } from "../guardian/guardian.router";
import { requireUsername } from "../profiles/profiles.service";
import { runAllocator } from "./allocator.agent";
import { runBuilder } from "./builder.agent";
import { runPayer } from "./payer.agent";

// The agents' door. Each one writes a proposal and stops; what happens next
// is the Guardian's decision, so these procedures return a proposal, never a
// payment.

function mapError(e: unknown): never {
  if (e instanceof ClaudeNotConfiguredError)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The agents are switched off on this deployment: no Claude API key is set.",
    });
  if (e instanceof ClaudeShapeError)
    throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
  if (e instanceof ClaudeRefusedError)
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Claude declined to answer this one.",
    });
  return mapGuardianError(e);
}

export const agentsRouter = createTRPCRouter({
  /** Whether a model is reachable, so the UI can say so plainly. */
  status: protectedProcedure.query(() => ({
    configured: claudeConfigured(),
  })),

  /** Asks the Payer whether anything should be released now. */
  runPayer: protectedProcedure.mutation(async ({ ctx }) =>
    runPayer(await requireUsername(ctx.privyUserId)).catch(mapError),
  ),

  /** Asks the Allocator whether the split should change. */
  runAllocator: protectedProcedure.mutation(async ({ ctx }) =>
    runAllocator(await requireUsername(ctx.privyUserId)).catch(mapError),
  ),

  /** Asks the Builder to write a storefront from a description, as a draft. */
  runBuilder: protectedProcedure
    .input(
      z.object({ description: z.string().trim().min(8).max(1200) }).strict(),
    )
    .mutation(async ({ ctx, input }) =>
      runBuilder(
        await requireUsername(ctx.privyUserId),
        input.description,
      ).catch(mapError),
    ),
});
