import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { formatMinor } from "../../../features/invoices/money";
import { getDb, invoices } from "../../db/client";
import {
  askForJson,
  ClaudeNotConfiguredError,
  ClaudeShapeError,
  type Completion,
  claudeConfigured,
} from "../../lib/claude";
import { unknownNumbers } from "./reporter.agent";

// The Collector: the seat that writes the awkward letter. Two things are
// not the model's to decide — whether to write at all, and what the amount
// is. Both are settled here, in code, before a prompt is built:
//
//   `stopReason()` is the whole of "knows when to stop", and it is pure;
//   every figure the letter may contain is handed over and checked after,
//   with the Reporter's own check, so an invented total is a thrown-away
//   draft rather than a letter to a client.
//
// And it never sends. The owner does.

/** The most times a client is asked before this stops being a letter. */
export const MAX_ASKS = 3;
/** How long to leave someone alone between letters. */
export const QUIET_DAYS = 7;

export type Chaseable = {
  invoiceId: string;
  number: string;
  clientName: string;
  clientEmail: string | null;
  currency: string;
  dueDate: string;
  dueMinor: string;
  daysOverdue: number;
  asked: number;
  lastAskedAt: string | null;
  /** null when a letter is due; otherwise why it is not. */
  stop: string | null;
};

const DAY = 86_400_000;

const daysBetween = (from: string, now: Date) =>
  Math.floor(
    (Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${from}T00:00:00Z`)) /
      DAY,
  );

/**
 * Whether to write at all. Pure, so it can be read and tested on its own —
 * this is the part of "knows when to stop" that must not be a prompt.
 */
export function stopReason(
  invoice: {
    status: string;
    dueDate: string;
    clientEmail: string | null;
    dueMinor: bigint;
    asked: number;
    lastAskedAt: Date | null;
  },
  now = new Date(),
): string | null {
  if (invoice.status !== "pending") return "This one is settled.";
  if (invoice.dueMinor <= 0n) return "Nothing is outstanding on it.";
  if (!invoice.clientEmail) return "There is no address to write to.";
  const overdue = daysBetween(invoice.dueDate, now);
  if (overdue <= 0) return "It is not overdue yet.";
  if (invoice.asked >= MAX_ASKS)
    return `They have been asked ${MAX_ASKS} times. This belongs with a person now, not another letter.`;
  if (invoice.lastAskedAt) {
    const since = Math.floor(
      (now.getTime() - invoice.lastAskedAt.getTime()) / DAY,
    );
    if (since < QUIET_DAYS)
      return `They were asked ${since === 0 ? "today" : `${since} day${since === 1 ? "" : "s"} ago`}; give it a week.`;
  }
  return null;
}

/** Every overdue invoice of this owner's, and whether a letter is due. */
export async function chaseable(
  owner: string,
  now = new Date(),
): Promise<Chaseable[]> {
  const rows = await getDb()
    .select()
    .from(invoices)
    .where(and(eq(invoices.owner, owner), eq(invoices.status, "pending")))
    .orderBy(desc(invoices.dueDate))
    .limit(50);

  return rows
    .map((row) => {
      const dueMinor = BigInt(row.totalMinor) - BigInt(row.paidMinor);
      return {
        invoiceId: row.id,
        number: row.number,
        clientName: row.clientName,
        clientEmail: row.clientEmail,
        currency: row.currency,
        dueDate: row.dueDate,
        dueMinor: dueMinor.toString(),
        daysOverdue: daysBetween(row.dueDate, now),
        asked: row.remindersSent,
        lastAskedAt: row.reminderSentAt?.toISOString() ?? null,
        stop: stopReason(
          {
            status: row.status,
            dueDate: row.dueDate,
            clientEmail: row.clientEmail,
            dueMinor,
            asked: row.remindersSent,
            lastAskedAt: row.reminderSentAt,
          },
          now,
        ),
      };
    })
    .filter((row) => row.daysOverdue > 0);
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: {
      type: "string",
      maxLength: 120,
      description: "An email subject line. No invoice jargon.",
    },
    body: {
      type: "string",
      maxLength: 900,
      description:
        "The whole message, plain text, 3 short paragraphs at most. Use only figures given.",
    },
  },
} as const;

const reply = z
  .object({
    subject: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(900),
  })
  .strict();

const SYSTEM = `You are the Collector at Payus. You write the follow-up
letter for an invoice that has gone quiet, for the owner of the account to
send under their own name.

You do not decide whether to write; that has already been decided. You do
not decide the amount, the date, or the terms. Every figure you may use is
given to you, and using any other number is treated as an error and your
draft is thrown away.

Write it the way one working person writes to another: short, warm, and
specific. Say what is owed and when it was due, give the link, and make it
easy to reply if something is wrong. No guilt, no legal threats, no
"kindly", no invoice jargon. First letter: assume it was missed. Second:
assume it was missed again, and ask directly. Third: say plainly that this
is the last letter and you would rather talk.

Plain text. No markdown, no headings, no signature block — the owner adds
their own.`;

export type CollectorDraft = {
  invoiceId: string;
  subject: string;
  body: string;
  figures: Record<string, string>;
  model: string;
};

export class NothingToChaseError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NothingToChaseError";
  }
}

export function collectorPrompt(
  owner: string,
  invoice: Chaseable,
  link: string,
  figures: Record<string, string>,
): string {
  return [
    `You are writing as @${owner}.`,
    `To: ${invoice.clientName}`,
    `This is letter number ${invoice.asked + 1}.`,
    "",
    "The only figures you may use:",
    ...Object.entries(figures).map(([label, value]) => `  ${label}: ${value}`),
    "",
    `The link to pay, which you must include exactly: ${link}`,
    "",
    "Write the letter.",
  ].join("\n");
}

export async function runCollector(
  owner: string,
  invoiceId: string,
  options: { ask?: typeof askForJson; now?: Date; appUrl?: string } = {},
): Promise<CollectorDraft> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();
  const now = options.now ?? new Date();

  const [row] = await getDb()
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.owner, owner)))
    .limit(1);
  if (!row) throw new NothingToChaseError("No such invoice.");

  const dueMinor = BigInt(row.totalMinor) - BigInt(row.paidMinor);
  const stop = stopReason(
    {
      status: row.status,
      dueDate: row.dueDate,
      clientEmail: row.clientEmail,
      dueMinor,
      asked: row.remindersSent,
      lastAskedAt: row.reminderSentAt,
    },
    now,
  );
  if (stop) throw new NothingToChaseError(stop);

  const overdue = daysBetween(row.dueDate, now);
  const link = `${(options.appUrl ?? "").replace(/\/$/, "")}/i/${row.token}`;
  const figures: Record<string, string> = {
    "invoice number": row.number,
    "amount still owed": formatMinor(dueMinor, row.currency),
    "invoice total": formatMinor(BigInt(row.totalMinor), row.currency),
    "due date": row.dueDate,
    "days overdue": String(overdue),
  };
  if (BigInt(row.paidMinor) > 0n)
    figures["already paid"] = formatMinor(BigInt(row.paidMinor), row.currency);

  const invoice: Chaseable = {
    invoiceId: row.id,
    number: row.number,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    currency: row.currency,
    dueDate: row.dueDate,
    dueMinor: dueMinor.toString(),
    daysOverdue: overdue,
    asked: row.remindersSent,
    lastAskedAt: row.reminderSentAt?.toISOString() ?? null,
    stop: null,
  };

  const completion: Completion = await ask({
    system: SYSTEM,
    prompt: collectorPrompt(owner, invoice, link, figures),
    schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });

  const parsed = reply.safeParse(completion.json);
  if (!parsed.success)
    throw new ClaudeShapeError(
      "The Collector answered in a shape with no letter in it.",
    );

  // The link carries digits of its own, and they are not claims about money.
  const prose = `${parsed.data.subject}\n${parsed.data.body}`.replaceAll(
    link,
    " ",
  );
  const invented = unknownNumbers(prose, figures);
  if (invented.length > 0)
    throw new ClaudeShapeError(
      `The Collector used figures it was not given (${invented.join(", ")}), so the draft was thrown away.`,
    );
  if (!parsed.data.body.includes(link))
    throw new ClaudeShapeError(
      "The Collector left out the link to pay, so the draft was thrown away.",
    );

  return {
    invoiceId: row.id,
    subject: parsed.data.subject,
    body: parsed.data.body,
    figures,
    model: `${completion.model}@${completion.promptVersion}`,
  };
}
