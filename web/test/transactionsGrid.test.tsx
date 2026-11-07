// @vitest-environment happy-dom
import { screen, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { TransactionsScreen } from "../src/components/dashboard/screens/TransactionsScreen";
import { trpc } from "../src/trpc/react";
import { createTestQueryClient, renderWithTRPC } from "./renderWithTRPC";

// The grid is AG Grid's job; what this guards is ours: the postings reach it
// with both halves, the money is formatted, and the footer proves the
// transaction balances.
const entries = [
  {
    id: "e1",
    txnId: "capture:CAP-1",
    kind: "payment.captured",
    ref: "invoice:INV-1",
    memo: null,
    account: "paypal_cash",
    debitMinor: "14500",
    creditMinor: "0",
    currency: "USD",
    createdAt: "2026-11-02T09:00:00.000Z",
  },
  {
    id: "e2",
    txnId: "capture:CAP-1",
    kind: "payment.captured",
    ref: "invoice:INV-1",
    memo: null,
    account: "psp_fee",
    debitMinor: "500",
    creditMinor: "0",
    currency: "USD",
    createdAt: "2026-11-02T09:00:00.000Z",
  },
  {
    id: "e3",
    txnId: "capture:CAP-1",
    kind: "payment.captured",
    ref: "invoice:INV-1",
    memo: null,
    account: "in_flight:shop",
    debitMinor: "0",
    creditMinor: "15000",
    currency: "USD",
    createdAt: "2026-11-02T09:00:00.000Z",
  },
];

function renderGrid(rows: typeof entries) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(
    getQueryKey(trpc.ledger.entries, undefined, "query"),
    rows,
  );
  return renderWithTRPC(<TransactionsScreen />, { queryClient });
}

describe("transactions grid", () => {
  it("shows every posting and the totals that must agree", async () => {
    renderGrid(entries);

    // AG Grid fills its rows over several frames, so the first cell to
    // appear does not mean the last one has. Wait for the figure that needs
    // both a row and both footers — three $150.00 — and the rest is settled
    // by the time it is true.
    await waitFor(() => expect(screen.getAllByText("$150.00")).toHaveLength(3));
    expect(screen.getByText("paypal_cash")).toBeInTheDocument();
    expect(screen.getByText("psp_fee")).toBeInTheDocument();
    expect(screen.getByText("in_flight:shop")).toBeInTheDocument();
    expect(screen.getByText("$145.00")).toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();

    expect(screen.getByText("3 postings")).toBeInTheDocument();
    // Both totals read $150.00, so the one word that matters is "Balanced".
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.queryByText("Out of balance")).toBeNull();
  });

  it("says so when the two sides disagree", async () => {
    renderGrid([entries[0], entries[2]]); // the fee line missing
    await waitFor(() =>
      expect(screen.getByText("Out of balance")).toBeInTheDocument(),
    );
  });

  it("offers nothing to export until there is something", () => {
    renderGrid([]);
    expect(screen.getByText("No postings yet")).toBeInTheDocument();
  });
});
