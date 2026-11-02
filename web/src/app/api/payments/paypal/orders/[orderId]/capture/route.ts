import { paypalConfigured } from "@/server/lib/paypal";
import { rateLimit } from "@/server/lib/rateLimit";
import {
  InvoiceNotPayableError,
  PaymentNotFoundError,
} from "@/server/modules/payments/payments.errors";
import { capturePaypalOrder } from "@/server/modules/payments/payments.service";
import { clientKey, payError, paypalFailure } from "../../../shared";

// Called by the payer's browser once PayPal reports the order approved.
// Capturing is idempotent on PayPal's side and on ours, so a double click,
// a refresh, or the webhook arriving first all end at the same state.
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  if (!paypalConfigured())
    return payError(503, "paypal_not_configured", "Payments are not set up.");
  if (!rateLimit(`pay:capture:${clientKey(request)}`, 20, 60_000).ok)
    return payError(429, "rate_limited", "Too many attempts; wait a minute.");

  const { orderId } = await params;
  if (!/^[A-Za-z0-9-]{5,64}$/.test(orderId))
    return payError(400, "invalid_request", "Malformed order id.");
  try {
    const result = await capturePaypalOrder(orderId);
    return Response.json({
      status: "captured",
      invoice_id: result.invoiceId,
      paid_minor: result.paidMinor,
      became_paid: result.becamePaid,
    });
  } catch (error) {
    if (error instanceof PaymentNotFoundError)
      return payError(404, "not_found", error.message);
    if (error instanceof InvoiceNotPayableError)
      return payError(409, "not_payable", error.message);
    const provider = paypalFailure(error);
    if (provider) return provider;
    throw error;
  }
}
