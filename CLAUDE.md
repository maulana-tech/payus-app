# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Payus is a payments app: users get a @username, payment links, invoices and a merchant checkout API, paid through PayPal and recorded in a double-entry ledger. The agent team described on the landing page is not built yet. `README.md` lists what works and what does not; `docs/plan.md` is the dated work plan and the decisions already locked in; `docs/setup.md` is local setup, `docs/api.md` the widget and checkout API.

When adding a payment rail, put the integration behind the existing modules (invoices, paymentLinks, developer/checkouts) rather than threading a provider SDK through the UI.

## Commands

pnpm workspace (only `web`), Node 22+, pnpm 10. `pnpm` may not be on PATH — `corepack pnpm …` works.

```sh
pnpm install
pnpm dev                                  # Next.js on :3000
pnpm --filter web test                    # vitest run (also test:watch, test:coverage)
pnpm --filter web exec vitest run test/money.test.ts       # single test file
pnpm --filter web exec vitest run -t "name"                # single test by name
pnpm --filter web exec tsc --noEmit       # typecheck
pnpm --filter web biome:check             # biome lint+format check (biome:fix to apply)
pnpm --filter web build                   # standalone output in .next
pnpm --filter web build:local             # non-standalone build in .next-local (start:local to run)
pnpm --filter web db:migrate              # applies web/drizzle/*.sql to DATABASE_URL (reads .env.local)
pnpm --filter web db:generate             # regenerates a migration after editing schema.ts
```

`pnpm build` needs a syntactically valid `NEXT_PUBLIC_PRIVY_APP_ID` (25 chars): the Privy provider refuses to initialize without one and prerendering fails. `migrate:up` must run before the first boot — it creates the collections and indexes. Biome is the linter/formatter of record; `pnpm lint` (`next lint` + `.eslintrc.json`) is secondary. `web/scripts/webhook-receiver.mjs` is a local sink for testing webhooks.

## Architecture

### Session and keys (client)
- `web/src/components/SessionProvider.tsx` owns the session: Privy login → passkey (PRF) or PIN unlock → account master in a ref → username claim and account type. `useSession()` is what every screen consumes. Masters and derived keys stay in page memory; never send them to the server or persist them unencrypted.
- `web/src/lib/`: `passkey.ts` (PRF) and `keys.ts` (PIN escrow, Argon2id) produce the master; `derive.ts` HKDFs it into the signing seed, the messaging secret and a local-vault key; `signing.ts` (Ed25519) and `usernameClaim.ts` sign and verify the `@username → keys` claim; `sealedBox.ts` is anonymous X25519→AES-GCM for payloads the server only stores as ciphertext (payment requests); `crypto.ts`, `ids.ts` (base62 public ids), `invoicePdf.ts`, `paymentLinks.ts`, `csv.ts`, `auth-routes.ts`, `brand.ts`.
- `lib/brand.ts` holds `APP_NAME` and `KEY_NS`. `KEY_NS` feeds key derivation: changing it after launch makes every existing key and ciphertext unreadable.

### Domain logic (`web/src/features/`)
Framework-free modules shared by routes, components and the server: `invoices` (`money.ts` minor-unit parsing/formatting, `input.ts` zod schemas + totals, `recurrence.ts`, `types.ts`), `developer/signature.ts` (webhook HMAC, `Payus-Signature: t=…,v1=…`), `embed` (`bridge.ts`, `snippet.ts`), `account/accountType.ts` (which nav items each account type shows), `notifications`, `recovery`, `pwa`. Prefer adding logic here, and unit-testing it, over inside components or routers.

### Routes (`web/src/app/`)
`(dashboard)/` is the signed-in group: dashboard (`OverviewScreen`), links, invoices, requests, developers and settings — each page is a thin wrapper around `DashboardGuard` (sign-in redirect, loading skeleton, "claim a username first") plus one screen from `components/dashboard/screens/`. `DashboardPlaceholder` is what an unbuilt page uses; nothing uses it today. Public: `/pay/[username]` and `/pay/[username]/[slug]` (`components/pay/PayPanel.tsx`), `/i/[token]` (`components/invoices/InvoicePanel.tsx`, served `no-referrer` + `noindex`), `/privacy`, `/unsubscribe/[token]`, and `/embed/*` — the only framable routes, driven by `public/embed.js` (no build step, no dependencies; keep it that way). API: `api/trpc/[trpc]`, `api/v1/checkouts` (REST, API-key auth), `api/payments/paypal/orders` + `.../orders/[orderId]/capture` (public, the invoice token is the capability), `api/webhooks/paypal` (PayPal-verified), `api/cron/invoices` and `api/cron/outbox` (both `Authorization: Bearer $CRON_SECRET`; only the first is in `web/vercel.json`).

### Server
- tRPC `appRouter` in `src/server/root.ts`; modules in `src/server/modules/<name>/` split into `*.router.ts` (maps domain errors → `TRPCError`), `*.service.ts`, `*.schema.ts`, `*.errors.ts`. Modules: `accounts` (PIN escrow, passkey record, account type), `profiles` (signed @username claims, verified with `lib/usernameClaim.ts`), `paymentLinks`, `invoices` (one-off + recurring, reminders, `reportPayment`), `requests` (sealed ciphertext), `developer` (API keys, webhooks, checkouts), `notifications`, `ledger` (double-entry postings), `payments` (PayPal orders, captures, `applyInvoicePayment`), `outbox` (queued work + its handlers). Shared infra in `src/server/lib/` (`privy.ts`, `email.ts` via Resend, `rateLimit.ts`, `paypal.ts`, `cronAuth.ts`) and `src/server/db/` (`schema.ts` for the tables, `client.ts` for the pooled Drizzle instance and `isUniqueViolation`).
- `protectedProcedure` requires a verified Privy access token (Bearer header or `privy-token` cookie, see `context.ts`). Privy is login only (embedded wallets off).
- Money is stored as integer minor units in strings (`amountMinor`, `totalMinor`, `paidMinor`) with an ISO 4217 `currency`; `features/invoices/money.ts` is the only place that parses or formats it. No floats.
- Env: public vars in `src/env.ts` (`NEXT_PUBLIC_PRIVY_APP_ID`), server-only in `src/env.server.ts` (`DATABASE_URL`, `CRON_SECRET`, `PRIVY_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`). Add new vars to the zod schema and `web/.env.example`. `next.config.mjs` also loads a repo-root `.env` before Next starts.
- Postgres via Drizzle: edit `src/server/db/schema.ts`, then `pnpm db:generate` (writes SQL to `web/drizzle/`) and `pnpm db:migrate`. Money columns are `numeric(20, 0)` minor units, which the driver returns as strings — the services and the API pass those strings around and only `features/invoices/money.ts` parses them.
- Claiming one row for a job (recurring invoices, reminders) goes through `claimOne` in `invoices.service.ts`: `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction, so a cron run and a dashboard visit cannot claim the same invoice.
- `isUniqueViolation` walks the `cause` chain: Drizzle wraps driver errors, so the pg code `23505` is not on the error it hands you.
- Auth routing: `web/src/middleware.ts` + `src/lib/auth-routes.ts` gate the dashboard routes on Privy cookies. Adding a dashboard route means adding it to `auth-routes.ts`, `navItems.ts`, `features/account/accountType.ts` **and the literal `matcher` in `middleware.ts`** — Next needs a literal there, so `test/middleware.test.ts` is what keeps the two lists in step.
- Headers in `next.config.mjs`: everything refuses framing except `/embed/*`; `/i/*` is `no-referrer` + `noindex`. (The COOP/COEP cross-origin isolation the WASM wallet needed is gone — don't reintroduce it without a reason.)

### The Guardian
Nothing moves money without a proposal, and no proposal is decided by a model. `features/guardian/decide.ts` is a pure function — proposal + policy + context → `allow | ask | refuse` with a reason per rule — and `server/modules/guardian/` writes the proposal, records the decision, holds consent and runs it. The owner's own "Release" button goes through it, so the road the agents will take is already the one in daily use.
- **Consent is bound to a hash.** `proposalHash(kind, payload)` is sha256 over `canonical()` (keys sorted at every depth). `approvals` is a **log**, one row per act of consent, each naming the hash it was given for; `execute()` compares the newest approval's hash with the proposal's current hash and refuses on a mismatch (`approval.void` in the audit log). Amending a proposal moves the hash and puts it back to `awaiting`.
- **A refusal is a record, not an error to swallow.** A refused proposal is written with its findings before `ProposalRefusedError` is thrown.
- **Every rule is evaluated**, not just the first to fire, so the audit says everything that was wrong; the verdict is the harshest finding and `reason` quotes only the decisive ones.
- `intentKey` rides in the payload and so into the hash: submitting the same attempt twice finds the first proposal instead of writing a second. The proposal id then becomes the payout's `intentKey`, which is why an approved proposal can only ever pay once.
- `executeApproved()` is the door an executor knocks on (Phase 4's agents will), and the only place the hash check can catch a race.
- Proposals left unanswered are closed by `expireStaleProposals()`, called from `/api/cron/outbox`.

### The money path
A payment is four steps, and only the last two may change what anyone is owed:
1. **Order** — `POST /api/payments/paypal/orders` with an invoice token creates a PayPal order for what is still due and a `payments` row (`order_id` unique).
2. **Capture** — either the payer's browser calls `.../capture`, or PayPal's `PAYMENT.CAPTURE.COMPLETED` webhook arrives. Both converge on `recordCapture()`.
3. **Posting** — `recordCapture` posts the capture to the ledger (cash and the PSP fee in, the gross into `in_flight:<owner>`), marks the payment captured, and calls `applyInvoicePayment`, which is also what the dashboard's "mark as paid" uses. The merchant webhook, the owner's notification and the client's receipt fire once, on the transition to `paid`.
4. **Settlement** — `settleCapture()` divides `in_flight` by the owner's `split_rules` and credits each target. It runs inline for speed and, if that throws, is queued on `ledger.settle.capture` so money cannot sit in `in_flight` unnoticed. Releasing what is left goes through `releasePayout()`.

Rules that hold this together, and that a change must keep:
- **The ledger is the idempotency key.** `ledger.post(txn, postings)` refuses Σdebit ≠ Σcredit before touching the database and inserts a `ledger_txns` row whose id is deterministic (`capture:<captureId>`), so a replay returns `{ posted: false }` and writes nothing. `trialBalance()` must stay `0n`.
- **Account ids are derived, never typed.** Use the `account.*` helpers in `modules/ledger/accounts.ts`; the id (`<kind>`, `<kind>:<owner>`, `pos:<owner>:<slug>`) is what tells the ledger an account's kind and normal side. `balance()` reports in that normal direction, so assets and liabilities both read positive; `rawBalance()` is debit − credit.
- **A webhook body is a hint, not a number.** The route verifies the delivery with PayPal, stores it under its `event_id` (primary key ⇒ a redelivery is a no-op) and queues outbox work in the same transaction; the worker reads the capture back from PayPal for the amounts.
- **The invoice is reported with a sum, not a delta.** `capturedTotal()` adds up the captured `payments` rows, so re-running a job cannot double-count.
- Outbox jobs are claimed with `FOR UPDATE SKIP LOCKED`, retried with a growing delay, and parked as `failed` after 8 attempts. Due-ness is compared against the database clock (`now()`), not a JS `Date` — `available_at` has microsecond precision.
- **The split engine is pure.** `features/split/evaluate.ts` takes an amount and rules and returns allocations; it touches nothing. Percentages are of the whole amount (not the running remainder), the percentage group is settled with largest-remainder so no cent is lost or invented, a rule that asks for more than is left gets what is left, and the remainder is the owner's. The invariant every test checks first: Σ allocations === the amount in. `split.service.ts` reads the rules and resolves a target (`tax_reserve`, `platform_fee`, `merchant_payable`, `pos:<slug>`) to a ledger account.
- **A payout cannot be sent twice.** `sender_batch_id` is `sha256(owner|amount|currency|destination|intentKey)`, where `intentKey` identifies the *attempt* — a nonce the release dialog holds while it is open, and later the id of a Guardian-approved proposal. PayPal replays its batch for a repeated id, and the ledger transaction `payout:<batch>` refuses a second posting. Deriving it from ledger position does **not** work: the payout's own posting moves the position, so a retry would read as a new intent (this was tried and reverted).
- **An unsent payout posts nothing.** If PayPal refuses, the `payouts` row is marked `failed` with the reason and the ledger is untouched, because no money left. Without `PAYPAL_PAYOUTS_ENABLED=true` the release is deliberately recorded as `payout.simulated` and labelled as such in the UI — never as a real payout.

### Tests (`web/test`)
Vitest, flat files in `web/test/` (not colocated), `node` environment by default; component tests declare `// @vitest-environment happy-dom` and mount through `test/renderWithTRPC.tsx`. `server-only` is stubbed (`test/stubs/`); `@` aliases `web/src`. Service tests that need a real database use `test/helpers/pgTestDb.ts`: it creates a throwaway database, runs the migrations into it, and skips the whole file when no local Postgres is reachable (`PAYUS_TEST_DATABASE_URL`, default `postgres://localhost:5432/postgres`) — six files do, including `ledger.test.ts` and `moneyPath.test.ts`, so run the suite with a Postgres up or those guarantees go unchecked. `moneyPath.test.ts` stubs only `server/lib/paypal.ts`; verification, the ledger, idempotency and the invoice logic all run for real.

### Dashboard screens
`components/dashboard/screens/` holds one screen per page plus `kit.tsx` (Panel, Ledger/Cell, Stat, Money, StatusChip, CopyButton, ListRow, EmptyState, ErrorNote). `TransactionsScreen` is the one grid: **AG Grid** (community, `AllCommunityModule`) over `ledger.entries`, themed with `themeQuartz.withParams` pointed at the `--dash-*` variables so it follows the mode — which it learns from `useDashMode()` (reads `data-dash-mode` through a MutationObserver, unlike `useDashboardMode()` which owns the toggle's state). Its footer sums both columns; they must agree. The look is set by `components/dashboard/styles.ts` and the `--dash-*` tokens: pills for controls, sharp hairline cells for data, and **no hue** — status is shown by weight (filled ink = settled, hairline = open, faded = closed). The one exception is `--dash-err`, because a failure has to read as a failure. Screens read through `trpc.*` and invalidate `ledger.summary` whenever money moves.

### The landing (`components/landing/editorial/`)
A separate language from the app: ink field (`ed-dark-2`), hairline frame, full-bleed painted loops in `public/landing/`, oversized Cormorant serif, mono micro-labels. `agents.ts` is the twelve-seat table the pinned `council.tsx` pans across — a seat's `status` (`live` | `building`) is a factual claim about the repository, so change it only when the code changes. Films: `split` (hero and closing), `arrive` (the rail), `together` (the agents), `council` (the table).

### UI
Tailwind v4 (`@tailwindcss/postcss`), shadcn-style primitives in `web/src/components/ui/` (incl. `glass.ts`), Base UI, lucide icons, GSAP/Motion, sonner toasts. Dashboard chrome: `AppShell` → `DashboardBackground` → `DashboardShell` (nav, mode toggle, account menu) with `DashboardPageHeader`, `DashboardNotice`, `styles.ts`. Landing uses `components/landing/` primitives (`Chrome`, `Nebula`, `DitherField`, `ScrollReveal`); the long narrative sections of the old product were deleted, `Hero.tsx` is a short replacement. `.agents/skills/` holds vendored UI skills (`ui-taste`, `ios-design`, symlinked from `.kiro/skills/`).

## Conventions
- Formatting: Biome (2-space, double quotes, organized imports).
- Commit messages in Indonesian, short and imperative, no co-author trailer.
- Remote: `origin` = github.com/maulana-tech/payus, working branch `zecathon` — rename the GitHub repository to match before pushing, it still carries the project's former name. Push only when asked. (This local directory is not itself a git checkout, so edits here have no undo.)
