// Money is integer minor units (cents) plus an ISO 4217 code. No floats.

export const CURRENCIES = ["USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = "USD";

/**
 * The most any one order may come to. A payer naming their own amount is
 * still a stranger typing into a form, so there is a ceiling above which we
 * do not write an invoice at all.
 */
export const MAX_ORDER_MINOR = 10_000_000n; // $100,000.00

/** "12.5" → 1250n minor units. Throws on more than 2 decimals or junk. */
export function toMinor(value: string): bigint {
  const v = value.trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) throw new Error("Invalid amount");
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

/** 1250n → "12.50" (no symbol, no grouping). */
export function toDecimal(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** 1250n → "$12.50" for display. */
export function formatMinor(
  minor: bigint,
  currency: string = DEFAULT_CURRENCY,
): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const whole = (abs / 100n).toLocaleString("en-US");
  const body = `${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
  return currency === "USD" ? `${sign}$${body}` : `${sign}${body} ${currency}`;
}
