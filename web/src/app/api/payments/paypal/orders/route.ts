import { z } from "zod";
import { paypalConfigured } from "@/server/lib/paypal";
import { rateLimit } from "@/server/lib/rateLimit";
import {
  InvoiceNotPayableError,
  PaymentNotFoundError,
} from "@/server/modules/payments/payments.errors";
import { startPaypalOrder } from "@/server/modules/payments/payments.service";
import { clientKey, payError, paypalFailure } from "../shared";

// Opened by the payer on a public invoice page: creates the PayPal order for
// what is still due. No session — the invoice token is the capability.
export const dynamic = "force-dynamic";

const body = z.object({ token: z.string().min(8).max(128) }).strict();

export async function POST(request: Request) {
  if (!paypalConfigured())
    return payError(503, "paypal_not_configured", "Payments are not set up.");
  if (!rateLimit(`pay:order:${clientKey(request)}`, 20, 60_000).ok)
    return payError(429, "rate_limited", "Too many attempts; wait a minute.");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return payError(400, "invalid_request", "Send { token }.");
  try {
    const order = await startPaypalOrder(parsed.data.token);
    return Response.json(order);
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
