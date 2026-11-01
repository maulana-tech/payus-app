// CSV for spreadsheets. Cells that a spreadsheet would run as a formula
// (payer-written text can start with "=") are prefixed with a quote mark.
const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/** The text with a leading quote mark if a spreadsheet would run it. */
export function csvSafe(value: string): string {
  return FORMULA.test(value) && !NUMBER.test(value) ? `'${value}` : value;
}

function cell(value: string): string {
  const safe = csvSafe(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: string[][]): string {
  return `${rows.map((r) => r.map(cell).join(",")).join("\n")}\n`;
}
