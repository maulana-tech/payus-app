# Setup

How to run the app locally.

> **Status:** the previous payment rail (an in-browser wallet) and every
> screen that depended on it have been removed. What runs today is the shell:
> login and account unlock, usernames,
> payment links, invoices, encrypted requests, the merchant API with signed
> webhooks, and the embed widget — with no payment rail behind them.

## 1. Requirements

- Node 22+ and pnpm 10
- Postgres 14+: local, or a managed instance (Render, Neon, Supabase)
- A [Privy](https://dashboard.privy.io) app (login only)
- Optional: a [Resend](https://resend.com) API key for email notifications

## 2. Install

```sh
pnpm install
cp web/.env.example web/.env.local
```

## 3. Configure `web/.env.local`

### Privy

1. Create an app in the Privy dashboard and enable **Email** and **Google**
   (passkey login is optional).
2. Turn off embedded wallets. The app derives its own keys in the browser.
3. Under **Configuration → App settings → Allowed origins**, add
   `http://localhost:3000`. Without it the console shows `Origin not allowed`
   and sign-in does nothing.
4. Copy the app ID into `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_ID`, and the
   secret into `PRIVY_APP_SECRET`.

A valid app ID is also needed to run `pnpm build`: the Privy provider refuses
to initialize without one, and prerendering then fails.

### Postgres

Set `DATABASE_URL`, for example `postgres://localhost:5432/payus` or the
connection string of a managed instance. Create the database first, then
apply the schema:

```sh
createdb payus                      # or whatever the URL names
pnpm --filter web db:migrate        # applies web/drizzle/*.sql
```

On macOS with Homebrew, `brew install postgresql@17 && brew services start
postgresql@17` gets you a server. The formula is keg-only, so put its
binaries on your PATH (`export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"`)
before `createdb` and `psql`.

After editing `src/server/db/schema.ts`, run `pnpm --filter web db:generate`
to write a new SQL migration, then `db:migrate` again.

### Email notifications (optional)

`RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL`. Leave them empty to run without
email.

### PayPal (needed to take a payment)

1. Create a REST app at <https://developer.paypal.com> → Apps & Credentials
   (keep the **Sandbox** tab selected) and copy its client id and secret into
   `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID`.
2. Leave `PAYPAL_ENV=sandbox` until you mean to charge real cards.
3. Add a webhook on that app pointing at
   `https://<your-host>/api/webhooks/paypal` and subscribe it to
   **Payment capture completed**. Copy the webhook id into
   `PAYPAL_WEBHOOK_ID`.

Without `PAYPAL_WEBHOOK_ID` no event is trusted: the route verifies every
delivery with PayPal and answers 400 when it cannot. To receive webhooks on a
laptop, put a tunnel in front of it (`cloudflared tunnel --url
http://localhost:3000`) and register that hostname.

The app never trusts a webhook body for amounts. It stores the event under
its `event_id`, queues a job, and the worker reads the capture back from
PayPal before anything is posted to the ledger.

### Background work (recurring invoices, reminders, the money path)

`CRON_SECRET` protects two routes:

| Route | What it does | How often |
|---|---|---|
| `GET /api/cron/invoices` | issues due recurring invoices, sends overdue reminders | daily |
| `GET /api/cron/outbox` | runs queued money-path work (a confirmed capture becoming a paid invoice) | every minute |

`web/vercel.json` schedules the first one. The outbox route needs a schedule
of its own on the host (a Render cron job, or anything that can curl a URL
every minute). Locally you can call either by hand:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/invoices
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/outbox
```

## 4. Run

```sh
pnpm dev                 # http://localhost:3000
```

Sign in, unlock with a passkey or a 6-digit PIN, and claim a username. From
there the dashboard pages are placeholders waiting to be rebuilt; the server
modules behind them are live and reachable over tRPC.

## 5. Checks

```sh
pnpm --filter web test                  # vitest
pnpm --filter web exec tsc --noEmit     # types
pnpm --filter web biome:check           # lint + format
```

Service tests that need a database create a disposable one on a local
Postgres, migrate it, and drop it afterwards; they skip themselves when no
server is reachable (`PAYUS_TEST_DATABASE_URL`, default
`postgres://localhost:5432/postgres`).
