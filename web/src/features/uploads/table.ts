// Reading a table someone else wrote.
//
// Our own CSV writer is `lib/csv.ts`; this is the other direction, and the
// two have nothing in common — writing is a choice, reading is a negotiation
// with whatever a bank, a spreadsheet or another invoicing tool produced.
//
// Hand-written rather than a dependency, because the whole of RFC 4180 is a
// page: quoted fields, doubled quotes inside them, and newlines that only
// end a record when they fall outside quotes. A parser that splits on commas
// loses the first address it meets.

export type Table = {
  columns: string[];
  rows: Record<string, string>[];
  /** What was dropped to stay inside the limits, for telling the person. */
  truncated: { rows: number; columns: number };
};

export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 40;
export const MAX_CELL = 2000;
/** What the server will accept in one go: generous for a CSV, far under
 * what a request body should carry. */
export const MAX_UPLOAD_CHARS = 2_000_000;

export class TableError extends Error {}

/** Splits a delimited file into records, honouring quotes. */
function records(text: string, delimiter: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // \r\n is one break, not two.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      out.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/**
 * Which delimiter the file actually uses. A European export is
 * semicolon-separated, and splitting it on commas yields one column with
 * every value inside it — which looks like a parse rather than a failure.
 */
function delimiterOf(firstLine: string): string {
  const counts = [",", ";", "\t", "|"].map(
    (d) => [d, firstLine.split(d).length - 1] as const,
  );
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ",";
}

/** A header cell that can be used as a key, and said out loud. */
function headerName(raw: string, index: number, taken: Set<string>): string {
  const base =
    raw.trim().replace(/\s+/g, " ").slice(0, 60) || `column ${index + 1}`;
  let name = base;
  let n = 2;
  while (taken.has(name)) name = `${base} (${n++})`;
  taken.add(name);
  return name;
}

export function parseTable(text: string): Table {
  // A BOM is invisible and would otherwise become part of the first header.
  const body = text.replace(/^﻿/, "");
  if (body.trim().length === 0) throw new TableError("That file is empty.");

  const firstBreak = body.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? body : body.slice(0, firstBreak);
  const raw = records(body, delimiterOf(firstLine)).filter((row) =>
    row.some((cell) => cell.trim().length > 0),
  );
  if (raw.length === 0) throw new TableError("That file has no rows.");

  const taken = new Set<string>();
  const header = raw[0].slice(0, MAX_COLUMNS);
  const columns = header.map((cell, i) => headerName(cell, i, taken));
  const droppedColumns = Math.max(0, raw[0].length - columns.length);

  const kept = raw.slice(1, MAX_ROWS + 1);
  const rows = kept.map((cells) => {
    const row: Record<string, string> = {};
    columns.forEach((name, i) => {
      row[name] = (cells[i] ?? "").trim().slice(0, MAX_CELL);
    });
    return row;
  });

  return {
    columns,
    rows,
    truncated: {
      rows: Math.max(0, raw.length - 1 - rows.length),
      columns: droppedColumns,
    },
  };
}
