import "server-only";
import { z } from "zod";
import { formatMinor } from "../../../features/invoices/money";
import { newId } from "../../../lib/ids";
import {
  askForJson,
  ClaudeNotConfiguredError,
  ClaudeShapeError,
  type Completion,
  claudeConfigured,
} from "../../lib/claude";
import {
  type ProposalView,
  proposeSplitChange,
} from "../guardian/guardian.service";
import { balances } from "../ledger/ledger.service";
import { listRules } from "../ledger/split.service";
import { recentPayments } from "../payments/payments.service";

// The Allocator: suggests how money arriving should be divided. Like every
// other seat that thinks, it writes a proposal and stops — the Guardian
// decides, and the limits it decides by live in one place, not here.

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["act", "reason"],
  properties: {
    act: { type: "string", enum: ["change", "none"] },
    rules: {
      type: "array",
      // No minItems/maxItems: Bedrock's schema validator rejects them. The
      // real bound is the zod schema below, which is what decides whether
      // an answer is acted on.
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "target", "percent"],
        properties: {
          name: { type: "string", maxLength: 40 },
          target: {
            type: "string",
            description:
              "tax_reserve, or pos:<name> for a pot, using lowercase and hyphens",
          },
          percent: {
            // No minimum/maximum either: Bedrock rejects numeric bounds in
            // a structured-output schema, so the range is said in words
            // here and enforced by zod below.
            type: "number",
            description:
              "Share of every payment, in percent, between 0.5 and 90.",
          },
        },
      },
    },
    reason: { type: "string", maxLength: 240 },
  },
} as const;

const target = z
  .string()
  .trim()
  .regex(
    /^(tax_reserve|pos:[a-z0-9][a-z0-9-]{0,40})$/,
    "A share goes to tax or to a pot.",
  );

const decision = z
  .object({
    act: z.enum(["change", "none"]),
    rules: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(40),
            target,
            percent: z.number().min(0.5).max(90),
          })
          .strict(),
      )
      .max(6)
      .optional(),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

const SYSTEM = `You are the Allocator at Payus: the seat that suggests how
money arriving should be divided before it is anyone's to spend.

You never move money and you never set limits. You propose one set of
shares; a deterministic Guardian checks it against the owner's limits and
either applies it, holds it for them, or refuses it.

Rules you must follow:
- Use only the figures you are given. Never estimate or carry one over.
- A share goes to tax, or to a pot named pos:<something>. You cannot touch
  the platform's own cut.
- Shares are percentages of every payment that arrives, not of what is left
  after the share above.
- Leave the owner the larger part. If what they have now is sensible, say so
  with act "none" rather than changing it for the sake of changing it.
- Your reason is read by the owner: one sentence, plainly, saying what
  changes and why.`;

export type AllocatorFacts = {
  owner: string;
  currentRules: { name: string; target: string; percent: number }[];
  recentIncomeMinor: bigint[];
  pots: { account: string; balanceMinor: string }[];
};

export async function allocatorFacts(owner: string): Promise<AllocatorFacts> {
  const [rules, payments, accounts] = await Promise.all([
    listRules(owner),
    recentPayments(owner),
    balances(owner),
  ]);
  return {
    owner,
    currentRules: rules
      .filter((rule) => rule.state === "active" && rule.kind === "percent")
      .map((rule) => ({
        name: rule.name,
        target: rule.target,
        percent: Number(rule.value) / 100,
      })),
    recentIncomeMinor: payments.map((payment) => BigInt(payment.capturedMinor)),
    pots: accounts
      .filter(
        (account) => account.kind === "pos" || account.kind === "tax_reserve",
      )
      .map((account) => ({
        account: account.account,
        balanceMinor: account.balanceMinor,
      })),
  };
}

export function allocatorPrompt(facts: AllocatorFacts): string {
  const income = facts.recentIncomeMinor;
  const total = income.reduce((sum, amount) => sum + amount, 0n);
  return [
    `Merchant: @${facts.owner}`,
    "",
    facts.currentRules.length === 0
      ? "They divide nothing today: every payment goes straight to them."
      : `Today they set aside:\n${facts.currentRules
          .map((rule) => `  ${rule.percent}% to ${rule.target} (${rule.name})`)
          .join("\n")}`,
    "",
    income.length === 0
      ? "No payments have arrived yet."
      : `Their last ${income.length} payments totalled ${formatMinor(total)}, the largest ${formatMinor(
          income.reduce((max, a) => (a > max ? a : max), 0n),
        )} and the smallest ${formatMinor(
          income.reduce((min, a) => (a < min ? a : min), income[0]),
        )}.`,
    "",
    facts.pots.length === 0
      ? "Nothing is set aside yet."
      : `Set aside so far:\n${facts.pots
          .map(
            (pot) =>
              `  ${pot.account}: ${formatMinor(BigInt(pot.balanceMinor))}`,
          )
          .join("\n")}`,
    "",
    "Should the split change?",
  ].join("\n");
}

export type AllocatorRun = {
  proposal: ProposalView | null;
  act: "change" | "none";
  reason: string;
  model: string;
};

export type Ask = typeof askForJson;

export async function runAllocator(
  owner: string,
  options: { ask?: Ask } = {},
): Promise<AllocatorRun> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();

  const facts = await allocatorFacts(owner);
  const completion: Completion = await ask({
    system: SYSTEM,
    prompt: allocatorPrompt(facts),
    schema: DECISION_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });

  const parsed = decision.safeParse(completion.json);
  if (!parsed.success)
    throw new ClaudeShapeError(
      `The Allocator answered in a shape this app will not act on: ${
        parsed.error.issues[0]?.message ?? "unknown"
      }`,
    );
  const answer = parsed.data;
  const model = `${completion.model}@${completion.promptVersion}`;

  if (answer.act === "none")
    return { proposal: null, act: "none", reason: answer.reason, model };

  if (!answer.rules || answer.rules.length === 0)
    throw new ClaudeShapeError(
      "The Allocator asked for a change without saying what it should be.",
    );

  const proposal = await proposeSplitChange({
    owner,
    rules: answer.rules.map((rule) => ({
      name: rule.name,
      target: rule.target,
      kind: "percent" as const,
      // Percent in, basis points stored — the engine works in whole units.
      value: String(Math.round(rule.percent * 100)),
    })),
    intentKey: `allocator-${newId(16)}`,
    proposedBy: "allocator-agent",
    model,
  });

  return { proposal, act: "change", reason: answer.reason, model };
}
