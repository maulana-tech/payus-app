<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/assets/payus-white.svg" />
    <img src="web/public/assets/payus.svg" alt="Payus" width="120" />
  </picture>
</p>

<h1 align="center">Payus</h1>

<p align="center">
  Get paid with a username, a link, an invoice or a widget.
</p>

---

> **Status: the rail works, the agents do not yet.** A payment goes through
> PayPal, posts itself to a double-entry ledger and settles the invoice,
> once, however many times the event is delivered. The agent team described
> on the landing page is being built on top of that.

## What works

- **Login and unlock.** Privy (email, Google, passkey) for identity, then a
  passkey (PRF) or a 6-digit PIN that derives an account master **in the
  browser**. Every other key (signing, messaging, local vault) is derived from
  it; nothing secret reaches the server.
- **Usernames.** `@username` is a claim signed by keys only the owner's
  browser can derive. The server stores the claim and its signature but
  cannot forge either.
- **Payment links, invoices, requests.** Reusable links with a fixed or open
  amount; one-off and recurring invoices with a public page at `/i/<token>`,
  overdue reminders and a scheduled job; payment requests between usernames,
  sealed with X25519 + AES-GCM so the server only sees who asked whom.
- **Taking a payment.** PayPal Orders v2: the payer approves, the capture is
  confirmed both by the browser and by webhook, and both paths converge on
  one writer. The amounts are read back from PayPal, never taken from the
  webhook body.
- **A real ledger.** Double entry in integer minor units. A transaction that
  does not balance is refused before the database is touched, and a
  transaction id posts exactly once, so a replayed event writes nothing.
- **Splitting and releasing.** Money that arrives is divided by your own
  rules — a share for tax, a pot of your own, a platform fee — with
  percentages settled by largest remainder so no cent is lost. What is left
  is yours to release, and the same release cannot be sent twice.
- **Merchant API.** API keys, `POST /api/v1/checkouts`, and webhooks signed
  Stripe-style (`Payus-Signature: t=…,v1=…`) with retries and a delivery log.
- **Embed widget.** `public/embed.js`, one script tag, no build step.
- **Money as integers.** Minor units (cents) plus an ISO 4217 code, never
  floats.

## What is not built yet

The agents. Twelve seats are described on the landing page and five of them
are real code running today (taking the payment, carrying the webhook,
keeping the books, telling your server, writing the invoices). The Guardian
— the deterministic engine that accepts or refuses a proposal — and the
seven language-model seats above it are the work in
[`docs/plan.md`](docs/plan.md).

Refunds after settlement. That one is a policy question — a rolling reserve,
or letting what you are owed go negative — and it is being decided rather
than guessed at.

## Stack

Next.js 15 (App Router) · React 19 · tRPC 11 · Postgres (Drizzle ORM) ·
Privy · Tailwind v4 · Biome · Vitest.

## Run it

See [`docs/setup.md`](docs/setup.md). For the widget and the checkout API,
[`docs/api.md`](docs/api.md).

```sh
pnpm install
cp web/.env.example web/.env.local   # Privy app id + DATABASE_URL
pnpm --filter web db:migrate
pnpm dev
```

## License

See [LICENSE](LICENSE).
