// Reading an amount a bank wrote.
//
// `features/invoices/money.ts` has `toMinor`, and it is deliberately strict:
// it guards what *we* accept from someone typing into our own field, and
// anything but `1234.56` is a mistake worth refusing. This is the opposite
// job — whatever a bank, a card processor or a spreadsheet produced — so it
// is a separate function on purpose. Loosening the strict one would quietly
// widen what the invoice form accepts.

/** Where the number ends and the decoration begins. */
const CLEAN = /[^0-9.,\-()]/g;

/**
 * Which of `.` and `,` is the decimal point.
 *
 * Both present: the last one is the decimal, in every locale that uses both.
 * Only one: a group separator is always followed by exactly three digits, so
 * one that is followed by one or two digits must be the decimal. That rule
 * reads `1,500` and `1.500` both as 1500 — which is what each of them means
 * where it was written.
 */
function decimalPoint(text: string): "." | "," | null {
  const dot = text.lastIndexOf(".");
  const comma = text.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) return dot > comma ? "." : ",";
  const only = dot >= 0 ? "." : comma >= 0 ? "," : null;
  if (!only) return null;
  const after = text.length - text.lastIndexOf(only) - 1;
  // Three digits after the only separator is a group, not a decimal.
  return after === 3 ? null : only;
}

/**
 * An amount in minor units, or null when the cell is not an amount at all.
 * Null rather than zero: a description column full of zeroes would otherwise
 * reconcile against nothing and look like agreement.
 */
export function readAmount(raw: string): bigint | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  // Accounting puts a negative in brackets; a trailing minus also happens.
  const bracketed = /^\(.*\)$/.test(text.replace(CLEAN, "").trim())
    ? true
    : /^\(.*\)$/.test(text);
  const cleaned = text.replace(CLEAN, "");
  if (!/\d/.test(cleaned)) return null;

  const negative =
    bracketed ||
    cleaned.startsWith("-") ||
    cleaned.replace(/[()]/g, "").endsWith("-");
  const digitsAndSeparators = cleaned.replace(/[-()]/g, "");

  const point = decimalPoint(digitsAndSeparators);
  let whole = digitsAndSeparators;
  let frac = "";
  if (point) {
    const at = digitsAndSeparators.lastIndexOf(point);
    whole = digitsAndSeparators.slice(0, at);
    frac = digitsAndSeparators.slice(at + 1);
  }
  whole = whole.replace(/[.,]/g, "");
  frac = frac.replace(/[.,]/g, "");
  if (whole.length === 0 && frac.length === 0) return null;
  // More than two decimal places is not money we can hold; round nothing,
  // take the two that are there and leave the rest.
  frac = frac.slice(0, 2).padEnd(2, "0");

  const minor = BigInt(whole || "0") * 100n + BigInt(frac);
  return negative ? -minor : minor;
}

/** An ISO date, from the handful of shapes a statement actually uses. */
export function readDate(raw: string): string | null {
  const text = raw.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // 03/11/2026 and 11/03/2026 cannot be told apart, so the only safe reading
  // is the unambiguous one: a four-digit year, wherever it sits.
  const slashed = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (slashed) {
    const [, a, b, year] = slashed;
    // Day first when the first number cannot be a month.
    const day = Number(a) > 12 ? a : b;
    const month = Number(a) > 12 ? b : a;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return null;
}
