import { describe, expect, it } from "vitest";
import { reversal, type Share } from "../src/features/refunds/reverse";

// The arithmetic behind giving money back: it comes out of the pots it went
// into, and the parts add up to the refund exactly — including when the
// refund arrives in three pieces.

const sum = (shares: Share[]) =>
  shares.reduce((total, share) => total + share.amountMinor, 0n);

const SPLIT: Share[] = [
  { account: "tax_reserve:lana", amountMinor: 2500n }, // 25%
  { account: "platform_fee", amountMinor: 500n }, //      5%
  { account: "merchant_payable:lana", amountMinor: 7000n }, // the rest
];

describe("refund reversal", () => {
  it("takes a full refund back out of every pot it went into", () => {
    const back = reversal(SPLIT, 0n, 10_000n);
    expect(back).toEqual(SPLIT);
    expect(sum(back)).toBe(10_000n);
  });

  it("takes a part refund in proportion", () => {
    const back = reversal(SPLIT, 0n, 1_000n);
    expect(sum(back)).toBe(1_000n);
    expect(back).toEqual([
      { account: "tax_reserve:lana", amountMinor: 250n },
      { account: "platform_fee", amountMinor: 50n },
      { account: "merchant_payable:lana", amountMinor: 700n },
    ]);
  });

  it("adds up to the whole when it arrives in three pieces", () => {
    // 10000 does not divide by three, which is the point.
    const first = reversal(SPLIT, 0n, 3_334n);
    const second = reversal(SPLIT, 3_334n, 6_667n);
    const third = reversal(SPLIT, 6_667n, 10_000n);
    expect(sum(first) + sum(second) + sum(third)).toBe(10_000n);

    const total = new Map<string, bigint>();
    for (const share of [...first, ...second, ...third])
      total.set(
        share.account,
        (total.get(share.account) ?? 0n) + share.amountMinor,
      );
    // Every pot is back exactly where it started.
    for (const share of SPLIT)
      expect(total.get(share.account)).toBe(share.amountMinor);
  });

  it("never asks a pot for a negative amount", () => {
    const awkward: Share[] = [
      { account: "tax_reserve:lana", amountMinor: 1n },
      { account: "platform_fee", amountMinor: 1n },
      { account: "merchant_payable:lana", amountMinor: 1n },
    ];
    for (let before = 0n; before < 3n; before++) {
      const back = reversal(awkward, before, before + 1n);
      expect(sum(back)).toBe(1n);
      for (const share of back) expect(share.amountMinor > 0n).toBe(true);
    }
  });

  it("refuses a total that goes backwards", () => {
    expect(() => reversal(SPLIT, 500n, 400n)).toThrow(/backwards/);
  });

  it("gives nothing back when there is nothing to give", () => {
    expect(reversal([], 0n, 100n)).toEqual([]);
    expect(reversal(SPLIT, 0n, 0n)).toEqual([]);
  });
});
