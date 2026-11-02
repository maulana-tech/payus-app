// The Guardian. Not a model: a function. It is handed a proposal, the
// limits its owner set, and the facts it needs, and it answers allow, ask or
// refuse — the same way every time, with the reason it used.
//
// Nothing here reads a database, calls a provider, or knows what an agent
// is. That is the point: whatever writes a proposal, this decides it.

export type PayoutProposal = {
  kind: "payout";
  amountMinor: bigint;
  currency: string;
  destination: string;
};

export type Proposal = PayoutProposal;

export type Policy = {
  /** Above this, a single payment is refused outright. */
  perTransactionMinor: bigint;
  /** Above this, everything sent today together is refused. */
  perDayMinor: bigint;
  /** Above this, it waits for the owner. */
  approveAboveMinor: bigint;
  /** A recipient never paid before waits for the owner. */
  newRecipientNeedsApproval: boolean;
  /** How long an unanswered proposal stands, in minutes. */
  expiryMinutes: number;
};

export const DEFAULT_POLICY: Policy = {
  perTransactionMinor: 100_000n, // $1,000.00
  perDayMinor: 200_000n, // $2,000.00
  approveAboveMinor: 50_000n, // $500.00
  newRecipientNeedsApproval: true,
  expiryMinutes: 60,
};

export type Context = {
  /** Already sent today, by anything, for this owner. */
  spentTodayMinor: bigint;
  /** This destination has been paid before and was not refused. */
  knownRecipient: boolean;
  /** What the ledger says can be released right now. */
  availableMinor: bigint;
};

export type Verdict = "allow" | "ask" | "refuse";

export type Finding = {
  /** Stable id, so a decision can be looked up and argued with later. */
  rule: string;
  verdict: Verdict;
  reason: string;
};

export type Decision = {
  verdict: Verdict;
  findings: Finding[];
  /** The findings that decided it, as one sentence. */
  reason: string;
};

const RANK: Record<Verdict, number> = { allow: 0, ask: 1, refuse: 2 };

/** Minor units as money, without pulling in a locale. */
const amount = (minor: bigint, currency = "USD") => {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const body = `${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  return currency === "USD" ? `${sign}$${body}` : `${sign}${body} ${currency}`;
};

function payoutFindings(
  proposal: PayoutProposal,
  policy: Policy,
  context: Context,
): Finding[] {
  const findings: Finding[] = [];
  const money = (minor: bigint) => amount(minor, proposal.currency);

  if (proposal.amountMinor <= 0n)
    findings.push({
      rule: "amount.positive",
      verdict: "refuse",
      reason: "The amount has to be above zero.",
    });

  if (proposal.amountMinor > context.availableMinor)
    findings.push({
      rule: "funds.available",
      verdict: "refuse",
      reason: `Only ${money(context.availableMinor)} is available to release.`,
    });

  if (proposal.amountMinor > policy.perTransactionMinor)
    findings.push({
      rule: "limit.perPayment",
      verdict: "refuse",
      reason: `Above the ${money(policy.perTransactionMinor)} limit for a single payment.`,
    });

  if (context.spentTodayMinor + proposal.amountMinor > policy.perDayMinor)
    findings.push({
      rule: "limit.perDay",
      verdict: "refuse",
      reason: `This would take today to ${money(
        context.spentTodayMinor + proposal.amountMinor,
      )}, past the ${money(policy.perDayMinor)} daily limit.`,
    });

  if (policy.newRecipientNeedsApproval && !context.knownRecipient)
    findings.push({
      rule: "recipient.new",
      verdict: "ask",
      reason: `${proposal.destination} has not been paid before.`,
    });

  if (proposal.amountMinor > policy.approveAboveMinor)
    findings.push({
      rule: "amount.threshold",
      verdict: "ask",
      reason: `Above the ${money(policy.approveAboveMinor)} you asked to approve by hand.`,
    });

  return findings;
}

/**
 * Decides a proposal. Every rule is evaluated — not just the first to fire —
 * so the record says everything that was wrong with it, and the verdict is
 * the harshest of them.
 */
export function decide(
  proposal: Proposal,
  policy: Policy,
  context: Context,
): Decision {
  const findings = payoutFindings(proposal, policy, context);
  const verdict = findings.reduce<Verdict>(
    (worst, finding) =>
      RANK[finding.verdict] > RANK[worst] ? finding.verdict : worst,
    "allow",
  );
  const decisive = findings.filter((finding) => finding.verdict === verdict);
  return {
    verdict,
    findings,
    reason:
      verdict === "allow"
        ? "Within every limit you set."
        : decisive.map((finding) => finding.reason).join(" "),
  };
}
