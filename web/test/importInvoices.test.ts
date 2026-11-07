import { describe, expect, it } from "vitest";
import { invoiceInput } from "@/features/invoices/input";
import { mapColumns, toCandidates } from "@/features/uploads/toInvoices";

// Nothing here creates anything: it reads a table and says what it would
// make. Every candidate is then held to `invoiceInput` — the same schema the
// form is held to — so an imported invoice can be nothing the typed one
// could not be.

const columns = ["Invoice No", "Client", "Email", "Due", "Amount", "Service"];
const rows = [
  {
    "Invoice No": "INV-900",
    Client: "Rivet & Co",
    Email: "pay@rivet.example",
    Due: "2026-12-01",
    Amount: "$1,200.00",
    Service: "Retainer, December",
  },
  {
    "Invoice No": "",
    Client: "Blue Harbour",
    Email: "",
    Due: "15/12/2026",
    Amount: "850",
    Service: "",
  },
];

describe("mapping a spreadsheet onto invoices", () => {
  it("reads the headers it recognises", () => {
    expect(mapColumns(columns, rows)).toEqual({
      number: "Invoice No",
      clientName: "Client",
      clientEmail: "Email",
      amount: "Amount",
      dueDate: "Due",
      description: "Service",
    });
  });

  it("never picks the date column as the amount column", () => {
    // `2026-12-01` reads as a number, so a header-less file would otherwise
    // invoice people for twenty million.
    const bare = [{ a: "2026-12-01", b: "Acme", c: "400.00" }];
    expect(mapColumns(["a", "b", "c"], bare).amount).toBe("c");
  });
});

describe("what it would make", () => {
  const candidates = toCandidates(rows, mapColumns(columns, rows), {
    defaultDueDate: "2026-11-30",
  });

  it("passes the real schema, so an import is nothing a form could not be", () => {
    for (const candidate of candidates) {
      expect(candidate.problem).toBeNull();
      const parsed = invoiceInput.safeParse(candidate.draft);
      expect(parsed.success).toBe(true);
    }
  });

  it("carries the money across without losing the grouping or the symbol", () => {
    expect(candidates[0].draft).toMatchObject({
      number: "INV-900",
      clientName: "Rivet & Co",
      dueDate: "2026-12-01",
      items: [
        {
          description: "Retainer, December",
          quantity: 1,
          unitPrice: "1200.00",
        },
      ],
    });
  });

  it("fills what the row did not bring, and says what it filled", () => {
    const second = candidates[1].draft as {
      number: string;
      dueDate: string;
      items: { description: string }[];
    };
    expect(second.number).toBe("IMP-002");
    expect(second.dueDate).toBe("2026-12-15");
    expect(second.items[0].description).toBe("Services");
  });

  it("points at the row and the reason rather than refusing the file", () => {
    const bad = toCandidates(
      [
        { Client: "", Amount: "100" },
        { Client: "Acme", Amount: "nothing" },
        { Client: "Acme", Amount: "-50" },
      ],
      {
        ...mapColumns(["Client", "Amount"], []),
        clientName: "Client",
        amount: "Amount",
      },
      { defaultDueDate: "2026-11-30" },
    );
    expect(bad.map((c) => c.problem)).toEqual([
      "No client name in this row.",
      "No amount that could be read.",
      "The amount is not positive.",
    ]);
    // And the rows are numbered as the file numbers them, header included.
    expect(bad.map((c) => c.row)).toEqual([2, 3, 4]);
  });
});
