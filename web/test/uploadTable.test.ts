import { describe, expect, it } from "vitest";
import { MAX_ROWS, parseTable, TableError } from "@/features/uploads/table";

// What arrives is whatever a bank, a spreadsheet or another invoicing tool
// produced, so these are the shapes that actually turn up rather than the
// ones a writer would choose.

describe("reading a table someone else wrote", () => {
  it("keeps a comma that is inside a quoted field", () => {
    const table = parseTable(
      'client,address,amount\n"Rivet & Co","12 Mill St, Bandung",400.00\n',
    );
    expect(table.columns).toEqual(["client", "address", "amount"]);
    expect(table.rows).toEqual([
      {
        client: "Rivet & Co",
        address: "12 Mill St, Bandung",
        amount: "400.00",
      },
    ]);
  });

  it("reads a doubled quote as one quote, and a newline inside a field", () => {
    const table = parseTable('note\n"She said ""yes"",\nthen left"\n');
    expect(table.rows[0].note).toBe('She said "yes",\nthen left');
  });

  it("finds the delimiter instead of assuming a comma", () => {
    // A European export: semicolons, and commas inside the numbers.
    const table = parseTable(
      "date;description;amount\n2026-11-03;Fee;1.234,50\n",
    );
    expect(table.columns).toEqual(["date", "description", "amount"]);
    expect(table.rows[0].amount).toBe("1.234,50");
  });

  it("handles \\r\\n, a trailing newline, and blank lines between rows", () => {
    const table = parseTable("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(table.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("strips the BOM, which would otherwise live inside the first header", () => {
    const table = parseTable("﻿invoice,amount\nINV-001,10\n");
    expect(table.columns[0]).toBe("invoice");
  });

  it("names a blank header and separates two with the same name", () => {
    const table = parseTable("amount,,amount\n1,2,3\n");
    expect(table.columns).toEqual(["amount", "column 2", "amount (2)"]);
    expect(table.rows[0]).toEqual({
      amount: "1",
      "column 2": "2",
      "amount (2)": "3",
    });
  });

  it("fills a short row rather than shifting the columns along", () => {
    const table = parseTable("a,b,c\n1,2\n");
    expect(table.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("stops at the row cap and says how many it left", () => {
    const rows = Array.from({ length: MAX_ROWS + 25 }, (_, i) => `${i}`);
    const table = parseTable(`n\n${rows.join("\n")}\n`);
    expect(table.rows).toHaveLength(MAX_ROWS);
    expect(table.truncated.rows).toBe(25);
  });

  it("refuses an empty file rather than returning an empty table", () => {
    expect(() => parseTable("   \n\n")).toThrow(TableError);
  });
});
