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

- **A Guardian that is a function, not a model.** Every movement of money
  is written as a proposal first and decided by deterministic rules against
  limits you set. Consent is bound to the hash of what you agreed to, so a
  proposal amended afterwards cannot inherit it.

- **An agent that proposes, and cannot do more than that.** The Payer reads
  the ledger and writes down what it would release. It holds no limits of its
  own, it may only name a destination you have already paid, and the shape of
  its answer is validated before the Guardian ever sees it.

- **A shop you can describe.** The Builder turns a sentence into a
  storefront: configuration filling templates we wrote, plus one block of
  prose that goes through a server-side sanitiser and renders in a sandboxed
  frame with no scripts. Four layouts, a palette to choose, quantities,
  sold-out items and bounds on what a payer may name. It writes a draft; you
  publish it.
  Everything a payer sends is checked against the stored item — the page is
  never the authority on what something costs.

- **An Allocator that suggests how to divide what arrives.** It proposes; the
  Guardian decides whether the change applies now, waits for you, or is
  refused for taking too much.

- **A Reporter that cannot invent a figure.** Every number it is allowed to
  state is handed to it, and a number outside that list throws the whole
  report away — a correct subtraction included, because working one out is
  exactly what it must not do.

## What is not built yet

Two more thinking seats — the Collector, which chases an overdue invoice,
and the Advisor, which answers questions about the books — are the work
left in
[`docs/plan.md`](docs/plan.md), along with approving from Telegram. Without
an `ANTHROPIC_API_KEY` the agents are simply off, and the rail runs without
them.

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
