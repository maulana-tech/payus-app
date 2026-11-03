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

> **Status: the rail works and all twelve seats are filled.** A payment goes
> through PayPal, posts itself to a double-entry ledger and settles the
> invoice, once, however many times the event is delivered. Six of the seats
> are deterministic code and six are Claude; every one of the six that thinks
> writes a proposal and stops, and a Guardian that is a plain function
> decides. Payouts are recorded as simulated until PayPal approves the
> permission on the account — labelled as such everywhere, never pretended.

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
  open it on a canvas — the page itself on one side, what makes it on the
  other — and publish when it reads right. Or start from one of five shops
  that already work: a coffee bar, a freelance practice, a tip jar, a warung
  menu, a class.
  Everything a payer sends is checked against the stored item — the page is
  never the authority on what something costs.

- **An Allocator that suggests how to divide what arrives.** It proposes; the
  Guardian decides whether the change applies now, waits for you, or is
  refused for taking too much.

- **A Reporter that cannot invent a figure.** Every number it is allowed to
  state is handed to it, and a number outside that list throws the whole
  report away — a correct subtraction included, because working one out is
  exactly what it must not do.

- **A Collector that knows when to stop.** It drafts the follow-up for an
  invoice that has gone quiet, in your voice. Whether to write at all is not
  its decision: settled, no address, not yet overdue, asked inside the last
  week, or asked three times already are all settled in code before the model
  is reached. It drafts; you send.

- **An Advisor that does not write the query.** Ask it something about your
  money and it picks one of six queries we wrote, we run it scoped to you,
  and the rows it read are shown under the answer. It has no write path of
  any kind, and a figure that is not in those rows throws the answer away.

- **Refunds that come out of the pots the money went into.** Tax set aside on
  a sale that was undone is not tax, so a refund reverses the split in
  proportion — read back from the settlement's own ledger entries, not
  recomputed from today's rules. Three refunds of a third add up to the
  capture exactly. The invoice is owed again, and no second receipt is sent.

- **Settlement and reconciliation.** The period by day — taken, fees,
  refunded, set aside, yours, released — and one line comparing the PayPal
  cash account's own movement against what those categories say it should
  have been. When they differ, the difference is shown, because a posting the
  report has no category for is the thing worth hearing about. Same numbers
  on screen, in the CSV and in the PDF.

- **Approvals in a chat.** Link a Telegram chat with a single-use code and
  what the Guardian holds arrives there with the buttons to decide it. The
  buttons call the same functions the dashboard's do, so the hash check, the
  expiry and the audit trail are identical.

- **A library for your own server.** [`@payus/js`](packages/js) — no
  dependencies, `fetch` and Web Crypto only, amounts never floats, and
  `constructEvent` throws rather than returning null, because acting on an
  unverified event is the one mistake worth designing against.

## What is deliberately not here

Yield and treasury, subscriptions, multi-currency, KYC, custody. An embedded
wallet: Payus moves money between PayPal accounts and a ledger, and holding
someone's funds is a different promise.

Without a model configured (`ANTHROPIC_API_KEY`, or Bedrock) the six thinking
seats are simply off and say so; the rail runs without them.

## Built with AI

Claude Code (Opus) wrote most of this repository alongside its author: the
commits, the tests and the documents are the record of that work. At runtime
the six thinking seats call Claude through the Anthropic API or Amazon
Bedrock — `web/src/server/lib/claude.ts` is the only place a model is
reached, and `docs/plan.md` has the measurements behind the model choice.

## Stack

Next.js 15 (App Router) · React 19 · tRPC 11 · Postgres (Drizzle ORM) ·
Privy · PayPal Orders v2 & Payouts · Claude (Anthropic API or Bedrock) ·
Tailwind v4 · AG Grid · CodeMirror · Biome · Vitest.

## Run it

See [`docs/setup.md`](docs/setup.md). For the widget and the checkout API,
[`docs/api.md`](docs/api.md).

```sh
pnpm install
cp web/.env.example web/.env.local   # Privy app id + DATABASE_URL
pnpm --filter web db:migrate
pnpm dev
```

To look around without setting up an identity provider, add
`NEXT_PUBLIC_DEMO_USER=demo` to `web/.env.local` and `POST /api/dev/seed`
— development only, and [`docs/setup.md`](docs/setup.md) says why that is
safe.

To deploy it, `render.yaml` is a blueprint for Render (web service, Postgres
and the two schedules) and the `Dockerfile` runs anywhere else. Migrations are
applied before the server accepts a request, and `/api/health` answers 200
only when the database answers too.

## License

See [LICENSE](LICENSE).
