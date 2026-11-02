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
import { recentProposals } from "../guardian/guardian.service";
import { listInvoices } from "../invoices/invoices.service";
import { balances } from "../ledger/ledger.service";
import { recentPayments } from "../payments/payments.service";
import { payableMinor } from "../payments/payouts.service";

// The Reporter: the seat that explains, and the one that must not count.
// Every figure it is allowed to say is handed to it, and the check below
// refuses any number in its answer that was not among them — so a plausible
// invented figure is a rejected answer, not a published one.

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["report"],
  properties: {
    report: {
      type: "string",
      maxLength: 700,
      description:
        "Three to five sentences for the owner. Use only figures given.",
    },
  },
} as const;

const reply = z.object({ report: z.string().trim().min(1).max(700) }).strict();

const SYSTEM = `You are the Reporter at Payus. You tell the owner of an
account what has happened with their money, in a few plain sentences.

You do not calculate. Every figure you may use is given to you below, and
using any other number — even one that seems to follow from the others — is
treated as an error and your answer is thrown away. If a figure you want is
not there, describe it in words instead.

Write three to five sentences, in the second person, no headings, no
bullets, no greeting. Lead with what changed. Say plainly if something needs
attention; say plainly if nothing does.`;

export type ReporterFacts = {
  owner: string;
  /** Every figure the Reporter is permitted to state, as written. */
  figures: Record<string, string>;
  /** Short notes with no figures in them. */
  notes: string[];
};

export async function reporterFacts(owner: string): Promise<ReporterFacts> {
  const [accounts, invoices, payments, payable, proposals] = await Promise.all([
    balances(owner),
    listInvoices(owner),
    recentPayments(owner),
    payableMinor(owner),
    recentProposals(owner, 10),
  ]);

  const takenMinor = payments.reduce(
    (sum, payment) => sum + BigInt(payment.capturedMinor),
    0n,
  );
  const feesMinor = payments.reduce(
    (sum, payment) => sum + BigInt(payment.feeMinor),
    0n,
  );
  const open = invoices.filter((invoice) => invoice.status === "pending");
  const overdue = open.filter(
    (invoice) => invoiceStatus(invoice.status, invoice.dueDate) === "overdue",
  );
  const outstandingMinor = open.reduce(
    (sum, invoice) =>
      sum + BigInt(invoice.totalMinor) - BigInt(invoice.paidMinor),
    0n,
  );
  const setAside = accounts.filter(
    (account) => account.kind === "pos" || account.kind === "tax_reserve",
  );

  const figures: Record<string, string> = {
    "payments taken": String(payments.length),
    "total taken": formatMinor(takenMinor),
    "PayPal's fees": formatMinor(feesMinor),
    "owed to you now": formatMinor(payable),
    "open invoices": String(open.length),
    "overdue invoices": String(overdue.length),
    "still outstanding": formatMinor(outstandingMinor),
  };
  for (const account of setAside)
    figures[`set aside in ${account.account}`] = formatMinor(
      BigInt(account.balanceMinor),
    );

  const refused = proposals.filter((proposal) => proposal.status === "refused");
  const waiting = proposals.filter(
    (proposal) => proposal.status === "awaiting",
  );
  const notes: string[] = [];
  if (refused.length > 0)
    notes.push(`The Guardian refused something recently: ${refused[0].reason}`);
  if (waiting.length > 0)
    notes.push("Something is waiting for the owner to approve.");
  if (payments.length === 0) notes.push("No payment has arrived yet.");

  return { owner, figures, notes };
}

export function reporterPrompt(facts: ReporterFacts): string {
  return [
    `Account: @${facts.owner}`,
    "",
    "The only figures you may use:",
    ...Object.entries(facts.figures).map(
      ([label, value]) => `  ${label}: ${value}`,
    ),
    ...(facts.notes.length > 0
      ? ["", "Worth mentioning:", ...facts.notes.map((note) => `  ${note}`)]
      : []),
    "",
    "Write the report.",
  ].join("\n");
}

/** Number-shaped tokens: money, counts, percentages. */
const NUMBERS = /\$?\d[\d,]*(?:\.\d+)?%?/g;

const normalise = (token: string) =>
  token.replace(/[$,%]/g, "").replace(/\.00$/, "");

/**
 * Numbers in the report that were not among the figures it was given. A
 * non-empty result means the answer is thrown away: a figure the Reporter
 * worked out for itself is exactly what this seat is not allowed to do.
 */
export function unknownNumbers(
  report: string,
  figures: Record<string, string>,
): string[] {
  const allowed = new Set<string>();
  for (const value of Object.values(figures)) {
    allowed.add(normalise(value));
    // A figure may be read back without its cents, or spelled in full.
    for (const token of value.match(NUMBERS) ?? [])
      allowed.add(normalise(token));
  }
  const unknown: string[] = [];
  for (const token of report.match(NUMBERS) ?? []) {
    const value = normalise(token);
    // Ordinals and small counts in prose ("the first", "both") are not
    // claims about money; anything above nine has to have been given.
    if (allowed.has(value)) continue;
    if (/^\d$/.test(value)) continue;
    unknown.push(token);
  }
  return unknown;
}

export type ReporterRun = {
  report: string;
  figures: Record<string, string>;
  model: string;
};

export type Ask = typeof askForJson;

export async function runReporter(
  owner: string,
  options: { ask?: Ask } = {},
): Promise<ReporterRun> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();

  const facts = await reporterFacts(owner);
  const completion: Completion = await ask({
    system: SYSTEM,
    prompt: reporterPrompt(facts),
    schema: REPORT_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });

  const parsed = reply.safeParse(completion.json);
  if (!parsed.success)
    throw new ClaudeShapeError(
      "The Reporter answered in a shape with no report in it.",
    );

  const invented = unknownNumbers(parsed.data.report, facts.figures);
  if (invented.length > 0)
    throw new ClaudeShapeError(
      `The Reporter used figures it was not given (${invented.join(", ")}), so the report was thrown away.`,
    );

  return {
    report: parsed.data.report,
    figures: facts.figures,
    model: `${completion.model}@${completion.promptVersion}`,
  };
}
