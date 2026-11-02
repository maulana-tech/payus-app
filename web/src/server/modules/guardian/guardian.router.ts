import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { requireUsername } from "../profiles/profiles.service";
import {
  ApprovalVoidError,
  ProposalClosedError,
  ProposalNotFoundError,
  ProposalRefusedError,
} from "./guardian.errors";
import {
  amendProposal,
  approveProposal,
  auditTrail,
  policyFor,
  recentProposals,
  refuseProposal,
  savePolicy,
  waiting,
} from "./guardian.service";

const owner = (ctx: { privyUserId: string }) =>
  requireUsername(ctx.privyUserId);

const proposalId = z.string().min(8).max(24);
const minorAmount = z.string().regex(/^\d{1,15}$/);

export function mapGuardianError(e: unknown): never {
  if (e instanceof ProposalRefusedError)
    throw new TRPCError({ code: "FORBIDDEN", message: e.message });
  if (e instanceof ApprovalVoidError)
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  if (e instanceof ProposalClosedError)
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  if (e instanceof ProposalNotFoundError)
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  throw e;
}

export const guardianRouter = createTRPCRouter({
  /** The limits, what is waiting, and the record — in one call. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const me = await owner(ctx);
    const [policy, pending, recent, audit] = await Promise.all([
      policyFor(me),
      waiting(me),
      recentProposals(me),
      auditTrail(me),
    ]);
    return {
      policy: {
        perTransactionMinor: policy.perTransactionMinor.toString(),
        perDayMinor: policy.perDayMinor.toString(),
        approveAboveMinor: policy.approveAboveMinor.toString(),
        newRecipientNeedsApproval: policy.newRecipientNeedsApproval,
        expiryMinutes: policy.expiryMinutes,
      },
      pending,
      recent,
      audit,
    };
  }),

  savePolicy: protectedProcedure
    .input(
      z
        .object({
          perTransactionMinor: minorAmount.optional(),
          perDayMinor: minorAmount.optional(),
          approveAboveMinor: minorAmount.optional(),
          newRecipientNeedsApproval: z.boolean().optional(),
          expiryMinutes: z.number().int().min(5).max(1440).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const policy = await savePolicy(await owner(ctx), input);
      return {
        perTransactionMinor: policy.perTransactionMinor.toString(),
        perDayMinor: policy.perDayMinor.toString(),
        approveAboveMinor: policy.approveAboveMinor.toString(),
        newRecipientNeedsApproval: policy.newRecipientNeedsApproval,
        expiryMinutes: policy.expiryMinutes,
      };
    }),

  approve: protectedProcedure
    .input(z.object({ id: proposalId }).strict())
    .mutation(async ({ ctx, input }) =>
      approveProposal(await owner(ctx), input.id).catch(mapGuardianError),
    ),

  refuse: protectedProcedure
    .input(z.object({ id: proposalId }).strict())
    .mutation(async ({ ctx, input }) =>
      refuseProposal(await owner(ctx), input.id).catch(mapGuardianError),
    ),

  amend: protectedProcedure
    .input(
      z
        .object({
          id: proposalId,
          amountMinor: minorAmount,
          currency: z.string().length(3),
          destination: z.string().trim().email().max(200),
          intentKey: z.string().min(8).max(64),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...payload } = input;
      return amendProposal(await owner(ctx), id, payload).catch(
        mapGuardianError,
      );
    }),
});
