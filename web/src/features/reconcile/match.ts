import { readAmount, readDate } from "../uploads/amount";

// Putting a statement against the books.
//
// Pure, and deliberately no model anywhere near it. Matching a line to a
// posting is arithmetic and dates; a model asked to do it would be right
// most of the time, and "most of the time" is the one thing reconciliation
// may not be. What a model cannot be trusted with here is exactly what code
// is good at.
//
// The answer that earns the feature is not the matches — it is the two
// lists of what did not match, because a line the books have no posting for
// is precisely what you opened this to find.

export type Line = {
  /** Where it sat in the file, so a person can go and look. */
  index: number;
  date: string | null;
  amountMinor: bigint;
  description: string;
};

export type Posting = {
  id: string;
  date: string;
  amountMinor: bigint;
  description: string;
};

export type Reconciliation = {
  matched: { line: Line; posting: Posting }[];
  onlyInFile: Line[];
  onlyInLedger: Posting[];
  /** Rows that carried no amount at all, so could not take part. */
  unreadable: number;
};

/** How far apart a statement date and a posting date may sit and still be
 * the same movement: a card settles days after it is taken. */
export const DAYS_APART = 4;

const dayNumber = (iso: string) =>
  Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

function withinDays(a: string | null, b: string, days: number): boolean {
  // A line without a readable date matches on amount alone rather than not
  // at all — the alternative is reporting a difference that is not one.
  if (!a) return true;
  const left = dayNumber(a);
  const right = dayNumber(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return true;
  return Math.abs(left - right) <= days;
}

/** Which column holds what, decided from the header and then the values. */
export function columnsOf(
  columns: string[],
  rows: Record<string, string>[],
): { amount: string | null; date: string | null; description: string | null } {
  const named = (words: string[]) =>
    columns.find((c) => words.some((w) => c.toLowerCase().includes(w))) ?? null;
  const score = (column: string, read: (v: string) => unknown) =>
    rows.reduce((n, row) => (read(row[column] ?? "") !== null ? n + 1 : n), 0);

  // A header that says so is better evidence than any amount of guessing.
  let date = named(["date", "when", "posted", "tanggal", "waktu"]);
  if (!date) {
    const best = [...columns].sort(
      (a, b) => score(b, readDate) - score(a, readDate),
    )[0];
    date = best && score(best, readDate) > 0 ? best : null;
  }

  // The date column is settled first and then taken out of the running,
  // because `2026-11-01` reads as a perfectly good number — which is how a
  // statement's date column ends up being summed as money.
  let amount = named([
    "amount",
    "value",
    "debit",
    "credit",
    "total",
    "jumlah",
    "nominal",
  ]);
  if (!amount) {
    const candidates = columns.filter((c) => c !== date);
    amount =
      [...candidates].sort(
        (a, b) => score(b, readAmount) - score(a, readAmount),
      )[0] ?? null;
  }

  const description =
    named([
      "description",
      "detail",
      "narrative",
      "memo",
      "reference",
      "keterangan",
    ]) ??
    columns.find((c) => c !== amount && c !== date) ??
    null;
  return { amount, date, description };
}

export function linesOf(
  columns: string[],
  rows: Record<string, string>[],
): { lines: Line[]; unreadable: number } {
  const { amount, date, description } = columnsOf(columns, rows);
  if (!amount) return { lines: [], unreadable: rows.length };
  const lines: Line[] = [];
  let unreadable = 0;
  rows.forEach((row, index) => {
    const minor = readAmount(row[amount] ?? "");
    if (minor === null) {
      unreadable++;
      return;
    }
    lines.push({
      index,
      date: date ? readDate(row[date] ?? "") : null,
      amountMinor: minor,
      description: (description ? row[description] : "") ?? "",
    });
  });
  return { lines, unreadable };
}

/**
 * Greedy and first-come, which is the honest shape: a posting may answer for
 * one line only, so two identical lines need two postings. Nearest date wins
 * among equal amounts, so a repeated monthly charge pairs with its own month
 * rather than the first one in the file.
 */
export function reconcile(
  lines: Line[],
  postings: Posting[],
  unreadable = 0,
): Reconciliation {
  const left = new Map(postings.map((p) => [p.id, p]));
  const matched: { line: Line; posting: Posting }[] = [];
  const onlyInFile: Line[] = [];

  for (const line of lines) {
    const candidates = [...left.values()].filter(
      (p) =>
        p.amountMinor === line.amountMinor &&
        withinDays(line.date, p.date, DAYS_APART),
    );
    if (candidates.length === 0) {
      onlyInFile.push(line);
      continue;
    }
    const best = line.date
      ? candidates.sort(
          (a, b) =>
            Math.abs(dayNumber(a.date) - dayNumber(line.date as string)) -
            Math.abs(dayNumber(b.date) - dayNumber(line.date as string)),
        )[0]
      : candidates[0];
    left.delete(best.id);
    matched.push({ line, posting: best });
  }

  return {
    matched,
    onlyInFile,
    onlyInLedger: [...left.values()],
    unreadable,
  };
}
