import { z } from "zod";
import { paypalConfigured } from "@/server/lib/paypal";
import { rateLimit } from "@/server/lib/rateLimit";
import {
  InvoiceNotPayableError,
  PaymentNotFoundError,
} from "@/server/modules/payments/payments.errors";
import { startLinkOrder } from "@/server/modules/payments/payments.service";
import { clientKey, payError, paypalFailure } from "../shared";

// Paying a payment link: the order is opened against a fresh invoice written
// from the link, so a link payment settles down exactly the same path.
export const dynamic = "force-dynamic";

const body = z
  .object({
    owner: z.string().min(1).max(40),
    slug: z.string().min(1).max(48),
    amount: z.string().max(20).optional(),
  })
  .strict();

export async function POST(request: Request) {
  if (!paypalConfigured())
    return payError(503, "paypal_not_configured", "Payments are not set up.");
  if (!rateLimit(`pay:link:${clientKey(request)}`, 20, 60_000).ok)
    return payError(429, "rate_limited", "Too many attempts; wait a minute.");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return payError(400, "invalid_request", "Send { owner, slug, amount? }.");
  try {
    return Response.json(await startLinkOrder(parsed.data));
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
