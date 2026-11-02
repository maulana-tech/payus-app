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
  PROMPT_VERSION,
} from "../../lib/claude";
import {
  type ProposalView,
  policyFor,
  proposePayout,
} from "../guardian/guardian.service";
import { listPayouts, payableMinor } from "../payments/payouts.service";

// The Payer: the first seat at the table that thinks. It reads the books,
// writes down what it would like to happen, and stops. The Guardian decides
// whether it happens at all, which is why this file contains no limit of its
// own — duplicating them here would be a second, drifting source of truth.

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["act", "reason"],
  properties: {
    act: {
      type: "string",
      enum: ["payout", "none"],
      description: "payout to propose releasing money, none to do nothing",
    },
    amountMinor: {
      type: ["string", "null"],
      pattern: "^[0-9]{1,15}$",
      description: "Minor units (cents). Required when act is payout.",
    },
    destination: {
      type: ["string", "null"],
      description:
        "Must be copied exactly from the destinations listed in the facts.",
    },
    reason: {
      type: "string",
      maxLength: 240,
      description: "One sentence, addressed to the account's owner.",
    },
  },
} as const;

const decision = z
  .object({
    act: z.enum(["payout", "none"]),
    amountMinor: z
      .string()
      .regex(/^\d{1,15}$/)
      .nullable()
      .optional(),
    destination: z.string().trim().min(3).max(200).nullable().optional(),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

const SYSTEM = `You are the Payer at Payus: the seat that decides when money
owed to a merchant should be released to them.

You never move money. You write one proposal and stop. A deterministic
Guardian then checks it against limits the owner set, and either carries it
out, holds it for the owner to approve, or refuses it. Proposing something
outside the limits is not dangerous — it is simply refused and recorded — so
propose what you actually think is right.

Rules you must follow:
- Use only the numbers in the facts you are given. Never estimate, round, or
  carry a figure over from anything you remember.
- A destination must be copied exactly from the list of known destinations.
  If none is listed, you cannot propose a payout: answer with act "none".
- Amounts are integer minor units (cents) as a string: $12.50 is "1250".
- If there is nothing worth releasing, answer act "none" and say why in one
  plain sentence.
- Your reason is read by the owner. Write it as one sentence, no jargon, no
  restating the numbers they can already see.`;

export type PayerFacts = {
  owner: string;
  payableMinor: bigint;
  destinations: { address: string; lastPaidMinor: string; at: string }[];
  limits: {
    perPaymentMinor: bigint;
    perDayMinor: bigint;
    askAboveMinor: bigint;
  };
};

/** Everything the Payer is allowed to know, read fresh from the ledger. */
export async function payerFacts(owner: string): Promise<PayerFacts> {
  const [payable, sent, policy] = await Promise.all([
    payableMinor(owner),
    listPayouts(owner),
    policyFor(owner),
  ]);
  const seen = new Map<
    string,
    { address: string; lastPaidMinor: string; at: string }
  >();
  for (const payout of sent) {
    if (payout.status === "failed") continue;
    const key = payout.destination.toLowerCase();
    if (!seen.has(key))
      seen.set(key, {
        address: payout.destination,
        lastPaidMinor: payout.amountMinor,
        at: payout.createdAt.slice(0, 10),
      });
  }
  return {
    owner,
    payableMinor: payable,
    destinations: [...seen.values()],
    limits: {
      perPaymentMinor: policy.perTransactionMinor,
      perDayMinor: policy.perDayMinor,
      askAboveMinor: policy.approveAboveMinor,
    },
  };
}

/** The facts as the model sees them: money spelled out, nothing implied. */
export function payerPrompt(facts: PayerFacts): string {
  const lines = [
    `Merchant: @${facts.owner}`,
    `Owed to them right now: ${formatMinor(facts.payableMinor)} (${facts.payableMinor} minor units)`,
    "",
    "Known destinations (you may use only these):",
    ...(facts.destinations.length === 0
      ? ["  none — this merchant has never been paid out"]
      : facts.destinations.map(
          (d) =>
            `  ${d.address} — last received ${formatMinor(BigInt(d.lastPaidMinor))} on ${d.at}`,
        )),
    "",
    "The owner's limits, for context:",
    `  refused above ${formatMinor(facts.limits.perPaymentMinor)} per payment`,
    `  refused above ${formatMinor(facts.limits.perDayMinor)} per day`,
    `  held for approval above ${formatMinor(facts.limits.askAboveMinor)}`,
    "",
    "Should anything be released now?",
  ];
  return lines.join("\n");
}

export type PayerRun = {
  /** The proposal, when the Payer made one and the Guardian allowed it to stand. */
  proposal: ProposalView | null;
  /** What the Payer decided, in its own words. */
  reason: string;
  act: "payout" | "none";
  model: string;
  promptVersion: string;
};

export type Ask = typeof askForJson;

/**
 * Runs the Payer once. `ask` is injected so the evals can drive it without
 * spending money — the validation below is the part worth testing, and it
 * runs identically either way.
 */
export async function runPayer(
  owner: string,
  options: { ask?: Ask } = {},
): Promise<PayerRun> {
  const ask = options.ask ?? askForJson;
  if (!options.ask && !claudeConfigured()) throw new ClaudeNotConfiguredError();

  const facts = await payerFacts(owner);
  const completion: Completion = await ask({
    system: SYSTEM,
    prompt: payerPrompt(facts),
    schema: DECISION_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });

  const parsed = decision.safeParse(completion.json);
  if (!parsed.success)
    throw new ClaudeShapeError(
      `The Payer answered in a shape this app will not act on: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  const answer = parsed.data;
  const model = `${completion.model}@${completion.promptVersion ?? PROMPT_VERSION}`;

  if (answer.act === "none")
    return {
      proposal: null,
      reason: answer.reason,
      act: "none",
      model,
      promptVersion: completion.promptVersion,
    };

  if (!answer.amountMinor || !answer.destination)
    throw new ClaudeShapeError(
      "The Payer proposed a payout without an amount or a destination.",
    );

  // The model may only choose from what it was shown. This is a check, not
  // an instruction: a destination it invented never reaches the Guardian.
  const known = facts.destinations.find(
    (d) => d.address.toLowerCase() === answer.destination?.toLowerCase(),
  );
  if (!known)
    throw new ClaudeShapeError(
      `The Payer named a destination that is not on this account: ${answer.destination}`,
    );

  const proposal = await proposePayout({
    owner,
    payload: {
      amountMinor: answer.amountMinor,
      currency: "USD",
      destination: known.address,
      intentKey: `payer-${newId(16)}`,
    },
    proposedBy: "payer-agent",
    model,
  });

  return {
    proposal,
    reason: answer.reason,
    act: "payout",
    model,
    promptVersion: completion.promptVersion,
  };
}
