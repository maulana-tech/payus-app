import { describe, expect, it } from "vitest";
import {
  formatMinor,
  toDecimal,
  toMinor,
} from "../src/features/invoices/money";

describe("money", () => {
  it("parses decimals into minor units", () => {
    expect(toMinor("12.5")).toBe(1250n);
    expect(toMinor("0.05")).toBe(5n);
    expect(toMinor("1000")).toBe(100000n);
    expect(() => toMinor("1.234")).toThrow();
    expect(() => toMinor("-1")).toThrow();
  });

  it("formats minor units for display and for input fields", () => {
    expect(formatMinor(123456n)).toBe("$1,234.56");
    expect(formatMinor(5n)).toBe("$0.05");
    expect(formatMinor(5n, "EUR")).toBe("0.05 EUR");
    expect(toDecimal(123456n)).toBe("1234.56");
    expect(toDecimal(5n)).toBe("0.05");
  });
});
