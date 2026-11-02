import { describe, expect, it } from "vitest";
import {
  type Context,
  DEFAULT_POLICY,
  decide,
  type PayoutProposal,
  type Policy,
  type SplitProposal,
} from "../src/features/guardian/decide";

// The Guardian is the one part of the money path that must behave the same
// way every time, so it is tested the way a rule is read: one case per rule,
// then the cases where rules disagree.

const payout = (over: Partial<PayoutProposal> = {}): PayoutProposal => ({
  kind: "payout",
  amountMinor: 10_000n,
  currency: "USD",
  destination: "shop@example.com",
  ...over,
});

const context = (over: Partial<Context> = {}): Context => ({
  spentTodayMinor: 0n,
  knownRecipient: true,
  availableMinor: 1_000_000n,
  ...over,
});

const policy = (over: Partial<Policy> = {}): Policy => ({
  ...DEFAULT_POLICY,
  ...over,
});

describe("guardian", () => {
  it("allows what is inside every limit", () => {
    const decision = decide(payout(), policy(), context());
    expect(decision.verdict).toBe("allow");
    expect(decision.findings).toEqual([]);
    expect(decision.reason).toBe("Within every limit you set.");
  });

  it("refuses more than the ledger has", () => {
    const decision = decide(
      payout({ amountMinor: 2_000n }),
      policy(),
      context({ availableMinor: 1_000n }),
    );
    expect(decision.verdict).toBe("refuse");
    expect(decision.reason).toMatch(/Only \$10\.00 is available/);
  });

  it("refuses above the per-payment limit", () => {
    const decision = decide(
      payout({ amountMinor: 60_000n }),
      policy({ perTransactionMinor: 50_000n, approveAboveMinor: 90_000n }),
      context(),
    );
    expect(decision.verdict).toBe("refuse");
    expect(decision.findings.map((f) => f.rule)).toContain("limit.perPayment");
  });

  it("counts what has already gone out today", () => {
    const within = decide(
      payout({ amountMinor: 10_000n }),
      policy({ perDayMinor: 30_000n }),
      context({ spentTodayMinor: 15_000n }),
    );
    expect(within.verdict).toBe("allow");

    const over = decide(
      payout({ amountMinor: 20_000n }),
      policy({ perDayMinor: 30_000n }),
      context({ spentTodayMinor: 15_000n }),
    );
    expect(over.verdict).toBe("refuse");
    expect(over.reason).toMatch(/past the \$300\.00 daily limit/);
  });

  it("asks before paying someone for the first time", () => {
    const decision = decide(
      payout({ amountMinor: 1_000n }),
      policy(),
      context({ knownRecipient: false }),
    );
    expect(decision.verdict).toBe("ask");
    expect(decision.reason).toMatch(/has not been paid before/);
  });

  it("pays a known recipient without asking, if the policy says so", () => {
    expect(
      decide(
        payout({ amountMinor: 1_000n }),
        policy({ newRecipientNeedsApproval: false }),
        context({ knownRecipient: false }),
      ).verdict,
    ).toBe("allow");
  });

  it("asks above the amount the owner wants to see", () => {
    const decision = decide(
      payout({ amountMinor: 60_000n }),
      policy({ approveAboveMinor: 50_000n }),
      context(),
    );
    expect(decision.verdict).toBe("ask");
    expect(decision.findings.map((f) => f.rule)).toContain("amount.threshold");
  });

  it("refuses rather than asks when both apply", () => {
    const decision = decide(
      payout({ amountMinor: 80_000n }),
      policy({ perTransactionMinor: 70_000n, approveAboveMinor: 50_000n }),
      context({ knownRecipient: false }),
    );
    expect(decision.verdict).toBe("refuse");
    // Everything wrong with it is on the record, not only the first thing.
    expect(decision.findings.map((f) => f.rule).sort()).toEqual([
      "amount.threshold",
      "limit.perPayment",
      "recipient.new",
    ]);
    // The sentence says why it was refused, not why it would have asked.
    expect(decision.reason).toMatch(/Above the \$700\.00 limit/);
    expect(decision.reason).not.toMatch(/has not been paid before/);
  });

  it("refuses nothing and negatives", () => {
    expect(
      decide(payout({ amountMinor: 0n }), policy(), context()).verdict,
    ).toBe("refuse");
    expect(
      decide(payout({ amountMinor: -500n }), policy(), context()).verdict,
    ).toBe("refuse");
  });

  it("decides the same way twice", () => {
    const args = [
      payout({ amountMinor: 60_000n }),
      policy(),
      context({ knownRecipient: false }),
    ] as const;
    expect(decide(...args)).toEqual(decide(...args));
  });
});

describe("guardian · split changes", () => {
  const split = (
    rules: { name: string; target: string; value: bigint }[],
  ): SplitProposal => ({
    kind: "split.change",
    rules: rules.map((rule) => ({ ...rule, kind: "percent" as const })),
  });

  const share = (bp: bigint) => context({ currentShareBp: bp });

  it("allows a small adjustment", () => {
    const decision = decide(
      split([{ name: "Tax", target: "tax_reserve", value: 1_200n }]),
      policy(),
      share(1_000n),
    );
    expect(decision.verdict).toBe("allow");
  });

  it("asks before a large move", () => {
    const decision = decide(
      split([{ name: "Tax", target: "tax_reserve", value: 3_000n }]),
      policy(),
      share(1_000n),
    );
    expect(decision.verdict).toBe("ask");
    expect(decision.reason).toMatch(/from 10% to 30%/);
  });

  it("refuses a split that takes almost everything", () => {
    const decision = decide(
      split([
        { name: "Tax", target: "tax_reserve", value: 4_000n },
        { name: "Vault", target: "pos:vault", value: 6_000n },
      ]),
      policy(),
      share(0n),
    );
    expect(decision.verdict).toBe("refuse");
    expect(decision.findings.map((f) => f.rule)).toContain("split.tooMuch");
  });

  it("refuses to set the platform's own cut, or an empty split", () => {
    expect(
      decide(
        split([{ name: "Fee", target: "platform_fee", value: 500n }]),
        policy(),
        share(0n),
      ).verdict,
    ).toBe("refuse");
    expect(decide(split([]), policy(), share(0n)).verdict).toBe("refuse");
  });
});
