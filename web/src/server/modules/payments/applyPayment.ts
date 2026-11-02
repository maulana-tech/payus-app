import "server-only";
import { getServerEnv } from "../../../env.server";
import type { InvoiceView } from "../../../features/invoices/types";
import { toCheckout } from "../developer/checkouts";
import { deliverEvent } from "../developer/developer.service";
import {
  invoiceClientEmail,
  reportPayment,
} from "../invoices/invoices.service";
import {
  emailInvoiceClient,
  notifyInvoicePaid,
} from "../notifications/notifications.service";
import { userIdForUsername } from "../profiles/profiles.service";

// The one place a payment turns into a paid invoice. Both the dashboard
// ("mark as paid") and the money path (a captured PayPal order, through the
// outbox) come through here, so the merchant webhook, the owner's
// notification and the client's receipt email fire exactly once — on the
// transition to `paid`, whoever caused it.

export const appOrigin = () =>
  (getServerEnv().APP_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * Records `paidMinor` (absolute, not a delta) against the invoice and fans
 * out the side effects when it becomes paid. Side effects never fail the
 * call: the payment is already recorded and must not be rolled back.
 */
export async function applyInvoicePayment(
  owner: string,
  invoiceId: string,
  paidMinor: string,
  options: { privyUserId?: string; await?: boolean } = {},
): Promise<{ invoice: InvoiceView; becamePaid: boolean }> {
  const result = await reportPayment(owner, { id: invoiceId, paidMinor });
  if (!result.becamePaid) return result;
  const effects = fanOut(owner, invoiceId, result.invoice, options.privyUserId);
  // A request-bound caller lets these run in the background; a worker waits,
  // so a retry is not needed for work that already succeeded.
  if (options.await) await effects;
  else void effects;
  return result;
}

async function fanOut(
  owner: string,
  invoiceId: string,
  invoice: InvoiceView,
  privyUserId?: string,
) {
  const userId = privyUserId ?? (await userIdForUsername(owner));
  await Promise.allSettled([
    userId ? notifyInvoicePaid(userId, invoice) : Promise.resolve(),
    deliverEvent(
      owner,
      invoice.source === "api" ? "checkout.paid" : "invoice.paid",
      toCheckout(invoice, appOrigin()),
    ),
    invoiceClientEmail(invoiceId).then((email) =>
      email ? emailInvoiceClient(invoice, email) : undefined,
    ),
  ]);
}
