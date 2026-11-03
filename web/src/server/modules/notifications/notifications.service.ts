import "server-only";
import { eq } from "drizzle-orm";
import { getServerEnv } from "../../../env.server";
import type { InvoiceView } from "../../../features/invoices/types";
import { APP_NAME } from "../../../lib/brand";
import { getDb, profiles } from "../../db/client";
import { buildEmailHtml, buildEmailText, sendEmail } from "../../lib/email";
import {
  findSettings,
  type NotificationEvents,
  recordNotificationLog,
} from "./notifications.repository";

type Email = { subject: string; title: string; message: string; path: string };

async function dispatch(params: {
  userId: string;
  eventKey: string;
  eventType: keyof NotificationEvents;
  email: Email;
}): Promise<void> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return;
  const settings = await findSettings(params.userId);
  if (!settings?.enabled || !settings.events[params.eventType]) return;
  if (
    !(await recordNotificationLog(
      params.eventKey,
      settings.email,
      params.eventType,
    ))
  )
    return; // already sent
  const appUrl = env.APP_URL || "http://localhost:3000";
  const content = {
    title: params.email.title,
    message: params.email.message,
    actionLabel: `Open ${APP_NAME}`,
    actionUrl: `${appUrl}${params.email.path}`,
    unsubscribeUrl: `${appUrl}/unsubscribe/${settings.unsubscribeToken}`,
  };
  await sendEmail({
    to: settings.email,
    subject: params.email.subject,
    html: buildEmailHtml(content),
    text: buildEmailText(content),
  });
}

/** Invoice reached "paid". */
export function notifyInvoicePaid(userId: string, invoice: InvoiceView) {
  return dispatch({
    userId,
    eventKey: `invoice-paid:${invoice.id}`,
    eventType: "invoicePaid",
    email: {
      subject: `Invoice ${invoice.number} has been paid`,
      title: `Invoice ${invoice.number} paid`,
      message: `Your invoice ${invoice.number} for ${invoice.totalFormatted} was paid.`,
      path: "/invoices",
    },
  });
}

/**
 * Receipt email to the invoice's client, if they left an address. The client
 * is not a user, so there are no settings; the event log keeps it to one email.
 */
export async function emailInvoiceClient(
  invoice: InvoiceView,
  clientEmail: string,
) {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return;
  if (
    !(await recordNotificationLog(
      `invoice-client:${invoice.id}`,
      clientEmail,
      "invoicePaid",
    ))
  )
    return;
  const appUrl = env.APP_URL || "http://localhost:3000";
  const content = {
    title: `Invoice ${invoice.number} is paid`,
    message: `Thanks for your payment of ${invoice.totalFormatted} to @${invoice.username}. Your receipt is ready to download.`,
    actionLabel: "View receipt",
    actionUrl: `${appUrl}/i/${invoice.token}`,
  };
  await sendEmail({
    to: clientEmail,
    subject: `Receipt for invoice ${invoice.number}`,
    html: buildEmailHtml(content),
    text: buildEmailText(content),
  });
}

/** Emails a client an invoice: a new one of a series, or a due reminder. */
async function emailInvoiceLink(
  invoice: InvoiceView,
  clientEmail: string,
  kind: "invoiceIssued" | "invoiceReminder",
) {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return;
  const key = `${kind === "invoiceIssued" ? "invoice-issued" : "invoice-reminder"}:${invoice.id}`;
  if (!(await recordNotificationLog(key, clientEmail, kind))) return;
  const appUrl = env.APP_URL || "http://localhost:3000";
  const content =
    kind === "invoiceIssued"
      ? {
          title: `Invoice ${invoice.number} from @${invoice.username}`,
          message: `A new invoice for ${invoice.totalFormatted} is due on ${invoice.dueDate}.`,
          actionLabel: "View invoice",
          actionUrl: `${appUrl}/i/${invoice.token}`,
        }
      : {
          title: `Invoice ${invoice.number} is overdue`,
          message: `A friendly reminder: invoice ${invoice.number} from @${invoice.username} was due on ${invoice.dueDate}.`,
          actionLabel: "Pay invoice",
          actionUrl: `${appUrl}/i/${invoice.token}`,
        };
  await sendEmail({
    to: clientEmail,
    subject: content.title,
    html: buildEmailHtml(content),
    text: buildEmailText(content),
  });
}

export const emailNewInvoice = (invoice: InvoiceView, clientEmail: string) =>
  emailInvoiceLink(invoice, clientEmail, "invoiceIssued");

export const emailInvoiceReminder = (
  invoice: InvoiceView,
  clientEmail: string,
) => emailInvoiceLink(invoice, clientEmail, "invoiceReminder");

/** The Privy user behind a @username, or null when it doesn't exist. */
async function ownerOf(username: string) {
  const [row] = await getDb()
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1);
  return row ?? null;
}

/**
 * A payer pressed "I've paid" on a payment page. No amount, address or txid:
 * the server never learns those, and the email must not leak them either.
 */
export async function notifyPaymentPing(username: string, nonce: string) {
  const profile = await ownerOf(username);
  if (!profile) return;
  await dispatch({
    userId: profile.userId,
    eventKey: `payment-ping:${username}:${nonce}`,
    eventType: "paymentPing",
    email: {
      subject: "Someone says they paid you",
      title: "A payment is on its way",
      message: `A payer marked a payment to @${username} as sent. Open ${APP_NAME} to check it.`,
      path: "/dashboard",
    },
  });
}

/** Someone requested a payment from @to. The amount stays sealed. */
export async function notifyRequestReceived(
  to: string,
  from: string,
  id: string,
) {
  const profile = await ownerOf(to);
  if (!profile) return;
  await dispatch({
    userId: profile.userId,
    eventKey: `request-received:${id}`,
    eventType: "requestReceived",
    email: {
      subject: `@${from} requested a payment`,
      title: "New payment request",
      message: `@${from} sent you a payment request. Open ${APP_NAME} to see the details and pay.`,
      path: "/requests",
    },
  });
}

export async function sendTestEmail(userId: string): Promise<boolean> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return false;
  const settings = await findSettings(userId);
  if (!settings?.email) return false;
  const appUrl = env.APP_URL || "http://localhost:3000";
  const content = {
    title: `${APP_NAME} notification test`,
    message: "Your email notifications are set up.",
    actionLabel: "Open Settings",
    actionUrl: `${appUrl}/settings`,
    unsubscribeUrl: `${appUrl}/unsubscribe/${settings.unsubscribeToken}`,
  };
  const res = await sendEmail({
    to: settings.email,
    subject: `${APP_NAME}: test email`,
    html: buildEmailHtml(content),
    text: buildEmailText(content),
  });
  return res.ok;
}

/**
 * A letter the Collector drafted and the owner chose to send. Unlike the
 * automatic reminder this one is not deduplicated by invoice: the owner may
 * deliberately write a second and a third time, and the Collector's own
 * limit is what stops it going further.
 */
export async function emailCollectorLetter(input: {
  invoice: InvoiceView;
  clientEmail: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return false;
  const appUrl = env.APP_URL || "http://localhost:3000";
  const content = {
    title: input.subject,
    message: input.body,
    actionLabel: `Pay invoice ${input.invoice.number}`,
    actionUrl: `${appUrl}/i/${input.invoice.token}`,
  };
  await sendEmail({
    to: input.clientEmail,
    subject: input.subject,
    html: buildEmailHtml(content),
    text: buildEmailText(content),
  });
  return true;
}
