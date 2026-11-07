import { newDemoName, publicDemo } from "@/lib/demo";
import {
  DEMO_COOKIE,
  DEMO_COOKIE_MAX_AGE,
  demoCookieValue,
  demoNameFrom,
} from "@/server/lib/demoCookie";
import { ensureDemoAccountFor } from "@/server/modules/demo/demo.service";
import { seedDemoAccount } from "@/server/modules/demo/seed.service";

// Where a visitor gets their own sandbox.
//
// One account each, because the alternative is three judges editing the
// same invoices and watching each other's changes appear. The name lives in
// a signed, http-only cookie: nothing valuable is behind it — every demo
// account is sandbox money — but a demo where someone else's work shows up
// mid-look is a demo that has stopped demonstrating.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!publicDemo())
    return Response.json({ error: "not_enabled" }, { status: 404 });

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEMO_COOKIE}=`))
    ?.slice(DEMO_COOKIE.length + 1);

  const existing = demoNameFrom(cookie && decodeURIComponent(cookie));
  if (existing) {
    // Already has one. Seeding is idempotent, but there is no reason to
    // walk the fixtures again on every page load.
    return Response.json({ username: existing, fresh: false });
  }

  const username = newDemoName();
  await ensureDemoAccountFor(username);
  const made = await seedDemoAccount(username);

  return Response.json(
    { username, fresh: true, made },
    {
      headers: {
        "set-cookie": [
          `${DEMO_COOKIE}=${encodeURIComponent(demoCookieValue(username))}`,
          "Path=/",
          `Max-Age=${DEMO_COOKIE_MAX_AGE}`,
          "HttpOnly",
          "SameSite=Lax",
          "Secure",
        ].join("; "),
      },
    },
  );
}

/**
 * Leaves the demo. The cookie is http-only, so the page cannot drop it
 * itself — and without a way out, a visitor who wants to sign in as
 * themselves is stuck in a sandbox they cannot leave.
 */
export async function DELETE() {
  if (!publicDemo())
    return Response.json({ error: "not_enabled" }, { status: 404 });
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": [
          `${DEMO_COOKIE}=`,
          "Path=/",
          "Max-Age=0",
          "HttpOnly",
          "SameSite=Lax",
          "Secure",
        ].join("; "),
      },
    },
  );
}
