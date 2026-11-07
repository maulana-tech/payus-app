import "server-only";
import { invoiceInput } from "../../../features/invoices/input";
import { parseTable, TableError } from "../../../features/uploads/table";
import { mapColumns, toCandidates } from "../../../features/uploads/toInvoices";

// Reading a file as invoices, and nothing more.
//
// Both the preview and the commit go through here, so the person cannot be
// shown one thing and have another created: the commit reads the file again
// rather than trusting a list the browser sends back.

export type ImportRow = {
  row: number;
  ok: boolean;
  problem: string | null;
  number: string;
  clientName: string;
  amount: string;
  dueDate: string;
  draft: Record<string, unknown>;
};

export type ImportPreview = {
  columns: string[];
  mapping: ReturnType<typeof mapColumns>;
  rows: ImportRow[];
  ready: number;
  skipped: number;
  truncated: { rows: number; columns: number };
};

export function readImport(csv: string, defaultDueDate: string): ImportPreview {
  let table: ReturnType<typeof parseTable>;
  try {
    table = parseTable(csv);
  } catch (error) {
    throw error instanceof TableError
      ? error
      : new TableError("That file could not be read as a table.");
  }

  const mapping = mapColumns(table.columns, table.rows);
  const candidates = toCandidates(table.rows, mapping, { defaultDueDate });

  const rows: ImportRow[] = candidates.map((candidate) => {
    const parsed = invoiceInput.safeParse(candidate.draft);
    // The plain problem is better than a schema message where there is one;
    // the schema is the backstop, not the explanation.
    const problem =
      candidate.problem ??
      (parsed.success
        ? null
        : (parsed.error.issues[0]?.message ?? "This row cannot be made."));
    const draft = candidate.draft as {
      number: string;
      clientName: string;
      dueDate: string;
      items: { unitPrice: string }[];
    };
    return {
      row: candidate.row,
      ok: problem === null,
      problem,
      number: draft.number,
      clientName: draft.clientName,
      amount: draft.items[0]?.unitPrice ?? "0",
      dueDate: draft.dueDate,
      draft: candidate.draft,
    };
  });

  return {
    columns: table.columns,
    mapping,
    rows,
    ready: rows.filter((r) => r.ok).length,
    skipped: rows.filter((r) => !r.ok).length,
    truncated: table.truncated,
  };
}
