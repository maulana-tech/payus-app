"use client";

import {
  AllCommunityModule,
  type ColDef,
  colorSchemeDark,
  colorSchemeLight,
  type GridApi,
  type GridReadyEvent,
  ModuleRegistry,
  themeQuartz,
  type ValueFormatterParams,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo } from "react";
import { formatMinor } from "@/features/invoices/money";
import type { LedgerRow } from "./TransactionsScreen";

// AG Grid and its theme, kept in their own chunk: this is 300 kB that only
// the transactions page should ever download.

ModuleRegistry.registerModules([AllCommunityModule]);

/** The grid wears the dashboard's own tokens, so it follows light and dark. */
// The colour-scheme part has to go on BEFORE our params, not after: applied
// last it puts its own near-white back over them, which is how the grid came
// to sit on #fafafa while every panel around it was cream — and why axe could
// only report the header contrast as "needs review" rather than measure it
// (the mixed result arrives as `color(srgb …)`, which it cannot parse).
const PARAMS = {
  backgroundColor: "var(--dash-surface)",
  foregroundColor: "var(--dash-fg)",
  borderColor: "var(--dash-line-solid)",
  chromeBackgroundColor: "var(--dash-surface)",
  oddRowBackgroundColor: "var(--dash-surface)",
  rowHoverColor: "var(--dash-tint)",
  selectedRowBackgroundColor: "var(--dash-tint)",
  headerBackgroundColor: "var(--dash-surface)",
  headerTextColor: "var(--dash-ash)",
  headerFontWeight: 600,
  headerFontSize: "11px",
  cellFontFamily: "var(--font-landing-mono)",
  cellFontSize: "13px",
  rowHeight: "44px",
  wrapperBorder: false,
  wrapperBorderRadius: "0px",
  columnBorder: false,
  spacing: "7px",
} as const;

const lightTheme = themeQuartz.withPart(colorSchemeLight).withParams(PARAMS);
const darkTheme = themeQuartz.withPart(colorSchemeDark).withParams(PARAMS);

const money = (params: ValueFormatterParams<LedgerRow, string>) =>
  !params.value || params.value === "0"
    ? ""
    : formatMinor(BigInt(params.value), params.data?.currency ?? "USD");

const KIND_LABEL: Record<string, string> = {
  "payment.captured": "Payment taken",
  settlement: "Settlement",
  payout: "Payout",
  "payout.simulated": "Payout (simulated)",
};

export function TransactionsGrid({
  rows,
  quickFilter,
  mode,
  onReady,
}: {
  rows: LedgerRow[];
  quickFilter: string;
  mode: "light" | "dark";
  onReady: (api: GridApi<LedgerRow>) => void;
}) {
  const columns = useMemo<ColDef<LedgerRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "When",
        width: 170,
        valueFormatter: (p: ValueFormatterParams<LedgerRow, string>) =>
          p.value ? new Date(p.value).toLocaleString() : "",
        filter: "agDateColumnFilter",
        sort: "desc",
      },
      {
        field: "kind",
        headerName: "Transaction",
        width: 170,
        valueFormatter: (p: ValueFormatterParams<LedgerRow, string>) =>
          KIND_LABEL[p.value ?? ""] ?? p.value ?? "",
      },
      { field: "account", headerName: "Account", flex: 1, minWidth: 190 },
      {
        field: "debitMinor",
        headerName: "Debit",
        width: 130,
        type: "rightAligned",
        valueFormatter: money,
        filter: "agNumberColumnFilter",
      },
      {
        field: "creditMinor",
        headerName: "Credit",
        width: 130,
        type: "rightAligned",
        valueFormatter: money,
        filter: "agNumberColumnFilter",
      },
      { field: "ref", headerName: "For", width: 190 },
      {
        field: "txnId",
        headerName: "Transaction id",
        width: 230,
        headerTooltip:
          "Deterministic, and the ledger's idempotency key: the same id can only be posted once.",
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<LedgerRow>>(
    () => ({
      filter: true,
      sortable: true,
      resizable: true,
      suppressHeaderMenuButton: true,
    }),
    [],
  );

  const onGridReady = useCallback(
    (event: GridReadyEvent<LedgerRow>) => onReady(event.api),
    [onReady],
  );

  return (
    <AgGridReact<LedgerRow>
      theme={mode === "dark" ? darkTheme : lightTheme}
      rowData={rows}
      columnDefs={columns}
      defaultColDef={defaultColDef}
      quickFilterText={quickFilter}
      onGridReady={onGridReady}
      pagination
      paginationPageSize={25}
      paginationPageSizeSelector={[25, 50, 100]}
      domLayout="autoHeight"
      suppressCellFocus
      enableCellTextSelection
      overlayNoRowsTemplate="Nothing matches that filter."
    />
  );
}
