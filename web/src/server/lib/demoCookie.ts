import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/env.server";
import { DEMO_COOKIE, isDemoName } from "@/lib/demo";

// The cookie that says which demo sandbox a visitor is in.
//
// Signed, and read only on the server. Without a signature the value is a
// username in a text field anyone can edit, and one visitor could walk into
// another's sandbox by typing their name into devtools. Nothing valuable is
// in there — every demo account is sandbox money — but a demo where someone
// else's changes appear mid-look is a demo that has stopped demonstrating.

export { DEMO_COOKIE };
/** Long enough for a judge to come back tomorrow, short enough to expire. */
export const DEMO_COOKIE_MAX_AGE = 14 * 24 * 60 * 60;

function key(): string {
  const env = getServerEnv();
  // Falls back to the cron secret rather than inventing a second one to
  // forget: both are "this deployment's own", and neither leaves it.
  const secret = env.DEMO_SECRET || env.CRON_SECRET;
  if (!secret) throw new Error("No secret to sign the demo cookie with.");
  return secret;
}

const sign = (name: string) =>
  createHmac("sha256", key()).update(name).digest("base64url");

export const demoCookieValue = (name: string) => `${name}.${sign(name)}`;

/** The name inside a cookie, or null when it was not one of ours. */
export function demoNameFrom(value: string | undefined): string | null {
  if (!value) return null;
  const at = value.lastIndexOf(".");
  if (at <= 0) return null;
  const name = value.slice(0, at);
  const given = value.slice(at + 1);
  if (!isDemoName(name)) return null;
  const expected = sign(name);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    ? name
    : null;
}
