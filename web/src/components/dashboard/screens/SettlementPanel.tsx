"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { formatMinor } from "@/features/invoices/money";
import { toCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import {
  downloadSettlementPdf,
  type ReportData,
  settlementCsv,
} from "@/lib/settlementPdf";
import { trpc } from "@/trpc/react";
import { dashButtonSecondary } from "../styles";
import { ErrorNote, Panel } from "./kit";

// The period, settled. The screen, the CSV and the PDF are all written from
// the one report, so none of them can quietly disagree — and the line that
// matters is the last one, where the cash account's own movement is put
// against what the categories say it should have been.

const iso = (date: Date) => date.toISOString().slice(0, 10);

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: iso(from), to: iso(to) };
}

/** The six money columns, named once so the table and the phone layout
 * cannot drift apart. */
type MoneyRow = {
  takenMinor: string;
  feesMinor: string;
  refundedMinor: string;
  setAsideMinor: string;
  yoursMinor: string;
  paidOutMinor: string;
};

const COLUMNS: readonly { label: string; of: (row: MoneyRow) => string }[] = [
  { label: "Taken", of: (r) => r.takenMinor },
  { label: "Fees", of: (r) => r.feesMinor },
  { label: "Refunded", of: (r) => r.refundedMinor },
  { label: "Set aside", of: (r) => r.setAsideMinor },
  { label: "Yours", of: (r) => r.yoursMinor },
  { label: "Released", of: (r) => r.paidOutMinor },
];

function Simulated({ minor }: { minor: string }) {
  if (BigInt(minor) <= 0n) return null;
  return (
    <span className="text-(--dash-ash)">
      {" "}
      +{formatMinor(BigInt(minor))} simulated
    </span>
  );
}

/** One day (or the total) as a stack, for screens too narrow for a table. */
function DayCard({
  heading,
  row,
  simulatedOutMinor,
  strong = false,
}: {
  heading: string;
  row: MoneyRow;
  simulatedOutMinor?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "border-t border-(--dash-line-solid) pt-3 font-medium"
          : "border-t border-(--dash-line) pt-3"
      }
    >
      <p className="text-[11px] font-semibold tracking-[0.1em] text-(--dash-ash) uppercase">
        {heading}
      </p>
      <dl className="mt-2 grid gap-1.5">
        {COLUMNS.map((column) => (
          <div
            key={column.label}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="text-sm text-(--dash-ash)">{column.label}</dt>
            <dd className="text-sm tabular-nums">
              {formatMinor(BigInt(column.of(row)))}
              {column.label === "Released" && simulatedOutMinor ? (
                <Simulated minor={simulatedOutMinor} />
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function SettlementPanel({ owner }: { owner: string }) {
  const [range, setRange] = useState(defaultRange);
  const report = trpc.ledger.settlement.useQuery(range);

  const data: ReportData | null = report.data
    ? { owner, ...report.data }
    : null;

  return (
    <Panel
      title="Settlement"
      hint="Every posting in the period, by day, and whether it reconciles."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={dashButtonSecondary}
            disabled={!data}
            onClick={() =>
              data &&
              downloadText(
                `settlement-${data.from}-to-${data.to}.csv`,
                toCsv(settlementCsv(data)),
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download aria-hidden="true" />
            CSV
          </button>
          <button
            type="button"
            className={dashButtonSecondary}
            disabled={!data}
            onClick={() => data && void downloadSettlementPdf(data)}
          >
            <Download aria-hidden="true" />
            PDF
          </button>
        </div>
      }
    >
      <div className="grid gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <DatePicker
            value={range.from}
            onChange={(from) => setRange((r) => ({ ...r, from }))}
            max={range.to}
            className="w-44"
            aria-label="First day"
          />
          <span className="text-sm text-(--dash-ash)">to</span>
          <DatePicker
            value={range.to}
            onChange={(to) => setRange((r) => ({ ...r, to }))}
            min={range.from}
            className="w-44"
            aria-label="Last day"
          />
        </div>

        {report.error ? <ErrorNote>{report.error.message}</ErrorNote> : null}

        {data ? (
          data.days.length === 0 ? (
            <p className="text-sm text-(--dash-ash)">
              Nothing posted in those days.
            </p>
          ) : (
            <>
              {/* Seven money columns cannot be read on a 390px screen. A
                  phone gets the same figures stacked under each day — no
                  sideways scrolling inside a page that already scrolls, and
                  nothing to reach for with a keyboard. */}
              <table className="hidden w-full text-right text-sm tabular-nums sm:table">
                <thead>
                  <tr className="text-[11px] tracking-[0.1em] text-(--dash-ash) uppercase">
                    <th className="py-1.5 pr-4 text-left font-semibold">Day</th>
                    {COLUMNS.map((column) => (
                      <th
                        key={column.label}
                        className="py-1.5 pl-4 font-semibold"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.days.map((day) => (
                    <tr key={day.day} className="border-t border-(--dash-line)">
                      <td className="py-1.5 pr-4 text-left">{day.day}</td>
                      {COLUMNS.map((column) => (
                        <td key={column.label} className="py-1.5 pl-4">
                          {formatMinor(BigInt(column.of(day)))}
                          {column.label === "Released" ? (
                            <Simulated minor={day.simulatedOutMinor} />
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-(--dash-line-solid) font-medium">
                    <td className="py-2 pr-4 text-left">Total</td>
                    {COLUMNS.map((column) => (
                      <td key={column.label} className="py-2 pl-4">
                        {formatMinor(BigInt(column.of(data.totals)))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>

              <div className="grid gap-4 sm:hidden">
                {data.days.map((day) => (
                  <DayCard
                    key={day.day}
                    heading={day.day}
                    row={day}
                    simulatedOutMinor={day.simulatedOutMinor}
                  />
                ))}
                <DayCard heading="Total" row={data.totals} strong />
              </div>

              <p
                className={`text-sm ${
                  data.reconciliation.balanced
                    ? "text-(--dash-ash)"
                    : "text-(--dash-err)"
                }`}
                role="status"
              >
                {data.reconciliation.balanced
                  ? `Reconciled: PayPal cash moved by ${formatMinor(BigInt(data.reconciliation.cashMovementMinor))}, which is exactly what taken less fees, refunds and payouts comes to.`
                  : `Off by ${formatMinor(BigInt(data.reconciliation.differenceMinor))}: cash moved by ${formatMinor(BigInt(data.reconciliation.cashMovementMinor))} and these categories account for ${formatMinor(BigInt(data.reconciliation.expectedMinor))}. Something posted that this report has no category for.`}
              </p>
            </>
          )
        ) : null}
      </div>
    </Panel>
  );
}
