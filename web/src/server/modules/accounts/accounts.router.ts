import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  EscrowMissingError,
  EscrowRevisionConflictError,
  RecoveryAlreadySetError,
} from "./accounts.errors";
import {
  accountTypeOutput,
  escrowInput,
  escrowOutput,
  meOutput,
  passkeyInput,
  rotateEscrowInput,
  setAccountTypeInput,
} from "./accounts.schema";
import {
  getEscrow,
  me,
  rotateEscrow,
  saveEscrow,
  savePasskey,
  setAccountType,
} from "./accounts.service";

function mapError(error: unknown): never {
  if (
    error instanceof RecoveryAlreadySetError ||
    error instanceof EscrowRevisionConflictError
  )
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  if (error instanceof EscrowMissingError)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  throw error;
}

const privyEmail = (claim: unknown) => {
  const email = (claim as { email?: unknown } | null)?.email;
  return typeof email === "string" ? email : undefined;
};

export const accountsRouter = createTRPCRouter({
  me: protectedProcedure
    .output(meOutput)
    .query(({ ctx }) =>
      me(ctx.privyUserId, privyEmail(ctx.privyClaim)).catch(mapError),
    ),
  saveEscrow: protectedProcedure
    .input(escrowInput)
    .mutation(async ({ ctx, input }) => {
      await saveEscrow(ctx.privyUserId, input).catch(mapError);
      return { ok: true };
    }),
  getEscrow: protectedProcedure
    .output(escrowOutput)
    .query(({ ctx }) => getEscrow(ctx.privyUserId).catch(mapError)),
  rotateEscrow: protectedProcedure
    .input(rotateEscrowInput)
    .mutation(({ ctx, input }) =>
      rotateEscrow(ctx.privyUserId, input).catch(mapError),
    ),
  savePasskey: protectedProcedure
    .input(passkeyInput)
    .mutation(async ({ ctx, input }) => {
      await savePasskey(ctx.privyUserId, input).catch(mapError);
      return { ok: true };
    }),
  setAccountType: protectedProcedure
    .input(setAccountTypeInput)
    .output(accountTypeOutput)
    .mutation(({ ctx, input }) => setAccountType(ctx.privyUserId, input)),
});
