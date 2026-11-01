# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Payus is a payments app: users get a @username, payment links, invoices and a merchant checkout API. The previous payment rail (an in-browser wallet) and every screen built on it were removed, so the repository is currently an application shell with no payment rail. `README.md` lists what still works and what is a placeholder; `docs/plan.md` is the dated work plan and the decisions already locked in; `docs/setup.md` is local setup, `docs/api.md` the widget and checkout API.

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
`(dashboard)/` is the signed-in group: dashboard, links, invoices, requests, developers (all `DashboardPlaceholder` for now) and settings (`SettingsDashboard`, real). Public: `/pay/[username]` and `/pay/[username]/[slug]` (`components/pay/PayPanel.tsx`), `/i/[token]` (`components/invoices/InvoicePanel.tsx`, served `no-referrer` + `noindex`), `/privacy`, `/unsubscribe/[token]`, and `/embed/*` — the only framable routes, driven by `public/embed.js` (no build step, no dependencies; keep it that way). API: `api/trpc/[trpc]`, `api/v1/checkouts` (REST, API-key auth), `api/cron/invoices` (`Authorization: Bearer $CRON_SECRET`, scheduled in `web/vercel.json`).

### Server
- tRPC `appRouter` in `src/server/root.ts`; modules in `src/server/modules/<name>/` split into `*.router.ts` (maps domain errors → `TRPCError`), `*.service.ts`, `*.schema.ts`, `*.errors.ts`. Modules: `accounts` (PIN escrow, passkey record, account type), `profiles` (signed @username claims, verified with `lib/usernameClaim.ts`), `paymentLinks`, `invoices` (one-off + recurring, reminders, `reportPayment`), `requests` (sealed ciphertext), `developer` (API keys, webhooks, checkouts), `notifications`. Shared infra in `src/server/lib/` (`privy.ts`, `email.ts` via Resend, `rateLimit.ts`) and `src/server/db/` (`schema.ts` for the tables, `client.ts` for the pooled Drizzle instance and `isUniqueViolation`).
- `protectedProcedure` requires a verified Privy access token (Bearer header or `privy-token` cookie, see `context.ts`). Privy is login only (embedded wallets off).
- Money is stored as integer minor units in strings (`amountMinor`, `totalMinor`, `paidMinor`) with an ISO 4217 `currency`; `features/invoices/money.ts` is the only place that parses or formats it. No floats.
- Env: public vars in `src/env.ts` (`NEXT_PUBLIC_PRIVY_APP_ID`), server-only in `src/env.server.ts` (`DATABASE_URL`, `CRON_SECRET`, `PRIVY_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`). Add new vars to the zod schema and `web/.env.example`. `next.config.mjs` also loads a repo-root `.env` before Next starts.
- Postgres via Drizzle: edit `src/server/db/schema.ts`, then `pnpm db:generate` (writes SQL to `web/drizzle/`) and `pnpm db:migrate`. Money columns are `numeric(20, 0)` minor units, which the driver returns as strings — the services and the API pass those strings around and only `features/invoices/money.ts` parses them.
- Claiming one row for a job (recurring invoices, reminders) goes through `claimOne` in `invoices.service.ts`: `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction, so a cron run and a dashboard visit cannot claim the same invoice.
- Auth routing: `web/src/middleware.ts` + `src/lib/auth-routes.ts` gate the dashboard routes on Privy cookies. Adding a dashboard route means adding it to `auth-routes.ts`, `navItems.ts` and `features/account/accountType.ts`.
- Headers in `next.config.mjs`: everything refuses framing except `/embed/*`; `/i/*` is `no-referrer` + `noindex`. (The COOP/COEP cross-origin isolation the WASM wallet needed is gone — don't reintroduce it without a reason.)

### Tests (`web/test`)
Vitest, flat files in `web/test/` (not colocated), `node` environment by default; component tests declare `// @vitest-environment happy-dom` and mount through `test/renderWithTRPC.tsx`. `server-only` is stubbed (`test/stubs/`); `@` aliases `web/src`. Service tests that need a real database use `test/helpers/pgTestDb.ts`: it creates a throwaway database, runs the migrations into it, and skips the whole file when no local Postgres is reachable (`PAYUS_TEST_DATABASE_URL`, default `postgres://localhost:5432/postgres`).

### UI
Tailwind v4 (`@tailwindcss/postcss`), shadcn-style primitives in `web/src/components/ui/` (incl. `glass.ts`), Base UI, lucide icons, GSAP/Motion, sonner toasts. Dashboard chrome: `AppShell` → `DashboardBackground` → `DashboardShell` (nav, mode toggle, account menu) with `DashboardPageHeader`, `DashboardNotice`, `styles.ts`. Landing uses `components/landing/` primitives (`Chrome`, `Nebula`, `DitherField`, `ScrollReveal`); the long narrative sections of the old product were deleted, `Hero.tsx` is a short replacement. `.agents/skills/` holds vendored UI skills (`ui-taste`, `ios-design`, symlinked from `.kiro/skills/`).

## Conventions
- Formatting: Biome (2-space, double quotes, organized imports).
- Commit messages in Indonesian, short and imperative, no co-author trailer.
- Remote: `origin` = github.com/maulana-tech/payus, working branch `zecathon` — rename the GitHub repository to match before pushing, it still carries the project's former name. Push only when asked. (This local directory is not itself a git checkout, so edits here have no undo.)
