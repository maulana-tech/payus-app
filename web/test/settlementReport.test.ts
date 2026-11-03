import { describe, expect, it } from "vitest";
import {
  type Entry,
  settlementReport,
} from "../src/features/reports/settlement";

// A day of money, read back out of the ledger entries. The number that
// matters most is the last one: the cash account's own movement against
// what the categories say it should have been.

const e = (
  day: string,
  kind: string,
  account: string,
  debit: bigint,
  credit: bigint,
): Entry => ({
  day,
  kind,
  account,
  debitMinor: debit,
  creditMinor: credit,
});

/** $100 taken, $1 fee, split 25% to tax. */
const capture = (day: string, owner = "lana"): Entry[] => [
  e(day, "payment.captured", "paypal_cash", 9_900n, 0n),
  e(day, "payment.captured", "psp_fee", 100n, 0n),
  e(day, "payment.captured", `in_flight:${owner}`, 0n, 10_000n),
  e(day, "settlement", `in_flight:${owner}`, 10_000n, 0n),
  e(day, "settlement", `tax_reserve:${owner}`, 0n, 2_500n),
  e(day, "settlement", `merchant_payable:${owner}`, 0n, 7_500n),
];

describe("settlement report", () => {
  it("reads a day of taking money", () => {
    const report = settlementReport(capture("2026-11-01"), {
      from: "2026-11-01",
      to: "2026-11-01",
    });
    expect(report.days).toHaveLength(1);
    expect(report.totals.takenMinor).toBe(10_000n);
    expect(report.totals.feesMinor).toBe(100n);
    expect(report.totals.setAsideMinor).toBe(2_500n);
    expect(report.totals.yoursMinor).toBe(7_500n);
    expect(report.reconciliation.balanced).toBe(true);
    expect(report.reconciliation.cashMovementMinor).toBe(9_900n);
  });

  it("reconciles a part refund and a payout in the same period", () => {
    const entries: Entry[] = [
      ...capture("2026-11-01"),
      // $40 back, no fee returned: the pots give it up in proportion.
      e("2026-11-02", "refund", "tax_reserve:lana", 1_000n, 0n),
      e("2026-11-02", "refund", "merchant_payable:lana", 3_000n, 0n),
      e("2026-11-02", "refund", "paypal_cash", 0n, 4_000n),
      // $45 released for real.
      e("2026-11-03", "payout", "merchant_payable:lana", 4_500n, 0n),
      e("2026-11-03", "payout", "paypal_cash", 0n, 4_500n),
    ];
    const report = settlementReport(entries, {
      from: "2026-11-01",
      to: "2026-11-03",
    });

    expect(report.days.map((d) => d.day)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(report.totals.refundedMinor).toBe(4_000n);
    expect(report.totals.paidOutMinor).toBe(4_500n);
    // 7500 credited, 3000 refunded, 4500 released.
    expect(report.totals.yoursMinor).toBe(0n);
    expect(report.reconciliation.expectedMinor).toBe(1_400n);
    expect(report.reconciliation.cashMovementMinor).toBe(1_400n);
    expect(report.reconciliation.balanced).toBe(true);
  });

  it("counts a simulated payout apart from a real one", () => {
    const entries: Entry[] = [
      ...capture("2026-11-01"),
      e("2026-11-01", "payout.simulated", "merchant_payable:lana", 7_500n, 0n),
      e("2026-11-01", "payout.simulated", "paypal_cash", 0n, 7_500n),
    ];
    const report = settlementReport(entries, {
      from: "2026-11-01",
      to: "2026-11-01",
    });
    expect(report.totals.paidOutMinor).toBe(0n);
    expect(report.totals.simulatedOutMinor).toBe(7_500n);
    expect(report.reconciliation.balanced).toBe(true);
  });

  it("says so when something posted that it does not understand", () => {
    // A posting this report has no category for: cash moved and nothing
    // here explains it. Showing the difference is the whole point.
    const entries: Entry[] = [
      ...capture("2026-11-01"),
      e("2026-11-01", "mystery", "paypal_cash", 500n, 0n),
      e("2026-11-01", "mystery", "external", 0n, 500n),
    ];
    const report = settlementReport(entries, {
      from: "2026-11-01",
      to: "2026-11-01",
    });
    expect(report.reconciliation.balanced).toBe(false);
    expect(report.reconciliation.differenceMinor).toBe(500n);
  });

  it("is empty, and balanced, when nothing happened", () => {
    const report = settlementReport([], {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(report.days).toEqual([]);
    expect(report.totals.takenMinor).toBe(0n);
    expect(report.reconciliation.balanced).toBe(true);
  });
});
