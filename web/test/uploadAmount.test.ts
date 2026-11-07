import { describe, expect, it } from "vitest";
import { readAmount, readDate } from "@/features/uploads/amount";

// `toMinor` in features/invoices/money.ts is strict on purpose — it guards
// our own form. This reads what a bank wrote, which is a different job, and
// these are the shapes that actually arrive.

describe("reading an amount a bank wrote", () => {
  it("reads the plain ones", () => {
    expect(readAmount("1500.00")).toBe(150_000n);
    expect(readAmount("-46.50")).toBe(-4650n);
    expect(readAmount("1500")).toBe(150_000n);
  });

  it("ignores the currency and the grouping", () => {
    expect(readAmount("$1,500.00")).toBe(150_000n);
    expect(readAmount("USD 1,500.00")).toBe(150_000n);
    expect(readAmount("1 234,50 EUR")).toBe(123_450n);
  });

  it("puts the decimal where the locale put it", () => {
    // Both present: the last one is the decimal, in every locale using both.
    expect(readAmount("1.234,50")).toBe(123_450n);
    expect(readAmount("1,234.50")).toBe(123_450n);
    // One separator followed by exactly three digits is a group, and both
    // of these mean the same number where they were written.
    expect(readAmount("1,500")).toBe(150_000n);
    expect(readAmount("1.500")).toBe(150_000n);
    // One or two digits after it can only be a decimal.
    expect(readAmount("1,5")).toBe(150n);
    expect(readAmount("1.5")).toBe(150n);
  });

  it("reads an accounting negative", () => {
    expect(readAmount("(200.00)")).toBe(-20_000n);
    expect(readAmount("($1,200.00)")).toBe(-120_000n);
  });

  it("returns null rather than zero for what is not an amount", () => {
    // Zero would reconcile against nothing and look like agreement.
    expect(readAmount("")).toBeNull();
    expect(readAmount("  ")).toBeNull();
    expect(readAmount("Office rent")).toBeNull();
    expect(readAmount("—")).toBeNull();
  });

  it("treats three digits after the only separator as a group", () => {
    // `10.999` is genuinely ambiguous, and on a statement the grouped
    // reading is the likelier one. The rule is the same either way, which
    // matters more than which guess is right in the rare case.
    expect(readAmount("10.999")).toBe(1_099_900n);
  });

  it("keeps two decimal places and drops the rest without rounding", () => {
    // Unambiguous: both separators present, so `.` is the decimal.
    expect(readAmount("1,234.5678")).toBe(123_456n);
  });
});

describe("reading a date a bank wrote", () => {
  it("reads ISO, with or without a time after it", () => {
    expect(readDate("2026-11-03")).toBe("2026-11-03");
    expect(readDate("2026-11-03T09:30:00Z")).toBe("2026-11-03");
  });

  it("reads a four-digit year wherever it sits", () => {
    expect(readDate("13/11/2026")).toBe("2026-11-13");
    expect(readDate("11.13.2026")).toBe("2026-11-13");
  });

  it("gives up rather than guess between 03/11 and 11/03", () => {
    // Both readings are valid, so neither is safe to pick. A row without a
    // date simply matches on amount alone.
    expect(readDate("03/11/26")).toBeNull();
    expect(readDate("not a date")).toBeNull();
  });
});
