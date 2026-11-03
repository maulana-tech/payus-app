import { formatMinor } from "../features/invoices/money";
import { APP_NAME } from "./brand";
import { INVOICE_PDF_PALETTE as PALETTE } from "./invoicePdf";

// The settlement report as a page someone can file or send to an
// accountant. Same numbers as the screen and the CSV — all three read the
// one report object, so none of them can drift.

export type ReportRow = {
  day: string;
  takenMinor: string;
  feesMinor: string;
  refundedMinor: string;
  setAsideMinor: string;
  yoursMinor: string;
  paidOutMinor: string;
  simulatedOutMinor: string;
};

export type ReportData = {
  owner: string;
  from: string;
  to: string;
  days: ReportRow[];
  totals: Omit<ReportRow, "day">;
  reconciliation: {
    cashMovementMinor: string;
    expectedMinor: string;
    differenceMinor: string;
    balanced: boolean;
  };
};

const MARGIN = 48;
const money = (minor: string) => formatMinor(BigInt(minor));

const COLUMNS: { label: string; key: keyof Omit<ReportRow, "day"> }[] = [
  { label: "Taken", key: "takenMinor" },
  { label: "Fees", key: "feesMinor" },
  { label: "Refunded", key: "refundedMinor" },
  { label: "Set aside", key: "setAsideMinor" },
  { label: "Yours", key: "yoursMinor" },
  { label: "Released", key: "paidOutMinor" },
];

export async function renderSettlementPdf(data: ReportData) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  doc.setProperties({
    title: `${APP_NAME} settlement ${data.from} to ${data.to}`,
    author: APP_NAME,
    creator: APP_NAME,
  });

  doc.setFillColor(PALETTE.linen);
  doc.rect(0, 0, width, height, "F");

  doc.setTextColor(PALETTE.obsidian);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(20);
  doc.text("Settlement", MARGIN, MARGIN + 10);

  doc.setFontSize(10);
  doc.setTextColor(PALETTE.ash);
  doc.text(
    `@${data.owner} · ${data.from} to ${data.to} · every posting the ledger made`,
    MARGIN,
    MARGIN + 28,
  );

  const columnWidth = (width - MARGIN * 2 - 90) / COLUMNS.length;
  let y = MARGIN + 60;

  const row = (
    label: string,
    values: string[],
    options: { bold?: boolean } = {},
  ) => {
    doc.setFont("helvetica", options.bold ? "bold" : "normal");
    doc.setTextColor(options.bold ? PALETTE.obsidian : PALETTE.ash);
    doc.text(label, MARGIN, y);
    doc.setTextColor(PALETTE.obsidian);
    values.forEach((value, index) => {
      doc.text(value, MARGIN + 90 + columnWidth * (index + 1) - 6, y, {
        align: "right",
      });
    });
  };

  doc.setFontSize(9);
  row(
    "Day",
    COLUMNS.map((column) => column.label),
    { bold: true },
  );
  y += 8;
  doc.setDrawColor(PALETTE.line);
  doc.line(MARGIN, y, width - MARGIN, y);
  y += 16;

  doc.setFontSize(10);
  for (const day of data.days) {
    if (y > height - MARGIN - 80) {
      doc.addPage();
      doc.setFillColor(PALETTE.linen);
      doc.rect(0, 0, width, height, "F");
      y = MARGIN;
    }
    row(
      day.day,
      COLUMNS.map((column) => money(day[column.key])),
    );
    y += 18;
  }

  y += 6;
  doc.line(MARGIN, y, width - MARGIN, y);
  y += 18;
  row(
    "Total",
    COLUMNS.map((column) => money(data.totals[column.key])),
    { bold: true },
  );

  y += 36;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(PALETTE.obsidian);
  doc.text("Reconciliation", MARGIN, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(PALETTE.ash);
  const lines = [
    `PayPal cash moved by ${money(data.reconciliation.cashMovementMinor)}.`,
    `Taken less fees, refunds and payouts comes to ${money(data.reconciliation.expectedMinor)}.`,
    data.reconciliation.balanced
      ? "The two agree: every posting in this period is accounted for above."
      : `They differ by ${money(data.reconciliation.differenceMinor)} — something posted that this report has no category for.`,
  ];
  for (const line of lines) {
    doc.text(line, MARGIN, y);
    y += 14;
  }

  if (BigInt(data.totals.simulatedOutMinor) > 0n) {
    y += 6;
    doc.text(
      `${money(data.totals.simulatedOutMinor)} of the releases were simulated: recorded, but not sent, because Payouts is not approved on this PayPal account.`,
      MARGIN,
      y,
    );
  }

  return doc;
}

export async function downloadSettlementPdf(data: ReportData) {
  const doc = await renderSettlementPdf(data);
  doc.save(`settlement-${data.from}-to-${data.to}.pdf`);
}

/** The same report as a spreadsheet, headers included. */
export function settlementCsv(data: ReportData): string[][] {
  const header = ["Day", ...COLUMNS.map((column) => column.label), "Simulated"];
  const line = (day: ReportRow) => [
    day.day,
    ...COLUMNS.map((column) => money(day[column.key])),
    money(day.simulatedOutMinor),
  ];
  return [
    header,
    ...data.days.map(line),
    ["Total", ...line({ ...data.totals, day: "" }).slice(1)],
  ];
}
