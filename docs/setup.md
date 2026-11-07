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

Subscribe the same webhook to **Payment capture refunded** as well, which is
what tells the ledger a refund happened when it was issued from PayPal's own
dashboard rather than from here.

### Payouts (sending money out)

Payouts is a separate permission on a PayPal app, and an app that does not
have it fails only when you try to send. So the app asks instead: set
`PAYPAL_PAYOUTS_ENABLED=true`, open **Release** on the dashboard, and the
dialog says what PayPal answered — approved, refused (with PayPal's own
words), or not configured. Behind it is a free probe: reading a payout batch
id that cannot exist, where a 404 means the permission is there and a 403
means it is not.

Until it is approved, a release is still recorded — as `payout.simulated`,
labelled everywhere it appears — so the books stay true and the claim stays
honest.

The app never trusts a webhook body for amounts. It stores the event under
its `event_id`, queues a job, and the worker reads the capture back from
PayPal before anything is posted to the ledger.

### The agents (optional)

Either route works; without one, the agents are off and say so.

```sh
# Route 1 — the first-party Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Route 2 — Amazon Bedrock
ANTHROPIC_BACKEND=bedrock
BEDROCK_AWS_REGION=ap-southeast-2
BEDROCK_MODEL_ID=au.anthropic.claude-sonnet-4-6
```

Credentials for Bedrock come from the ordinary AWS chain: environment
variables, `AWS_PROFILE`, an IAM role, or a Bedrock API key in
`AWS_BEARER_TOKEN_BEDROCK`.

Two things catch people out:

- **Model ids differ by region.** The Messages endpoint serves bare ids
  (`anthropic.claude-opus-5-5`) from **us-east-1 only**; everywhere else you
  need an inference profile (`au.…` in Sydney, `us.…`, `global.…`), which
  goes through a different endpoint. The app picks the right client from the
  shape of the id.
- **An ACTIVE profile is not access.** A profile can be listed as ACTIVE in
  your region while the account still has no entitlement to the model behind
  it; the call then fails with `permission_error`. Grant it in the Bedrock
  console under **Model access**, in that region.

### Vercel instead of Render

It works, and two things that need care on Render come free here: there is no
Docker stage, and `NEXT_PUBLIC_*` is already present at build time, so the
PayPal and Privy ids need no build arguments. `next.config.mjs` turns the
standalone output off when `VERCEL=1`, which Vercel sets itself.

What does not come free is the outbox. `render.yaml` runs it **every minute**,
and that worker is what posts a capture whose payer closed the tab before the
browser could confirm, and what expires stale proposals. On Vercel:

- **Pro** — add it to `web/vercel.json` beside the daily invoice run:
  `{ "path": "/api/cron/outbox", "schedule": "* * * * *" }`. Vercel sends
  `Authorization: Bearer $CRON_SECRET` on its own once `CRON_SECRET` is set,
  which is exactly what the route checks.
- **Hobby** — a cron more frequent than daily is refused at deploy time, so
  point something external at it instead (a free scheduler, or a GitHub
  Actions workflow) with the same Bearer header. Leaving it unrun is the one
  choice to avoid: money stays in `in_flight` until something calls it.

Postgres is not included either way; Neon or Supabase both work, and
`DATABASE_URL` is all the app wants.

### Approvals on Telegram (optional)

Create a bot with [@BotFather](https://t.me/BotFather), put its token in
`TELEGRAM_BOT_TOKEN`, choose any long string for `TELEGRAM_WEBHOOK_SECRET`,
and point Telegram at the route:

```sh
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="https://<your-host>/api/webhooks/telegram" \
  -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
```

Then open **Settings → Approvals on Telegram**, press *Link a chat*, and send
the bot the `/start <code>` it gives you. The code works once and only for
that account. After that, anything the Guardian holds arrives in the chat
with Approve and Refuse on it.

A chat can do no more than you can: the buttons call the same
`approveProposal` / `refuseProposal` the dashboard calls, so the hash check,
the expiry and the audit trail are identical — the trail just records
`via: "telegram"`. Without a token the feature is off and the settings row
says so.

### Looking around without any keys

The dashboard needs an identity provider, which is a lot to set up just to
see the screens. So there is a demo account:

```sh
echo 'NEXT_PUBLIC_DEMO_USER=demo' >> web/.env.local
pnpm dev
curl -X POST http://localhost:3000/api/dev/seed
```

You are now signed in as `@demo`, with split rules, three invoices (one paid
through the rail and partly refunded), a payment link, a published shop at
`/shop/kopi-senja`, and a proposal the Guardian is holding. The seed is
idempotent — run it again and it adds only what is missing.

Two guards keep this where it belongs: the username has to be set
deliberately, and `NODE_ENV` has to be `development`, which a production
build hard-codes to `production`. `/api/dev/seed` answers 404 anywhere else,
and the real authentication checks are not loosened — the demo session
carries a genuine username claim and genuine keys.

### Deploying

`render.yaml` is a blueprint for [Render](https://render.com): the web
service, a Postgres 17 database, and the two schedules. Point Render at the
repository and it creates all four; the secrets are the entries marked
`sync: false`, which you paste once.

Anywhere else, the `Dockerfile` is self-contained:

```sh
docker build -t payus \
  --build-arg NEXT_PUBLIC_PRIVY_APP_ID=... \
  --build-arg NEXT_PUBLIC_PAYPAL_CLIENT_ID=... .

docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e APP_URL=https://pay.example.com \
  -e CRON_SECRET=... payus
```

Three things worth knowing:

- **The two `NEXT_PUBLIC_*` values are needed at build time**, not at run
  time: Next inlines them into the browser bundle. They are public ids, not
  secrets. Render passes a service's environment variables to the Docker
  build as build arguments, which is why the Dockerfile declares them as
  `ARG`; if your host does not, pass them with `--build-arg`.
- **Migrations run before the server accepts a request.** The entrypoint
  applies them and only then starts Next, so a deploy cannot serve a build
  against a schema it does not have. Set `RUN_MIGRATIONS=false` to take that
  into your own hands.
- **`/api/health`** answers 200 only when the database answers too; it is the
  health check path in the blueprint.

Afterwards, point the two webhooks at the new host: PayPal at
`/api/webhooks/paypal`, Telegram at `/api/webhooks/telegram`.

### Background work (recurring invoices, reminders, the money path)

`CRON_SECRET` protects two routes:

| Route | What it does | How often |
|---|---|---|
| `GET /api/cron/invoices` | issues due recurring invoices, sends overdue reminders | daily |
| `GET /api/cron/outbox` | runs queued money-path work (a confirmed capture becoming a paid invoice) | every minute |

`render.yaml` schedules both — as containers that share the app's image and
call the routes with `web/scripts/cron.mjs`, so a missed run shows up as a
failed job rather than a quiet success. (`web/vercel.json` schedules only
the first, for a Vercel deploy.) Locally you can call either by hand:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/invoices
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/outbox
```

## 4. Run

```sh
pnpm dev                 # http://localhost:3000
```

Sign in, unlock with a passkey or a 6-digit PIN, and claim a username. From
there the dashboard shows what you are owed and what the ledger says; the server
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
