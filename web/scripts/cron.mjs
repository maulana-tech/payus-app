// Calls one of the app's cron routes with the shared secret. Used by the
// scheduled containers in render.yaml, which have no curl and should not
// need one. Exits non-zero on failure, so a missed run is visible as a
// failed job rather than a quiet success.
const job = process.argv[2];
const routes = {
  outbox: "/api/cron/outbox",
  invoices: "/api/cron/invoices",
};
const path = routes[job];
if (!path)
  throw new Error(
    `Unknown job "${job}". One of: ${Object.keys(routes).join(", ")}`,
  );

const base = (process.env.APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);
const url = `${base.startsWith("http") ? base : `https://${base}`}${path}`;

const response = await fetch(url, {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
});
const body = await response.text();
if (!response.ok) {
  console.error(`${job}: ${response.status} ${body.slice(0, 300)}`);
  process.exit(1);
}
console.log(`${job}: ${body.slice(0, 300)}`);
