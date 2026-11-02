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
