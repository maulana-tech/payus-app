import "server-only";
import { randomBytes } from "node:crypto";
import type { MongoServerError } from "mongodb";
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
import { getInvoices, type InvoiceDoc } from "../../db/mongo";
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

async function toView(doc: InvoiceDoc): Promise<InvoiceView> {
  return {
    id: doc._id,
    token: doc.token,
    username: doc.owner,
    number: doc.number,
    clientName: doc.clientName,
    items: doc.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: toDecimal(BigInt(i.unitMinor)),
    })),
    currency: doc.currency,
    totalMinor: doc.totalMinor,
    totalFormatted: formatMinor(BigInt(doc.totalMinor), doc.currency),
    paidMinor: doc.paidMinor,
    notes: doc.notes,
    dueDate: doc.dueDate,
    status: doc.status,
    source: doc.source ?? "dashboard",
    reference: doc.reference ?? null,
    recurrence: doc.recurrence ?? "none",
    nextIssueAt: doc.nextIssueAt?.toISOString() ?? null,
    paidReportedAt: doc.paidReportedAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
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

export async function createInvoice(
  owner: string,
  input: CreateInput,
): Promise<InvoiceView> {
  const now = new Date();
  const doc: InvoiceDoc = {
    _id: newId(),
    owner,
    number: input.number,
    token: randomBytes(24).toString("base64url"),
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
  };
  try {
    await (await getInvoices()).insertOne(doc);
  } catch (e) {
    if ((e as MongoServerError).code === 11000)
      throw new InvoiceNumberTakenError();
    throw e;
  }
  return toView(doc);
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
  const invoices = await getInvoices();
  const current = await invoices.findOne({ _id: id, owner });
  if (!current) throw new InvoiceNotFoundError();
  if (current.source === "api")
    throw new InvoiceLockedError(
      "Checkouts created with the API can't be edited.",
    );
  if (current.status !== "pending") throw new InvoiceClosedError();
  if (current.paidMinor !== "0")
    throw new InvoiceLockedError(
      "This invoice already received a payment, so it can't be changed. Void it and create a new one.",
    );
  const firstOfSeries = (current.seriesIndex ?? 1) === 1;
  try {
    const doc = await invoices.findOneAndUpdate(
      { _id: id, owner, status: "pending", paidMinor: "0" },
      {
        $set: {
          number: input.number,
          ...(firstOfSeries ? { seriesNumber: input.number } : {}),
          clientName: input.clientName,
          ...(keepClientEmail ? {} : { clientEmail: input.clientEmail }),
          ...pricing(input),
          notes: input.notes,
          dueDate: input.dueDate,
          reminderSentAt: null,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!doc)
      throw new InvoiceLockedError(
        "This invoice changed while you were editing it. Reload and try again.",
      );
    return toView(doc);
  } catch (e) {
    if ((e as MongoServerError).code === 11000)
      throw new InvoiceNumberTakenError();
    throw e;
  }
}

/**
 * Issues the next invoice of every series that is due (all owners, or one).
 * The schedule moves to the new invoice; claiming the due one atomically
 * keeps a cron run and a dashboard visit from issuing it twice.
 */
export async function issueDueRecurring(
  now = new Date(),
  owner?: string,
): Promise<{ invoice: InvoiceView; clientEmail: string | null }[]> {
  const invoices = await getInvoices();
  const issued: { invoice: InvoiceView; clientEmail: string | null }[] = [];
  for (;;) {
    const due = await invoices.findOneAndUpdate(
      {
        ...(owner ? { owner } : {}),
        recurrence: { $in: ["weekly", "monthly"] },
        nextIssueAt: { $lte: now },
        status: { $ne: "void" },
      },
      { $set: { recurrence: "none", nextIssueAt: null, updatedAt: now } },
      { returnDocument: "before" },
    );
    if (!due) break;
    const recurrence = due.recurrence ?? "none";
    const index = (due.seriesIndex ?? 1) + 1;
    const series = due.seriesNumber ?? due.number;
    const issuedAt = due.nextIssueAt ?? now;
    const child: InvoiceDoc = {
      _id: newId(),
      owner: due.owner,
      number: `${series}-${index}`,
      token: randomBytes(24).toString("base64url"),
      clientName: due.clientName,
      clientEmail: due.clientEmail,
      items: due.items,
      totalMinor: due.totalMinor,
      currency: due.currency,
      notes: due.notes,
      dueDate: nextDay(due.dueDate, recurrence),
      status: "pending",
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
      await invoices.insertOne(child).catch(async (e) => {
        // The owner already used this number by hand: keep it unique.
        if ((e as MongoServerError).code !== 11000) throw e;
        child.number = `${series}-${index}-${child._id.slice(0, 4)}`;
        await invoices.insertOne(child);
      });
    } catch (e) {
      // Put the schedule back so the next run retries.
      await invoices.updateOne(
        { _id: due._id },
        { $set: { recurrence, nextIssueAt: due.nextIssueAt ?? null } },
      );
      throw e;
    }
    issued.push({
      invoice: await toView(child),
      clientEmail: child.clientEmail,
    });
  }
  return issued;
}

/** Overdue, unpaid invoices whose client hasn't been reminded yet. */
export async function claimDueReminders(
  now = new Date(),
  owner?: string,
): Promise<{ invoice: InvoiceView; clientEmail: string }[]> {
  const invoices = await getInvoices();
  const today = now.toISOString().slice(0, 10);
  const out: { invoice: InvoiceView; clientEmail: string }[] = [];
  for (;;) {
    const doc = await invoices.findOneAndUpdate(
      {
        ...(owner ? { owner } : {}),
        status: "pending",
        dueDate: { $lt: today },
        clientEmail: { $ne: null },
        reminderSentAt: null, // also matches invoices from before reminders
      },
      { $set: { reminderSentAt: now } },
      { returnDocument: "after" },
    );
    if (!doc?.clientEmail) break;
    out.push({ invoice: await toView(doc), clientEmail: doc.clientEmail });
  }
  return out;
}

export async function stopRecurring(owner: string, id: string) {
  const doc = await (await getInvoices()).findOneAndUpdate(
    { _id: id, owner },
    { $set: { recurrence: "none", nextIssueAt: null, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!doc) throw new InvoiceNotFoundError();
  return toView(doc);
}

export async function listInvoices(owner: string): Promise<InvoiceView[]> {
  // Catch up on this owner's schedule even if the cron hasn't run.
  await runInvoiceSchedule(new Date(), owner).catch(() => {});
  const docs = await (await getInvoices())
    .find({ owner })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return Promise.all(docs.map(toView));
}

export async function voidInvoice(owner: string, id: string) {
  const doc = await (await getInvoices()).findOneAndUpdate(
    { _id: id, owner, status: "pending" },
    { $set: { status: "void", updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!doc) throw new InvoiceClosedError();
  return toView(doc);
}

/** Records a payment reported against this invoice. */
export async function reportPayment(
  owner: string,
  input: { id: string; paidMinor: string },
): Promise<{ invoice: InvoiceView; becamePaid: boolean }> {
  const invoices = await getInvoices();
  const current = await invoices.findOne({ _id: input.id, owner });
  if (!current) throw new InvoiceNotFoundError();
  if (current.status === "void") throw new InvoiceClosedError();
  const paid = BigInt(input.paidMinor);
  const status = paid >= BigInt(current.totalMinor) ? "paid" : "pending";
  const doc = await invoices.findOneAndUpdate(
    { _id: input.id, owner },
    {
      $set: {
        paidMinor: paid.toString(),
        status,
        paidReportedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!doc) throw new InvoiceNotFoundError();
  return {
    invoice: await toView(doc),
    becamePaid: current.status !== "paid" && status === "paid",
  };
}

export async function publicInvoice(
  token: string,
): Promise<InvoiceView | null> {
  const doc = await (await getInvoices()).findOne({ token });
  return doc ? toView(doc) : null;
}

export async function invoiceClientEmail(id: string): Promise<string | null> {
  return (
    (await (await getInvoices()).findOne({ _id: id }))?.clientEmail ?? null
  );
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
