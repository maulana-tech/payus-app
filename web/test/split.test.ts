import { describe, expect, it } from "vitest";
import {
  type Allocation,
  evaluateSplit,
  type SplitRule,
} from "../src/features/split/evaluate";

// The split engine divides money that has already arrived, so the one thing
// it may never do is change the total. Every case below checks that first.

const rule = (over: Partial<SplitRule> & { id: string }): SplitRule => ({
  name: over.id,
  target: `pos:${over.id}`,
  kind: "percent",
  value: 0n,
  priority: 0,
  ...over,
});

const sum = (allocations: Allocation[]) =>
  allocations.reduce((total, a) => total + a.amountMinor, 0n);

describe("split", () => {
  it("gives everything to the remainder when there are no rules", () => {
    expect(evaluateSplit(15_000n, [])).toEqual([
      {
        ruleId: null,
        name: "Yours",
        target: "merchant_payable",
        amountMinor: 15_000n,
      },
    ]);
  });

  it("takes a percentage of the whole, not of what is left", () => {
    const allocations = evaluateSplit(10_000n, [
      rule({ id: "tax", target: "tax_reserve", value: 1_000n, priority: 1 }),
      rule({ id: "save", value: 2_000n, priority: 2 }),
    ]);
    expect(allocations.map((a) => [a.target, a.amountMinor])).toEqual([
      ["tax_reserve", 1_000n], // 10% of 100.00
      ["pos:save", 2_000n], // 20% of 100.00, not 20% of what remained
      ["merchant_payable", 7_000n],
    ]);
    expect(sum(allocations)).toBe(10_000n);
  });

  it("settles rounding with largest remainder, losing nothing", () => {
    // Three thirds of 100.00: 33.33 each leaves one cent over.
    const thirds = [1, 2, 3].map((n) =>
      rule({ id: `r${n}`, value: 3_333n, priority: n }),
    );
    const allocations = evaluateSplit(10_000n, thirds);
    const amounts = allocations.map((a) => a.amountMinor);
    expect(amounts).toEqual([3_333n, 3_333n, 3_333n, 1n]);
    expect(sum(allocations)).toBe(10_000n);

    // 1/3 three times on an amount that does divide evenly.
    const even = evaluateSplit(9_999n, thirds);
    expect(sum(even)).toBe(9_999n);
  });

  it("hands the dropped units to the shares cut the most", () => {
    // 33.33% + 33.33% + 33.34% of 1.00: floors are 0.33/0.33/0.33, and the
    // last cent belongs to the biggest fraction, not to the first rule.
    const allocations = evaluateSplit(100n, [
      rule({ id: "a", value: 3_333n, priority: 1 }),
      rule({ id: "b", value: 3_333n, priority: 2 }),
      rule({ id: "c", value: 3_334n, priority: 3 }),
    ]);
    expect(
      allocations.filter((a) => a.ruleId).map((a) => [a.ruleId, a.amountMinor]),
    ).toEqual([
      ["a", 33n],
      ["b", 33n],
      ["c", 34n],
    ]);
    expect(sum(allocations)).toBe(100n);
  });

  it("mixes fixed cuts with percentages, in priority order", () => {
    const allocations = evaluateSplit(10_000n, [
      rule({
        id: "fee",
        target: "platform_fee",
        kind: "fixed",
        value: 300n,
        priority: 1,
      }),
      rule({ id: "tax", target: "tax_reserve", value: 1_000n, priority: 2 }),
    ]);
    expect(allocations.map((a) => [a.target, a.amountMinor])).toEqual([
      ["platform_fee", 300n], // $3.00 flat
      ["tax_reserve", 1_000n], // 10% of the gross
      ["merchant_payable", 8_700n],
    ]);
    expect(sum(allocations)).toBe(10_000n);
  });

  it("never pays out more than arrived, however greedy the rules", () => {
    const allocations = evaluateSplit(1_000n, [
      rule({ id: "a", kind: "fixed", value: 900n, priority: 1 }),
      rule({ id: "b", kind: "fixed", value: 900n, priority: 2 }),
      rule({ id: "c", value: 5_000n, priority: 3 }),
    ]);
    expect(allocations.map((a) => [a.ruleId, a.amountMinor])).toEqual([
      ["a", 900n],
      ["b", 100n], // only what was left
    ]);
    expect(sum(allocations)).toBe(1_000n);
    expect(allocations.some((a) => a.ruleId === "c")).toBe(false);
  });

  it("handles percentages over 100% by running out, not by inventing money", () => {
    const allocations = evaluateSplit(10_000n, [
      rule({ id: "a", value: 8_000n, priority: 1 }),
      rule({ id: "b", value: 8_000n, priority: 2 }),
    ]);
    expect(sum(allocations)).toBe(10_000n);
    expect(allocations[0]).toMatchObject({ ruleId: "a", amountMinor: 8_000n });
    expect(allocations[1]).toMatchObject({ ruleId: "b", amountMinor: 2_000n });
  });

  it("splits nothing into nothing", () => {
    expect(evaluateSplit(0n, [rule({ id: "a", value: 5_000n })])).toEqual([]);
  });

  it("refuses a negative amount", () => {
    expect(() => evaluateSplit(-1n, [])).toThrow(/never a negative/);
  });

  it("is the same every time, whatever order the rules arrive in", () => {
    const rules = [
      rule({ id: "c", value: 3_333n, priority: 2 }),
      rule({ id: "a", value: 3_333n, priority: 2 }),
      rule({ id: "b", value: 3_333n, priority: 1 }),
    ];
    const once = evaluateSplit(10_000n, rules);
    const again = evaluateSplit(10_000n, [...rules].reverse());
    expect(again).toEqual(once);
  });
});
