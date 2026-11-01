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

> **Status: no payment rail yet.** The previous one — an in-browser wallet
> and everything built on it (send, history, point of sale, payroll, claim
> links, receipt verification) — was removed. What remains is a working
> application shell with no way to move money, waiting for a payment
> provider to be wired in.

## What still works

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
- **Merchant API.** API keys, `POST /api/v1/checkouts`, and webhooks signed
  Stripe-style (`Payus-Signature: t=…,v1=…`) with retries and a delivery log.
- **Embed widget.** `public/embed.js`, one script tag, no build step.
- **Money as integers.** Minor units (cents) plus an ISO 4217 code, never
  floats.

## What was deliberately left as a placeholder

The dashboard pages (overview, links, invoices, requests, developers) render
the real shell, the auth guard and the username prompt, then a placeholder
body — their screens were written around the old in-browser wallet. Settings
is real:
account type, PIN change, email notifications, sign out.

The public pay and invoice pages resolve the username, link and invoice and
show the amount, then say the payment step is being rebuilt.

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
