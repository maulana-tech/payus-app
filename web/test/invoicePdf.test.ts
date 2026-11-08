import { describe, expect, it } from "vitest";
import type { InvoiceView } from "../src/features/invoices/types";
import { renderInvoicePdf } from "../src/lib/invoicePdf";

// The receipt a payer keeps.
//
// This had no caller and no test until the invoice page offered it as
// "Download receipt" — so the first person to find out whether it rendered
// would have been someone who had just paid. It titles itself differently
// once an invoice is paid, which is the whole reason it is a receipt and
// not a copy of the bill.

const invoice = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "inv_1",
  token: "tok_1",
  username: "lana",
  number: "INV-001",
  clientName: "Acme Supply",
  items: [
    { description: "Design retainer", quantity: 1, unitPrice: "1000.00" },
  ],
  currency: "USD",
  totalMinor: "100000",
  totalFormatted: "$1,000.00",
  paidMinor: "100000",
  notes: "Design retainer, October",
  dueDate: "2026-11-04",
  status: "paid",
  source: "dashboard",
  reference: null,
  recurrence: "none",
  nextIssueAt: null,
  paidReportedAt: null,
  receipts: [
    {
      reference: "58633414E8104382M",
      amountFormatted: "$200.00",
      at: "2026-11-08T09:23:30.157Z",
    },
  ],
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("the invoice pdf", () => {
  it("renders a real PDF", async () => {
    const doc = await renderInvoicePdf(invoice());
    const bytes = doc.output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // Every PDF begins with this. A jsPDF that threw would never get here,
    // but a jsPDF that produced an empty document would.
    const head = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5));
    expect(head).toBe("%PDF-");
  });

  it("calls itself a receipt once paid, and does not before", async () => {
    const text = (d: Awaited<ReturnType<typeof renderInvoicePdf>>) =>
      new TextDecoder().decode(new Uint8Array(d.output("arraybuffer")));

    // The document's own title is the difference between a bill and the
    // proof you paid it, and it is the only thing a saved file carries
    // into someone's folder.
    expect(text(await renderInvoicePdf(invoice()))).toContain("Receipt");
    expect(
      text(await renderInvoicePdf(invoice({ status: "pending" }))),
    ).not.toContain("Receipt");
  });

  it("survives an invoice with no items and no notes", async () => {
    // An API checkout can carry neither, and a renderer that assumed one
    // would fail on the quietest invoice rather than the loudest.
    const doc = await renderInvoicePdf(
      invoice({ items: [], notes: "", receipts: [] }),
    );
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(1000);
  });
});
