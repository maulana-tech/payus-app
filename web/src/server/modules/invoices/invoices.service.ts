import "server-only";
import { randomBytes } from "node:crypto";
import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { invoiceTotal } from "../../../features/invoices/input";
import {
  type Currency,
  DEFAULT_CURRENCY,
  formatMinor,
  toDecimal,
  toMinor,
} from "../../../features/invoices/money";
import {
  nextDay,
  nextIssueAt,
  type Recurrence,
} from "../../../features/invoices/recurrence";
import type { InvoiceView } from "../../../features/invoices/types";
import { newId } from "../../../lib/ids";
import {
  getDb,
  type InvoiceRow,
  invoices,
  isUniqueViolation,
} from "../../db/client";
import {
  emailInvoiceReminder,
  emailNewInvoice,
} from "../notifications/notifications.service";
import {
  InvoiceClosedError,
  InvoiceLockedError,
  InvoiceNotFoundError,
  InvoiceNumberTakenError,
} from "./invoices.errors";

type CreateInput = {
  number: string;
  clientName: string;
  clientEmail: string | null;
  dueDate: string;
  notes: string;
  items: { description: string; quantity: number; unitPrice: string }[];
  currency?: Currency;
  recurrence?: Recurrence;
  source?: "dashboard" | "api";
  reference?: string | null;
};

function toView(row: InvoiceRow): InvoiceView {
  return {
    id: row.id,
    token: row.token,
    username: row.owner,
    number: row.number,
    clientName: row.clientName,
    items: row.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: toDecimal(BigInt(i.unitMinor)),
    })),
    currency: row.currency,
    totalMinor: row.totalMinor,
    totalFormatted: formatMinor(BigInt(row.totalMinor), row.currency),
    paidMinor: row.paidMinor,
    notes: row.notes,
    dueDate: row.dueDate,
    status: row.status,
    source: row.source ?? "dashboard",
    reference: row.reference ?? null,
    recurrence: row.recurrence ?? "none",
    nextIssueAt: row.nextIssueAt?.toISOString() ?? null,
    paidReportedAt: row.paidReportedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Stored line items and totals for the invoice currency. */
function pricing(input: Pick<CreateInput, "items" | "currency">) {
  return {
    items: input.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitMinor: toMinor(i.unitPrice).toString(),
    })),
    totalMinor: invoiceTotal(input.items).toString(),
    currency: input.currency ?? DEFAULT_CURRENCY,
  };
}

const newToken = () => randomBytes(24).toString("base64url");

export async function createInvoice(
  owner: string,
  input: CreateInput,
): Promise<InvoiceView> {
  const now = new Date();
  try {
    const [row] = await getDb()
      .insert(invoices)
      .values({
        id: newId(),
        owner,
        number: input.number,
        token: newToken(),
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        ...pricing(input),
        notes: input.notes,
        dueDate: input.dueDate,
        status: "pending",
        source: input.source ?? "dashboard",
        reference: input.reference ?? null,
        recurrence: input.recurrence ?? "none",
        nextIssueAt: nextIssueAt(now, input.recurrence ?? "none"),
        seriesNumber: input.number,
        seriesIndex: 1,
        reminderSentAt: null,
        paidMinor: "0",
        paidReportedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toView(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new InvoiceNumberTakenError();
    throw e;
  }
}

/**
 * Corrects a pending invoice before anyone pays it; the link and the
 * schedule stay the same.
 */
export async function updateInvoice(
  owner: string,
  id: string,
  input: Omit<CreateInput, "recurrence" | "source" | "reference">,
  keepClientEmail = false,
): Promise<InvoiceView> {
  const db = getDb();
  const [current] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.owner, owner)))
    .limit(1);
  if (!current) throw new InvoiceNotFoundError();
  if (current.source === "api")
    throw new InvoiceLockedError(
      "Checkouts created with the API can't be edited.",
    );
  if (current.status !== "pending") throw new InvoiceClosedError();
  if (BigInt(current.paidMinor) !== 0n)
    throw new InvoiceLockedError(
      "This invoice already received a payment, so it can't be changed. Void it and create a new one.",
    );
  const firstOfSeries = (current.seriesIndex ?? 1) === 1;
  try {
    // The guard repeats the checks above as a condition, so a payment or a
    // void that lands between the read and the write wins instead of being
    // overwritten.
    const [row] = await db
      .update(invoices)
      .set({
        number: input.number,
        ...(firstOfSeries ? { seriesNumber: input.number } : {}),
        clientName: input.clientName,
        ...(keepClientEmail ? {} : { clientEmail: input.clientEmail }),
        ...pricing(input),
        notes: input.notes,
        dueDate: input.dueDate,
        reminderSentAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.owner, owner),
          eq(invoices.status, "pending"),
          eq(invoices.paidMinor, "0"),
        ),
      )
      .returning();
    if (!row)
      throw new InvoiceLockedError(
        "This invoice changed while you were editing it. Reload and try again.",
      );
    return toView(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new InvoiceNumberTakenError();
    throw e;
  }
}

/**
 * Claims one invoice matching `where` and applies `set` to it, or returns
 * null when nothing matches. `FOR UPDATE SKIP LOCKED` is what keeps a cron
 * run and a dashboard visit from claiming the same row twice.
 */
async function claimOne(
  where: SQL<unknown> | undefined,
  order: PgColumn,
  set: Partial<InvoiceRow>,
): Promise<{ before: InvoiceRow; after: InvoiceRow } | null> {
  return getDb().transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(invoices)
      .where(where)
      .orderBy(asc(order))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!before) return null;
    const [after] = await tx
      .update(invoices)
      .set(set)
      .where(eq(invoices.id, before.id))
      .returning();
    return { before, after };
  });
}

/**
 * Issues the next invoice of every series that is due (all owners, or one).
 * The schedule moves to the new invoice.
 */
export async function issueDueRecurring(
  now = new Date(),
  owner?: string,
): Promise<{ invoice: InvoiceView; clientEmail: string | null }[]> {
  const db = getDb();
  const issued: { invoice: InvoiceView; clientEmail: string | null }[] = [];
  for (;;) {
    const claimed = await claimOne(
      and(
        ...(owner ? [eq(invoices.owner, owner)] : []),
        inArray(invoices.recurrence, ["weekly", "monthly"]),
        lte(invoices.nextIssueAt, now),
        ne(invoices.status, "void"),
      ),
      invoices.nextIssueAt,
      { recurrence: "none", nextIssueAt: null, updatedAt: now },
    );
    if (!claimed) break;
    const due = claimed.before;
    const recurrence = due.recurrence ?? "none";
    const index = (due.seriesIndex ?? 1) + 1;
    const series = due.seriesNumber ?? due.number;
    const issuedAt = due.nextIssueAt ?? now;
    const id = newId();
    const values = {
      id,
      owner: due.owner,
      number: `${series}-${index}`,
      token: newToken(),
      clientName: due.clientName,
      clientEmail: due.clientEmail,
      items: due.items,
      totalMinor: due.totalMinor,
      currency: due.currency,
      notes: due.notes,
      dueDate: nextDay(due.dueDate, recurrence),
      status: "pending" as const,
      recurrence,
      nextIssueAt: nextIssueAt(issuedAt, recurrence),
      seriesNumber: series,
      seriesIndex: index,
      reminderSentAt: null,
      paidMinor: "0",
      paidReportedAt: null,
      createdAt: issuedAt,
      updatedAt: now,
    };
    try {
      // The owner may already have used this number by hand: keep it unique.
      let [child] = await db
        .insert(invoices)
        .values(values)
        .onConflictDoNothing({ target: [invoices.owner, invoices.number] })
        .returning();
      if (!child)
        [child] = await db
          .insert(invoices)
          .values({ ...values, number: `${series}-${index}-${id.slice(0, 4)}` })
          .returning();
      issued.push({ invoice: toView(child), clientEmail: child.clientEmail });
    } catch (e) {
      // Put the schedule back so the next run retries.
      await db
        .update(invoices)
        .set({ recurrence, nextIssueAt: due.nextIssueAt ?? null })
        .where(eq(invoices.id, due.id));
      throw e;
    }
  }
  return issued;
}

/** Overdue, unpaid invoices whose client hasn't been reminded yet. */
export async function claimDueReminders(
  now = new Date(),
  owner?: string,
): Promise<{ invoice: InvoiceView; clientEmail: string }[]> {
  const today = now.toISOString().slice(0, 10);
  const out: { invoice: InvoiceView; clientEmail: string }[] = [];
  for (;;) {
    const claimed = await claimOne(
      and(
        ...(owner ? [eq(invoices.owner, owner)] : []),
        eq(invoices.status, "pending"),
        lt(invoices.dueDate, today),
        isNotNull(invoices.clientEmail),
        isNull(invoices.reminderSentAt),
      ),
      invoices.dueDate,
      { reminderSentAt: now, remindersSent: 1 },
    );
    const row = claimed?.after;
    if (!row?.clientEmail) break;
    out.push({ invoice: toView(row), clientEmail: row.clientEmail });
  }
  return out;
}

/**
 * Records that this client has been asked once more. Counting is the whole
 * of the Collector's limit, so it is written here and not left to the UI.
 */
export async function markChased(
  owner: string,
  id: string,
  now = new Date(),
): Promise<InvoiceView> {
  const [row] = await getDb()
    .update(invoices)
    .set({
      reminderSentAt: now,
      remindersSent: sql`${invoices.remindersSent} + 1`,
      updatedAt: now,
    })
    .where(and(eq(invoices.id, id), eq(invoices.owner, owner)))
    .returning();
  if (!row) throw new InvoiceNotFoundError();
  return toView(row);
}

export async function stopRecurring(owner: string, id: string) {
  const [row] = await getDb()
    .update(invoices)
    .set({ recurrence: "none", nextIssueAt: null, updatedAt: new Date() })
    .where(and(eq(invoices.id, id), eq(invoices.owner, owner)))
    .returning();
  if (!row) throw new InvoiceNotFoundError();
  return toView(row);
}

export async function listInvoices(owner: string): Promise<InvoiceView[]> {
  // Catch up on this owner's schedule even if the cron hasn't run.
  await runInvoiceSchedule(new Date(), owner).catch(() => {});
  const rows = await getDb()
    .select()
    .from(invoices)
    .where(eq(invoices.owner, owner))
    .orderBy(desc(invoices.createdAt))
    .limit(200);
  return rows.map(toView);
}

export async function voidInvoice(owner: string, id: string) {
  const [row] = await getDb()
    .update(invoices)
    .set({ status: "void", updatedAt: new Date() })
    .where(
      and(
        eq(invoices.id, id),
        eq(invoices.owner, owner),
        eq(invoices.status, "pending"),
      ),
    )
    .returning();
  if (!row) throw new InvoiceClosedError();
  return toView(row);
}

/** Records a payment reported against this invoice. */
export async function reportPayment(
  owner: string,
  input: { id: string; paidMinor: string },
): Promise<{ invoice: InvoiceView; becamePaid: boolean }> {
  const db = getDb();
  const [current] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, input.id), eq(invoices.owner, owner)))
    .limit(1);
  if (!current) throw new InvoiceNotFoundError();
  if (current.status === "void") throw new InvoiceClosedError();
  const paid = BigInt(input.paidMinor);
  const status = paid >= BigInt(current.totalMinor) ? "paid" : "pending";
  const now = new Date();
  const [row] = await db
    .update(invoices)
    .set({
      paidMinor: paid.toString(),
      status,
      paidReportedAt: now,
      updatedAt: now,
    })
    .where(and(eq(invoices.id, input.id), eq(invoices.owner, owner)))
    .returning();
  if (!row) throw new InvoiceNotFoundError();
  return {
    invoice: toView(row),
    becamePaid: current.status !== "paid" && status === "paid",
  };
}

export async function publicInvoice(
  token: string,
): Promise<InvoiceView | null> {
  const [row] = await getDb()
    .select()
    .from(invoices)
    .where(eq(invoices.token, token))
    .limit(1);
  return row ? toView(row) : null;
}

export async function invoiceClientEmail(id: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ clientEmail: invoices.clientEmail })
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  return row?.clientEmail ?? null;
}

/**
 * The schedule job: issue due recurring invoices and remind clients of
 * overdue ones, by email when configured. Run by the cron route for
 * everyone and when an owner opens their invoices.
 */
export async function runInvoiceSchedule(now = new Date(), owner?: string) {
  const issued = await issueDueRecurring(now, owner);
  const reminders = await claimDueReminders(now, owner);
  await Promise.allSettled([
    ...issued.flatMap(({ invoice, clientEmail }) =>
      clientEmail ? [emailNewInvoice(invoice, clientEmail)] : [],
    ),
    ...reminders.map(({ invoice, clientEmail }) =>
      emailInvoiceReminder(invoice, clientEmail),
    ),
  ]);
  return { issued: issued.length, reminded: reminders.length };
}
