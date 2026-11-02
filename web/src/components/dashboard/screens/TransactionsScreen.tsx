"use client";

import type { GridApi } from "ag-grid-community";
import { Download, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { formatMinor } from "@/features/invoices/money";
import type { RouterOutputs } from "@/server/root";
import { trpc } from "@/trpc/react";
import { useDashMode } from "../DashboardBackground";
import { dashButtonSecondary, dashFocus } from "../styles";
import { EmptyState, Panel } from "./kit";

// Every posting, in a grid you can sort, filter and export. The rows are
// ledger entries, so both halves of a transaction are here — which is the
// point: the footer adds each column up and the two totals have to agree.

export type LedgerRow = RouterOutputs["ledger"]["entries"][number];

// AG Grid is ~300 kB; nothing outside this page should pay for it, and it
// has no server rendering to do.
const TransactionsGrid = dynamic(
  () => import("./TransactionsGrid").then((m) => m.TransactionsGrid),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-72 motion-safe:animate-pulse bg-(--dash-tint)"
        role="status"
        aria-busy="true"
        aria-label="Loading the grid"
      />
    ),
  },
);

export function TransactionsScreen() {
  const entries = trpc.ledger.entries.useQuery();
  const mode = useDashMode();
  const api = useRef<GridApi<LedgerRow> | null>(null);
  const [quickFilter, setQuickFilter] = useState("");

  const rows = entries.data ?? [];
  const totals = rows.reduce(
    (sum, row) => ({
      debit: sum.debit + BigInt(row.debitMinor),
      credit: sum.credit + BigInt(row.creditMinor),
    }),
    { debit: 0n, credit: 0n },
  );
  const balanced = totals.debit === totals.credit;

  return (
    <Panel
      title="Every posting"
      hint="Both halves of every transaction, newest first."
      action={
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-(--dash-ash)"
              aria-hidden="true"
            />
            <input
              type="search"
              value={quickFilter}
              onChange={(event) => setQuickFilter(event.target.value)}
              placeholder="Search postings"
              aria-label="Search postings"
              className={`h-10 w-52 rounded-full border border-(--dash-line-strong) bg-transparent pr-4 pl-9 text-sm text-(--dash-fg) placeholder:text-(--dash-ash) ${dashFocus}`}
            />
          </label>
          <button
            type="button"
            className={dashButtonSecondary}
            disabled={rows.length === 0}
            onClick={() =>
              api.current?.exportDataAsCsv({
                fileName: `payus-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
              })
            }
          >
            <Download aria-hidden="true" />
            CSV
          </button>
        </div>
      }
    >
      {entries.isLoading ? (
        <div className="px-5 py-12 text-center text-sm text-(--dash-ash)">
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No postings yet">
          The first payment you take writes the first lines here: cash in,
          PayPal&rsquo;s fee out, the rest owed onward to you.
        </EmptyState>
      ) : (
        <>
          <div className="border-t border-(--dash-line-solid)">
            <TransactionsGrid
              rows={rows}
              quickFilter={quickFilter}
              mode={mode}
              onReady={(ready) => {
                api.current = ready;
              }}
            />
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-(--dash-line-solid) px-5 py-4 text-sm">
            <span className="text-(--dash-ash)">
              {rows.length} posting{rows.length === 1 ? "" : "s"}
            </span>
            <span className="flex flex-wrap items-center gap-5 tabular-nums">
              <span>
                <span className="text-(--dash-ash)">Debit </span>
                {formatMinor(totals.debit)}
              </span>
              <span>
                <span className="text-(--dash-ash)">Credit </span>
                {formatMinor(totals.credit)}
              </span>
              <span className={balanced ? "" : "text-(--dash-err)"}>
                {balanced ? "Balanced" : "Out of balance"}
              </span>
            </span>
          </footer>
        </>
      )}
    </Panel>
  );
}
