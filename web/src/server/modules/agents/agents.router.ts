import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MAX_UPLOAD_CHARS,
  parseTable,
  type Table,
  TableError,
} from "@/features/uploads/table";
import {
  ClaudeAccessError,
  ClaudeNotConfiguredError,
  ClaudeRefusedError,
  ClaudeShapeError,
  claudeConfigured,
} from "../../lib/claude";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { mapGuardianError } from "../guardian/guardian.router";
import {
  invoiceClientEmail,
  listInvoices,
  markChased,
} from "../invoices/invoices.service";
import { emailCollectorLetter } from "../notifications/notifications.service";
import { appOrigin } from "../payments/applyPayment";
import { requireUsername } from "../profiles/profiles.service";
import { runAdvisor, runAdvisorOnTable } from "./advisor.agent";
import { runAllocator } from "./allocator.agent";
import { runBuilder } from "./builder.agent";
import {
  chaseable,
  NothingToChaseError,
  runCollector,
} from "./collector.agent";
import {
  advisorHistory,
  forgetAdvisorHistory,
  recordAdvisorTurn,
} from "./history.service";
import { runPayer } from "./payer.agent";
import { runReporter } from "./reporter.agent";

// The agents' door. Each one writes a proposal and stops; what happens next
// is the Guardian's decision, so these procedures return a proposal, never a
// payment.

function mapError(e: unknown): never {
  if (e instanceof NothingToChaseError)
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  if (e instanceof ClaudeNotConfiguredError)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The agents are switched off on this deployment: no Claude API key is set.",
    });
  if (e instanceof ClaudeAccessError)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
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

  /** Asks the Reporter to say what has happened, in a few sentences. */
  runReporter: protectedProcedure.mutation(async ({ ctx }) =>
    runReporter(await requireUsername(ctx.privyUserId)).catch(mapError),
  ),

  /**
   * The overdue invoices, each with the reason a letter is not due where
   * there is one. Deciding that is code's job, not the Collector's.
   */
  chaseable: protectedProcedure.query(async ({ ctx }) =>
    chaseable(await requireUsername(ctx.privyUserId)),
  ),

  /** Asks the Collector for the next letter. It drafts; you send. */
  runCollector: protectedProcedure
    .input(z.object({ invoiceId: z.string().min(8).max(24) }).strict())
    .mutation(async ({ ctx, input }) =>
      runCollector(await requireUsername(ctx.privyUserId), input.invoiceId, {
        appUrl: appOrigin(),
      }).catch(mapError),
    ),

  /**
   * Sends a letter the owner has read. The text is whatever is in the box
   * by then — theirs to edit — and the count of how often this client has
   * been asked goes up here, which is what the Collector stops on.
   */
  sendChase: protectedProcedure
    .input(
      z
        .object({
          invoiceId: z.string().min(8).max(24),
          subject: z.string().trim().min(1).max(160),
          body: z.string().trim().min(1).max(2000),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await requireUsername(ctx.privyUserId);
      const invoice = (await listInvoices(owner)).find(
        (row) => row.id === input.invoiceId,
      );
      if (!invoice)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such invoice." });
      const clientEmail = await invoiceClientEmail(invoice.id);
      if (!clientEmail)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That invoice has no client address to write to.",
        });
      const sent = await emailCollectorLetter({
        invoice,
        clientEmail,
        subject: input.subject,
        body: input.body,
      });
      // Counted either way: the owner has decided this client was asked,
      // and the limit exists to protect the client, not the mailer.
      await markChased(owner, invoice.id);
      return { sent, to: clientEmail };
    }),

  /** Asks the Advisor a question; it picks one of our queries to answer it. */
  runAdvisor: protectedProcedure
    .input(z.object({ question: z.string().trim().min(3).max(300) }).strict())
    .mutation(async ({ ctx, input }) => {
      const owner = await requireUsername(ctx.privyUserId);
      const started = Date.now();
      const answer = await runAdvisor(owner, input.question).catch(mapError);
      // Recorded by the service that ran it, not by the seat itself. A
      // failure to keep the transcript must not lose the answer.
      await recordAdvisorTurn(owner, answer, Date.now() - started, "app").catch(
        (error: unknown) => {
          console.error("[advisor] could not keep the turn:", error);
        },
      );
      return answer;
    }),

  /**
   * The same seat, reading a table the owner pasted or uploaded. There is no
   * query to pick, so the rows are the file's — and the figures check runs
   * against those, which is why the answer is labelled with where it looked.
   */
  askAboutTable: protectedProcedure
    .input(
      z
        .object({
          question: z.string().trim().min(3).max(300),
          name: z.string().trim().min(1).max(120),
          csv: z.string().min(1).max(MAX_UPLOAD_CHARS),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const owner = await requireUsername(ctx.privyUserId);
      let table: Table;
      try {
        table = parseTable(input.csv);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof TableError
              ? error.message
              : "That file could not be read as a table.",
        });
      }
      const started = Date.now();
      const answer = await runAdvisorOnTable(input.question, {
        name: input.name,
        rows: table.rows,
      }).catch(mapError);
      await recordAdvisorTurn(owner, answer, Date.now() - started, "app").catch(
        (error: unknown) => {
          console.error("[advisor] could not keep the turn:", error);
        },
      );
      return answer;
    }),

  /** The transcript, so a refresh does not throw the conversation away. */
  advisorHistory: protectedProcedure.query(async ({ ctx }) =>
    advisorHistory(await requireUsername(ctx.privyUserId)),
  ),

  forgetAdvisorHistory: protectedProcedure.mutation(async ({ ctx }) => {
    await forgetAdvisorHistory(await requireUsername(ctx.privyUserId));
    return { ok: true };
  }),

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
