import { createHmac, timingSafeEqual } from "node:crypto";

// Webhook signatures, Stripe-style: `Payus-Signature: t=<unix>,v1=<hex>` where
// v1 = HMAC-SHA256(secret, `${t}.${body}`). Receivers recompute it and reject
// stale timestamps to stop replays.

export const SIGNATURE_HEADER = "Payus-Signature";
export const SIGNATURE_TOLERANCE_S = 300;

export function signWebhook(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** What a merchant runs on their server (also used by our tests). */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=", 2) as [string, string]),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now - t) > SIGNATURE_TOLERANCE_S)
    return false;
  const expected = Buffer.from(signWebhook(secret, body, t).split("v1=")[1]);
  const given = Buffer.from(parts.v1 ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
