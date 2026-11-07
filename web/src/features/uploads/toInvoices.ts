import { toDecimal } from "../invoices/money";
import { readAmount, readDate } from "./amount";

// Turning someone's spreadsheet into invoices.
//
// Nothing here creates anything. It reads a table, says what it thinks each
// column is, and hands back one candidate per row — valid or not, with the
// reason. The person sees all of that before a single invoice exists,
// because an importer that writes first and reports afterwards leaves work
// that is harder to undo than it was to do.
//
// Every candidate is then held to `invoiceInput`, the same schema the form
// is held to. A rule belongs where both writers pass through it.

export type Mapping = {
  number: string | null;
  clientName: string | null;
  clientEmail: string | null;
  amount: string | null;
  dueDate: string | null;
  description: string | null;
};

export type Candidate = {
  /** The line in the file, counting the header, so a person can go and look. */
  row: number;
  /** Shaped for `invoiceInput`; whether it passes is decided there. */
  draft: Record<string, unknown>;
  /** What is plainly missing before the schema is even asked. */
  problem: string | null;
};

const find = (columns: string[], words: string[]) =>
  columns.find((c) => {
    const name = c.toLowerCase();
    return words.some((w) => name.includes(w));
  }) ?? null;

/** What each column looks like it holds. Shown, and changeable, before use. */
export function mapColumns(
  columns: string[],
  rows: Record<string, string>[],
): Mapping {
  const scores = (column: string, read: (v: string) => unknown) =>
    rows.filter((r) => read(r[column] ?? "") !== null).length;

  // Settled before the amount and then taken out of the running: a date
  // reads as a perfectly good number, which is how a column of dates ends
  // up invoicing people for twenty million.
  let dueDate =
    find(columns, ["due", "jatuh tempo", "deadline"]) ??
    find(columns, ["date", "tanggal"]);
  if (!dueDate) {
    const best = [...columns].sort(
      (a, b) => scores(b, readDate) - scores(a, readDate),
    )[0];
    dueDate = best && scores(best, readDate) > 0 ? best : null;
  }
  const amount =
    find(columns, ["amount", "total", "price", "value", "jumlah", "nominal"]) ??
    // No header to go on: the column where most cells read as money, and
    // never the date column, whose values also read as numbers.
    [...columns]
      .filter((c) => c !== dueDate)
      .sort((a, b) => scores(b, readAmount) - scores(a, readAmount))[0] ??
    null;

  return {
    number: find(columns, ["number", "invoice", "no.", "nomor", "ref"]),
    clientName: find(columns, [
      "client",
      "customer",
      "name",
      "to",
      "pelanggan",
    ]),
    clientEmail: find(columns, ["email", "e-mail", "mail"]),
    amount,
    dueDate,
    description: find(columns, [
      "description",
      "item",
      "detail",
      "service",
      "keterangan",
    ]),
  };
}

/** A number for a row that did not bring one, stable for the same file. */
function numberFor(index: number, prefix: string): string {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

export function toCandidates(
  rows: Record<string, string>[],
  mapping: Mapping,
  options: { fallbackPrefix?: string; defaultDueDate: string } = {
    defaultDueDate: new Date().toISOString().slice(0, 10),
  },
): Candidate[] {
  const prefix = options.fallbackPrefix ?? "IMP";
  return rows.map((row, index) => {
    const at = (column: string | null) =>
      column ? (row[column] ?? "").trim() : "";

    const clientName = at(mapping.clientName);
    const minor = readAmount(at(mapping.amount));
    const due = readDate(at(mapping.dueDate));

    // Said plainly here rather than left to a schema message, because these
    // two are the ones a person can fix in their spreadsheet and try again.
    const problem =
      clientName.length === 0
        ? "No client name in this row."
        : minor === null
          ? "No amount that could be read."
          : minor <= 0n
            ? "The amount is not positive."
            : null;

    return {
      row: index + 2,
      problem,
      draft: {
        number: at(mapping.number) || numberFor(index, prefix),
        clientName,
        clientEmail: at(mapping.clientEmail),
        dueDate: due ?? options.defaultDueDate,
        notes: "",
        items: [
          {
            description: at(mapping.description) || "Services",
            quantity: 1,
            unitPrice: minor !== null && minor > 0n ? toDecimal(minor) : "0",
          },
        ],
      },
    };
  });
}
