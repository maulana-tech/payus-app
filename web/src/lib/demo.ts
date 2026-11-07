// A way into the dashboard without a login provider, for looking at the
// screens on a developer's own machine.
//
// Two guards, not one. The username has to be set deliberately, and
// `process.env.NODE_ENV` has to be "development" — which a production build
// hard-codes to "production", so a stray variable in a deployed environment
// cannot switch this on. Both the browser and the server ask this same
// function, so there is one answer and not two.

import { env } from "@/env";

/** The username to act as, or null when the app is behaving normally. */
export function demoUser(): string | null {
  if (env.NODE_ENV !== "development") return null;
  const name = env.NEXT_PUBLIC_DEMO_USER?.trim().toLowerCase();
  return name && /^[a-z0-9_]{3,20}$/.test(name) ? name : null;
}

export const demoMode = () => demoUser() !== null;

/** The Privy user id a demo session stands in for. */
export const demoPrivyUserId = (username: string) => `demo:${username}`;

/**
 * The account master for a demo session. Derived from the username, so the
 * same demo account keeps the same keys between restarts — and obviously
 * never used anywhere real, because it is derived from nothing secret.
 */
export function demoMaster(username: string): Uint8Array {
  const master = new Uint8Array(32);
  const name = new TextEncoder().encode(`payus.demo.${username}`);
  for (let i = 0; i < master.length; i += 1)
    master[i] = (name[i % name.length] + i * 31) % 256;
  return master;
}

/**
 * The public demo: a sandbox anyone can walk into, one per visitor.
 *
 * Separate from the development shortcut above, and on purpose. That one
 * hands a developer a fixed account on their own machine. This one runs in
 * production, so it may not share an account between strangers and may not
 * touch anything that leaves the building — no real payout, no email, no
 * Telegram. `isDemoOwner` is what every one of those guards asks.
 *
 * The name carries a hyphen, which `usernameSchema` forbids. That is the
 * isolation: a demo account can never collide with one someone claimed,
 * and no amount of guessing lets a visitor land on a real person's rows.
 */
export const DEMO_PREFIX = "demo-";

/** Named here rather than beside the signing, which is server-only: the
 * middleware runs on the edge and may not import that file. */
export const DEMO_COOKIE = "payus-demo";

export const publicDemo = () => env.NEXT_PUBLIC_PUBLIC_DEMO === "true";

/** True for an account nothing real may be done with. */
export function isDemoOwner(owner: string): boolean {
  if (owner.startsWith(DEMO_PREFIX)) return true;
  const dev = demoUser();
  return dev !== null && owner === dev;
}

/** A visitor's own demo name. Short enough to read in a URL bar. */
export function newDemoName(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return (
    DEMO_PREFIX +
    Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
  );
}

export const isDemoName = (name: string) =>
  new RegExp(`^${DEMO_PREFIX}[a-z0-9]{8}$`).test(name);
