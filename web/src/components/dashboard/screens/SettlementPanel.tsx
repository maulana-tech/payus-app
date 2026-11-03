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
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm tabular-nums">
                  <thead>
                    <tr className="text-[11px] tracking-[0.1em] text-(--dash-ash) uppercase">
                      <th className="py-1.5 pr-4 text-left font-semibold">
                        Day
                      </th>
                      {[
                        "Taken",
                        "Fees",
                        "Refunded",
                        "Set aside",
                        "Yours",
                        "Released",
                      ].map((label) => (
                        <th key={label} className="py-1.5 pl-4 font-semibold">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => (
                      <tr
                        key={day.day}
                        className="border-t border-(--dash-line)"
                      >
                        <td className="py-1.5 pr-4 text-left">{day.day}</td>
                        <td className="py-1.5 pl-4">
                          {formatMinor(BigInt(day.takenMinor))}
                        </td>
                        <td className="py-1.5 pl-4">
                          {formatMinor(BigInt(day.feesMinor))}
                        </td>
                        <td className="py-1.5 pl-4">
                          {formatMinor(BigInt(day.refundedMinor))}
                        </td>
                        <td className="py-1.5 pl-4">
                          {formatMinor(BigInt(day.setAsideMinor))}
                        </td>
                        <td className="py-1.5 pl-4">
                          {formatMinor(BigInt(day.yoursMinor))}
                        </td>
                        <td className="py-1.5 pl-4">
                          {formatMinor(BigInt(day.paidOutMinor))}
                          {BigInt(day.simulatedOutMinor) > 0n ? (
                            <span className="text-(--dash-ash)">
                              {" "}
                              +{formatMinor(BigInt(day.simulatedOutMinor))}{" "}
                              simulated
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-(--dash-line-solid) font-medium">
                      <td className="py-2 pr-4 text-left">Total</td>
                      <td className="py-2 pl-4">
                        {formatMinor(BigInt(data.totals.takenMinor))}
                      </td>
                      <td className="py-2 pl-4">
                        {formatMinor(BigInt(data.totals.feesMinor))}
                      </td>
                      <td className="py-2 pl-4">
                        {formatMinor(BigInt(data.totals.refundedMinor))}
                      </td>
                      <td className="py-2 pl-4">
                        {formatMinor(BigInt(data.totals.setAsideMinor))}
                      </td>
                      <td className="py-2 pl-4">
                        {formatMinor(BigInt(data.totals.yoursMinor))}
                      </td>
                      <td className="py-2 pl-4">
                        {formatMinor(BigInt(data.totals.paidOutMinor))}
                      </td>
                    </tr>
                  </tbody>
                </table>
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
