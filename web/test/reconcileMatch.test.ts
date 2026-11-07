import { describe, expect, it } from "vitest";
import {
  columnsOf,
  linesOf,
  type Posting,
  reconcile,
} from "@/features/reconcile/match";

// The lists that earn the feature are the two "only in" ones. A matcher
// that quietly pairs the wrong things reports agreement, which is worse
// than reporting nothing.

const posting = (
  id: string,
  date: string,
  amountMinor: bigint,
  description = "",
): Posting => ({ id, date, amountMinor, description });

describe("finding the columns", () => {
  it("believes a header that says what it holds", () => {
    const found = columnsOf(
      ["When", "Narrative", "Value"],
      [{ When: "2026-11-03", Narrative: "Fee", Value: "-46.50" }],
    );
    expect(found).toEqual({
      amount: "Value",
      date: "When",
      description: "Narrative",
    });
  });

  it("does not mistake the date column for the amount column", () => {
    // `2026-11-01` reads as a perfectly good number, which is how a
    // statement's dates end up being summed as money.
    const rows = [
      { a: "2026-11-01", b: "Acme", c: "1500.00" },
      { a: "2026-11-02", b: "Fee", c: "-46.50" },
    ];
    expect(columnsOf(["a", "b", "c"], rows).amount).toBe("c");
  });

  it("falls back to the values when the headers say nothing", () => {
    const rows = [
      { a: "2026-11-01", b: "Acme", c: "1500.00" },
      { a: "2026-11-02", b: "Fee", c: "-46.50" },
    ];
    const found = columnsOf(["a", "b", "c"], rows);
    expect(found.amount).toBe("c");
    expect(found.date).toBe("a");
  });
});

describe("reading the lines", () => {
  it("counts the rows that carry no amount instead of dropping them quietly", () => {
    const { lines, unreadable } = linesOf(
      ["date", "description", "amount"],
      [
        { date: "2026-11-01", description: "Acme", amount: "1500.00" },
        { date: "", description: "Opening balance", amount: "" },
      ],
    );
    expect(lines).toHaveLength(1);
    expect(unreadable).toBe(1);
  });
});

describe("putting a statement against the books", () => {
  const lines = linesOf(
    ["date", "description", "amount"],
    [
      { date: "2026-11-01", description: "Acme Supply", amount: "1500.00" },
      { date: "2026-11-02", description: "PayPal fee", amount: "-46.50" },
      { date: "2026-11-04", description: "Office rent", amount: "-350.00" },
    ],
  ).lines;

  it("pairs what agrees and names what does not, on both sides", () => {
    const result = reconcile(lines, [
      posting("p1", "2026-11-01", 150_000n, "Capture INV-001"),
      posting("p2", "2026-11-02", -4650n, "PSP fee"),
      posting("p3", "2026-11-03", -20_000n, "Refund"),
    ]);

    expect(result.matched).toHaveLength(2);
    // The rent is in the bank and nowhere in the books.
    expect(result.onlyInFile.map((l) => l.description)).toEqual([
      "Office rent",
    ]);
    // The refund is in the books and has not reached the bank.
    expect(result.onlyInLedger.map((p) => p.id)).toEqual(["p3"]);
  });

  it("lets a posting answer for one line only", () => {
    const twice = linesOf(
      ["date", "amount"],
      [
        { date: "2026-11-01", amount: "-10.00" },
        { date: "2026-11-01", amount: "-10.00" },
      ],
    ).lines;
    const result = reconcile(twice, [posting("p1", "2026-11-01", -1000n)]);
    expect(result.matched).toHaveLength(1);
    expect(result.onlyInFile).toHaveLength(1);
  });

  it("pairs a repeated charge with its own month, not the first one", () => {
    const monthly = linesOf(
      ["date", "amount"],
      [
        { date: "2026-10-01", amount: "-9.00" },
        { date: "2026-11-01", amount: "-9.00" },
      ],
    ).lines;
    const result = reconcile(monthly, [
      posting("nov", "2026-11-01", -900n),
      posting("oct", "2026-10-01", -900n),
    ]);
    expect(result.matched.map((m) => m.posting.id)).toEqual(["oct", "nov"]);
  });

  it("allows a few days between the statement and the posting", () => {
    const late = linesOf(
      ["date", "amount"],
      [{ date: "2026-11-05", amount: "100.00" }],
    ).lines;
    expect(
      reconcile(late, [posting("p", "2026-11-02", 10_000n)]).matched,
    ).toHaveLength(1);
    // Far enough apart and it is two different movements, not one late one.
    expect(
      reconcile(late, [posting("p", "2026-10-02", 10_000n)]).matched,
    ).toHaveLength(0);
  });

  it("matches on amount alone when the date could not be read", () => {
    // Reporting a difference that is not one is the worse failure.
    const undated = linesOf(
      ["when", "amount"],
      [{ when: "03/11/26", amount: "100.00" }],
    ).lines;
    expect(undated[0].date).toBeNull();
    expect(
      reconcile(undated, [posting("p", "2026-01-01", 10_000n)]).matched,
    ).toHaveLength(1);
  });
});
