// What this deployment can actually load.
//
// A route whose module graph throws on import never reaches its handler, so
// the platform answers with its own 500 page and the reason stays in a log
// nobody is looking at. This asks each piece separately, catches what it
// throws, and says the name.
//
// It never reports what a setting is, only that one is there — but even
// that is a map of the deployment, so it is behind the same bearer token
// the cron endpoints use. A caller who cannot open it learns something too:
// `CRON_SECRET` is not set.

import { cronAuthorized } from "@/server/lib/cronAuth";

export const dynamic = "force-dynamic";

/** Settings reported as present or absent. Never as values. */
const SETTINGS = [
  "DATABASE_URL",
  "CRON_SECRET",
  "DEMO_SECRET",
  "PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "PAYPAL_ENV",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BACKEND",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_URL",
  "TELEGRAM_BOT_TOKEN",
] as const;

/**
 * The pieces the failing routes are built from, asked one at a time and in
 * the order they depend on each other, so the first `false` is the answer
 * rather than one of several.
 */
const PIECES: [string, () => Promise<unknown>][] = [
  ["env.server", () => import("@/env.server")],
  ["db/client", () => import("@/server/db/client")],
  ["lib/paypal", () => import("@/server/lib/paypal")],
  ["lib/privy", () => import("@/server/lib/privy")],
  ["lib/claude", () => import("@/server/lib/claude")],
  ["lib/email", () => import("@/server/lib/email")],
  ["storefront/sanitize", () => import("@/server/modules/storefront/sanitize")],
  ["storefront/css", () => import("@/server/modules/storefront/css")],
  [
    "payments.service",
    () => import("@/server/modules/payments/payments.service"),
  ],
  ["demo/seed.service", () => import("@/server/modules/demo/seed.service")],
  ["server/context", () => import("@/server/context")],
  ["server/root (appRouter)", () => import("@/server/root")],
];

const said = (error: unknown) =>
  error instanceof Error
    ? `${error.name}: ${error.message}`.slice(0, 300)
    : String(error).slice(0, 300);

export async function GET(request: Request) {
  if (!cronAuthorized(request))
    return Response.json(
      { ok: false, error: "Authorization: Bearer $CRON_SECRET" },
      { status: 401 },
    );

  const loads: Record<string, string> = {};
  for (const [name, load] of PIECES) {
    try {
      await load();
      loads[name] = "ok";
    } catch (error) {
      loads[name] = said(error);
    }
  }

  // Reading a setting can throw too, because the schema parses rather than
  // reads — so this is asked after the modules, and caught the same way.
  let settings: Record<string, boolean> | string;
  try {
    const { getServerEnv } = await import("@/env.server");
    const env = getServerEnv() as Record<string, unknown>;
    settings = Object.fromEntries(
      SETTINGS.map((key) => [key, Boolean(env[key])]),
    );
  } catch (error) {
    settings = said(error);
  }

  const broken = Object.entries(loads).filter(([, value]) => value !== "ok");
  return Response.json(
    {
      ok: broken.length === 0 && typeof settings === "object",
      firstFailure: broken[0]?.[0] ?? null,
      loads,
      settings,
      node: process.version,
    },
    { status: 200 },
  );
}
