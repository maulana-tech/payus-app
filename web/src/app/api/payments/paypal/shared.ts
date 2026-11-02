import { PaypalApiError } from "@/server/lib/paypal";

export const payError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

/** A per-payer bucket for rate limiting: the proxy's client address. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** PayPal's own failures are theirs to own, not a 500 of ours. */
export function paypalFailure(error: unknown): Response | null {
  if (!(error instanceof PaypalApiError)) return null;
  return payError(502, "provider_error", "PayPal rejected the request.");
}
