// The day's money, read back out of the ledger. Pure: it takes entries and
// returns a report, so the arithmetic can be tested without a database and
// the screen, the CSV and the PDF cannot disagree about what a day was.
//
// The reconciliation at the end is the point of the whole file. Every
// category is counted separately, and then the cash account's own movement
// is compared against what those categories say it should have been. If
// they differ, something posted that this report does not understand —
// which is worth knowing, and is why the difference is shown rather than
// hidden.

export type Entry = {
  /** YYYY-MM-DD, in UTC. */
  day: string;
  kind: string;
  account: string;
  debitMinor: bigint;
  creditMinor: bigint;
};

export type DayTotals = {
  /** Gross taken from payers. */
  takenMinor: bigint;
  /** What PayPal kept, less anything it gave back on a refund. */
  feesMinor: bigint;
  /** Gross handed back to payers. */
  refundedMinor: bigint;
  /** Moved out to the merchant for real. */
  paidOutMinor: bigint;
  /** Recorded as a payout but not actually sent (Payouts not approved). */
  simulatedOutMinor: bigint;
  /** Credited to tax and envelopes, net of anything taken back. */
  setAsideMinor: bigint;
  /** Credited to the merchant's own pot, net of refunds and payouts. */
  yoursMinor: bigint;
  /** The platform's cut, net of refunds. */
  platformMinor: bigint;
};

export type DayRow = DayTotals & { day: string };

export type SettlementReport = {
  from: string;
  to: string;
  days: DayRow[];
  totals: DayTotals;
  reconciliation: {
    /** Debits less credits on `paypal_cash` across the period. */
    cashMovementMinor: bigint;
    /** What the categories above say that movement should have been. */
    expectedMinor: bigint;
    /** Zero when the report accounts for everything that posted. */
    differenceMinor: bigint;
    balanced: boolean;
  };
};

const zero = (): DayTotals => ({
  takenMinor: 0n,
  feesMinor: 0n,
  refundedMinor: 0n,
  paidOutMinor: 0n,
  simulatedOutMinor: 0n,
  setAsideMinor: 0n,
  yoursMinor: 0n,
  platformMinor: 0n,
});

const add = (into: DayTotals, from: DayTotals): DayTotals => ({
  takenMinor: into.takenMinor + from.takenMinor,
  feesMinor: into.feesMinor + from.feesMinor,
  refundedMinor: into.refundedMinor + from.refundedMinor,
  paidOutMinor: into.paidOutMinor + from.paidOutMinor,
  simulatedOutMinor: into.simulatedOutMinor + from.simulatedOutMinor,
  setAsideMinor: into.setAsideMinor + from.setAsideMinor,
  yoursMinor: into.yoursMinor + from.yoursMinor,
  platformMinor: into.platformMinor + from.platformMinor,
});

const kindOf = (account: string) => account.split(":")[0];

/** Groups the entries by day and reconciles the period as a whole. */
export function settlementReport(
  entries: Entry[],
  range: { from: string; to: string },
): SettlementReport {
  const byDay = new Map<string, DayTotals>();
  const day = (key: string) => {
    const existing = byDay.get(key);
    if (existing) return existing;
    const fresh = zero();
    byDay.set(key, fresh);
    return fresh;
  };

  let cashMovement = 0n;

  for (const entry of entries) {
    const totals = day(entry.day);
    const account = kindOf(entry.account);
    const net = entry.debitMinor - entry.creditMinor;

    if (account === "paypal_cash") cashMovement += net;
    if (account === "psp_fee") totals.feesMinor += net;
    if (account === "platform_fee") totals.platformMinor -= net;
    if (account === "tax_reserve" || account === "pos")
      totals.setAsideMinor -= net;
    if (account === "merchant_payable") totals.yoursMinor -= net;

    // The gross of a capture is what lands in `in_flight`, and the gross of
    // a refund is what is taken back out of the pots — counted on the cash
    // side so a refund of an unsettled capture is counted the same way.
    if (entry.kind === "payment.captured" && account === "in_flight")
      totals.takenMinor += entry.creditMinor;
    if (
      entry.kind === "refund" &&
      account !== "paypal_cash" &&
      account !== "psp_fee"
    )
      totals.refundedMinor += entry.debitMinor;
    if (entry.kind === "payout" && account === "paypal_cash")
      totals.paidOutMinor += entry.creditMinor;
    if (entry.kind === "payout.simulated" && account === "paypal_cash")
      totals.simulatedOutMinor += entry.creditMinor;
  }

  const days = [...byDay.entries()]
    .map(([key, totals]) => ({ day: key, ...totals }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const totals = days.reduce<DayTotals>((sum, row) => add(sum, row), zero());

  // What the cash account should have done: money in, less the fee kept,
  // less what went back to payers, less what was really sent out. A
  // simulated payout credits cash in the ledger too, so it counts here.
  const expected =
    totals.takenMinor -
    totals.feesMinor -
    totals.refundedMinor -
    totals.paidOutMinor -
    totals.simulatedOutMinor;
  const difference = cashMovement - expected;

  return {
    from: range.from,
    to: range.to,
    days,
    totals,
    reconciliation: {
      cashMovementMinor: cashMovement,
      expectedMinor: expected,
      differenceMinor: difference,
      balanced: difference === 0n,
    },
  };
}
