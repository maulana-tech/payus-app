// Recurring invoices: the newest invoice of a series carries the schedule and
// the date its successor is issued. There are no pull payments, so a
// "subscription" is a fresh invoice each period, paid like any other.

export const RECURRENCES = ["none", "weekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** `day` (YYYY-MM-DD) moved one period ahead; months clamp to their last day. */
export function nextDay(day: string, recurrence: Recurrence): string {
  const [y, m, d] = day.split("-").map(Number);
  if (recurrence === "weekly") {
    const date = new Date(Date.UTC(y, m - 1, d + 7));
    return date.toISOString().slice(0, 10);
  }
  if (recurrence === "monthly") {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // last day of next month
    const date = new Date(Date.UTC(y, m, Math.min(d, last)));
    return date.toISOString().slice(0, 10);
  }
  return day;
}

/** When the next invoice of a series is issued, from this one's issue time. */
export function nextIssueAt(
  issuedAt: Date,
  recurrence: Recurrence,
): Date | null {
  if (recurrence === "none") return null;
  const day = nextDay(issuedAt.toISOString().slice(0, 10), recurrence);
  return new Date(`${day}${issuedAt.toISOString().slice(10)}`);
}

export const recurrenceLabel = (r: Recurrence) =>
  r === "weekly" ? "Repeats weekly" : r === "monthly" ? "Repeats monthly" : "";
