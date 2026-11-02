import { z } from "zod";
import { paypalConfigured } from "@/server/lib/paypal";
import { rateLimit } from "@/server/lib/rateLimit";
import {
  InvoiceNotPayableError,
  PaymentNotFoundError,
} from "@/server/modules/payments/payments.errors";
import { startStorefrontOrder } from "@/server/modules/payments/payments.service";
import { clientKey, payError, paypalFailure } from "../shared";

// Buying one item from a storefront. The item's price comes from the stored
// configuration, never from the browser — all the page may send is which
// item, and an amount when that item lets the payer choose.
export const dynamic = "force-dynamic";

const body = z
  .object({
    slug: z.string().min(3).max(40),
    productId: z.string().min(4).max(24),
    amount: z.string().max(20).optional(),
  })
  .strict();

export async function POST(request: Request) {
  if (!paypalConfigured())
    return payError(503, "paypal_not_configured", "Payments are not set up.");
  if (!rateLimit(`pay:shop:${clientKey(request)}`, 20, 60_000).ok)
    return payError(429, "rate_limited", "Too many attempts; wait a minute.");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return payError(
      400,
      "invalid_request",
      "Send { slug, productId, amount? }.",
    );
  try {
    return Response.json(await startStorefrontOrder(parsed.data));
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
