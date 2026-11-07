import "server-only";
import { z } from "zod";
import { invoiceStatus } from "../../../features/invoices/input";
import { formatMinor } from "../../../features/invoices/money";
import {
  askForJson,
  ClaudeNotConfiguredError,
  ClaudeShapeError,
  type Completion,
  claudeConfigured,
} from "../../lib/claude";
import { listInvoices } from "../invoices/invoices.service";
import { balances } from "../ledger/ledger.service";
import { recentPayments } from "../payments/payments.service";
import { listPayouts } from "../payments/payouts.service";
import { listRefunds } from "../payments/refunds.service";
import { unknownNumbers } from "./reporter.agent";

// The Advisor: the seat that answers questions. It has no write access of
// any kind, and — the part that matters — it does not write the query
// either. It picks one from a fixed list below and names its arguments; we
// run it, scoped to the owner, and hand back the rows.
//
// So the worst a bad answer can be is the wrong question asked of the right
// data. The answer is then held to the same rule as the Reporter's: every
// figure in it has to be one of the figures in those rows.

export type Row = Record<string, string>;

export type Question = {
  /** What the model chooses between. */
  name: string;
  /** Said in the model's terms, not ours. */
  about: string;
  run: (owner: string) => Promise<{ rows: Row[]; caption: string }>;
};

export const QUESTIONS: Question[] = [
  {
    name: "balances",
    about: "What is in each pot right now: tax set aside, yours, envelopes.",
    run: async (owner) => {
      const rows = await balances(owner);
      return {
        caption: "Every account with a balance",
        rows: rows.map((row) => ({
          account: row.account,
          kind: row.kind,
          balance: formatMinor(BigInt(row.balanceMinor)),
        })),
      };
    },
  },
  {
    name: "open_invoices",
    about:
      "Invoices not yet paid, with what is still owed and when it was due.",
    run: async (owner) => {
      const rows = (await listInvoices(owner)).filter(
        (invoice) => invoice.status === "pending",
      );
      return {
        caption: "Invoices still open",
        rows: rows.map((invoice) => ({
          invoice: invoice.number,
          client: invoice.clientName,
          due: invoice.dueDate,
          state: invoiceStatus(invoice.status, invoice.dueDate),
          owed: formatMinor(
            BigInt(invoice.totalMinor) - BigInt(invoice.paidMinor),
            invoice.currency,
          ),
          total: formatMinor(BigInt(invoice.totalMinor), invoice.currency),
        })),
      };
    },
  },
  {
    name: "paid_invoices",
    about: "Invoices already paid, with their totals.",
    run: async (owner) => {
      const rows = (await listInvoices(owner)).filter(
        (invoice) => invoice.status === "paid",
      );
      return {
        caption: "Invoices paid",
        rows: rows.map((invoice) => ({
          invoice: invoice.number,
          client: invoice.clientName,
          due: invoice.dueDate,
          total: formatMinor(BigInt(invoice.totalMinor), invoice.currency),
        })),
      };
    },
  },
  {
    name: "recent_payments",
    about: "Money that has come in: what was taken and what PayPal kept.",
    run: async (owner) => {
      const rows = await recentPayments(owner);
      return {
        caption: "Payments taken, newest first",
        rows: rows.map((payment) => ({
          when: payment.capturedAt.slice(0, 10),
          invoice: payment.invoiceNumber,
          client: payment.clientName,
          taken: formatMinor(BigInt(payment.capturedMinor), payment.currency),
          fee: formatMinor(BigInt(payment.feeMinor), payment.currency),
        })),
      };
    },
  },
  {
    name: "refunds",
    about: "Money given back, with the reason where there is one.",
    run: async (owner) => {
      const rows = await listRefunds(owner);
      return {
        caption: "Refunds",
        rows: rows.map((refund) => ({
          when: refund.createdAt.slice(0, 10),
          amount: formatMinor(BigInt(refund.amountMinor), refund.currency),
          state: refund.status,
          asked_by: refund.source,
          reason: refund.reason ?? "—",
        })),
      };
    },
  },
  {
    name: "payouts",
    about: "Money released to the merchant, and whether it really left.",
    run: async (owner) => {
      const rows = await listPayouts(owner);
      return {
        caption: "Payouts",
        rows: rows.map((payout) => ({
          when: payout.createdAt.slice(0, 10),
          amount: formatMinor(BigInt(payout.amountMinor), payout.currency),
          state: payout.status,
          to: payout.destination,
        })),
      };
    },
  },
];

const byName = new Map(QUESTIONS.map((question) => [question.name, question]));

const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["query", "why"],
  properties: {
    query: {
      type: "string",
      enum: QUESTIONS.map((question) => question.name),
      description: "The one query whose rows would answer the question.",
    },
    why: {
      type: "string",
      maxLength: 160,
      description: "One line: what you expect to find there.",
    },
  },
} as const;

const pick = z
  .object({
    query: z.enum(QUESTIONS.map((q) => q.name) as [string, ...string[]]),
    why: z.string().trim().max(160),
  })
  .strict();

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: {
      type: "string",
      maxLength: 600,
      description:
        "Two to four sentences answering the question from the rows given.",
    },
  },
} as const;

const answered = z
  .object({ answer: z.string().trim().min(1).max(600) })
  .strict();

const PICK_SYSTEM = `You are the Advisor at Payus. Someone has asked a
question about their own money. You cannot query anything yourself; you
choose one of the listed queries, and its rows are what you will be given.

Choose the one whose rows would actually settle the question. If none would,
choose the closest and say so in one line.`;

const ANSWER_SYSTEM = `You are the Advisor at Payus. Answer the question
from the rows you are given, in two to four plain sentences, in the second
person.

Every figure you may use is in those rows. Using any other number — even one
that seems to follow — is treated as an error and your answer is thrown
away; if you need a total that is not there, say what you can see instead
and leave the arithmetic to them.

Answer the question that was asked, including when the answer is bad news or
is "the rows do not say". No headings, no bullets, no greeting.`;

export type AdvisorAnswer = {
  question: string;
  query: string;
  /** The Advisor's own line on why that query would settle the question. */
  why: string;
  caption: string;
  rows: Row[];
  answer: string;
  model: string;
  /** The model that chose the query; the answer is a second, separate call. */
  pickedBy: string;
};

export async function runAdvisor(
  owner: string,
  question: string,
  options: { ask?: typeof askForJson } = {},
): Promise<AdvisorAnswer> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();

  const chosen: Completion = await ask({
    system: PICK_SYSTEM,
    prompt: [
      `The question: ${question}`,
      "",
      "The queries you may choose from:",
      ...QUESTIONS.map((q) => `  ${q.name}: ${q.about}`),
    ].join("\n"),
    schema: PICK_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });
  const parsedPick = pick.safeParse(chosen.json);
  if (!parsedPick.success)
    throw new ClaudeShapeError("The Advisor did not choose a query we have.");

  // The name came back inside an enum we wrote, so this cannot be anything
  // but one of ours — and nothing the model said is interpolated anywhere.
  const query = byName.get(parsedPick.data.query);
  if (!query)
    throw new ClaudeShapeError("The Advisor did not choose a query we have.");

  const { rows, caption } = await query.run(owner);

  const completion: Completion = await ask({
    system: ANSWER_SYSTEM,
    prompt: [
      `The question: ${question}`,
      "",
      `What you looked at: ${caption} (${rows.length} row${rows.length === 1 ? "" : "s"})`,
      rows.length === 0
        ? "  (there are none)"
        : rows
            .map(
              (row, index) =>
                `  ${index + 1}. ${Object.entries(row)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(", ")}`,
            )
            .join("\n"),
      "",
      "Answer the question.",
    ].join("\n"),
    schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });

  const parsed = answered.safeParse(completion.json);
  if (!parsed.success)
    throw new ClaudeShapeError("The Advisor answered in an unusable shape.");

  const invented = unknownNumbers(parsed.data.answer, figuresIn(rows));
  if (invented.length > 0)
    throw new ClaudeShapeError(
      `The Advisor used figures that are not in the rows (${invented.join(", ")}), so the answer was thrown away.`,
    );

  return {
    question,
    query: query.name,
    why: parsedPick.data.why,
    caption,
    rows,
    answer: parsed.data.answer,
    model: `${completion.model}@${completion.promptVersion}`,
    pickedBy: `${chosen.model}@${chosen.promptVersion}`,
  };
}

/**
 * Every value in the rows, as the allowed figures. The row count is allowed
 * too: "you have four open invoices" is a reading, not a calculation.
 */
export function figuresIn(rows: Row[]): Record<string, string> {
  const figures: Record<string, string> = { rows: String(rows.length) };
  rows.forEach((row, index) => {
    for (const [key, value] of Object.entries(row))
      figures[`${index}.${key}`] = value;
  });
  return figures;
}
