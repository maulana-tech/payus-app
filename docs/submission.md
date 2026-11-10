# Payus — hackathon submission

> **Live demo:** [payus-plum.vercel.app](https://payus-plum.vercel.app) ·
> **Source:** [github.com/maulana-tech/payus-app](https://github.com/maulana-tech/payus-app) ·
> **Built for:** PayPal AI Hackathon 2026
>
> The short technical version is the [README](../README.md). This is the
> story: why we built it, what broke, and what we learned fixing it.

---

## Inspiration

Every "AI agent for your money" we looked at wanted the same thing first: a
key. A wallet, an API credential with write access, a bank connection with a
payment scope. The pitch was always the autonomy — it books, it pays, it
moves — and the safety was always a paragraph of prose about how carefully
the model had been instructed.

A prompt is not a security boundary. We wanted to find out whether you could
have the first thing without the second: a team of agents genuinely doing the
work around someone's money, while being **structurally incapable** of moving
any of it.

The person we kept picturing is a freelancer or a small merchant — the kind
of seller who gets paid four different ways in a month. A transfer from a
regular customer, an invoice to a client abroad, a link dropped into a
WhatsApp chat, cash at a market stall. Three of those four end with them
squinting at a screenshot to decide whether they have actually been paid.
Money lands in one balance, so the tax they meant to set aside is spent
before the quarter ends. Two invoices are late, and writing the second
reminder costs more in dread than the invoice is worth.

None of that is a missing feature. It is that **everything around a payment —
knowing it landed, dividing it, chasing it, writing it up — has to be redone
for every single payment**, at the worst possible moment. That work is
exactly what a model is good at. It is also work that does not require
custody of a single cent.

So the design question became the product: what has to be true for an agent
to be useful here *and* harmless?

## What it does

Payus is a payments app with **twelve seats at one table**. Six are plain
deterministic code and they are the ones on the money path. Six are Claude,
and every one of them writes something down and stops.

**Getting paid, four ways.** A `@username` claimed with a signature only the
owner's browser can produce. Reusable payment links with a fixed or open
amount. One-off and recurring invoices with a public page, overdue reminders,
PDF and CSV. A shop page with items, quantities and sold-out states. Plus a
checkout API and a one-script-tag widget for someone else's site. All of them
end at the same writer, `recordCapture()` — there is no second path into the
books.

**A ledger, not a reporting table.** Double entry in integer minor units. A
transaction that does not balance is refused before the database is touched;
a transaction id posts exactly once, so a replayed webhook writes nothing at
all. Money that arrives is divided by the owner's own rules — tax set aside,
a pot of their own, a platform fee — with percentages settled by largest
remainder so no cent is lost or invented. A refund comes back out of the pots
the capture went into, read from the settlement's own ledger entries rather
than recomputed from today's rules, so three refunds of a third add up to the
capture exactly.

**Six seats that think, and cannot act.**

| Seat | What it writes down |
|---|---|
| Allocator | How arriving money should be divided |
| Payer | What is due, and which pot it should come from |
| Reporter | The day in a few sentences, over figures it was handed |
| Builder | A storefront: configuration, and a page written as blocks |
| Collector | The follow-up letter for an invoice that has gone quiet |
| Advisor | An answer to a question about the books, with its rows shown |

**A Guardian that is a function.** Every movement of money is written as a
proposal and decided by a pure function — proposal, policy, facts in;
`allow`, `ask` or `refuse` with a reason per rule out. Every rule is
evaluated, not just the first to fire, so the audit log says everything that
was wrong. Consent is bound to the sha256 of the proposal it was given for,
so a proposal amended after approval cannot inherit it. An `ask` waits for
the owner in the dashboard or on Telegram, where the buttons call the same
functions the dashboard's do.

**A shop you can argue with.** Ask the Builder for a page and it answers in a
canvas: the real page on the right, the controls on the left. Ask for
changes and the page *becomes* the answer until you apply or discard it. The
same page can be edited as blocks, as HTML, or by clicking the words in the
preview and typing — three views of one stored field. A design pasted from
somewhere else survives whole.

## How we built it

Next.js 15 (App Router) and React 19 on the front, tRPC 11 and Drizzle over
Postgres behind it, PayPal Orders v2 with their v6 Web SDK for our own
button, Claude through the first-party API or Amazon Bedrock, Tailwind v4,
zod everywhere, Vitest for the lot.

Three decisions did most of the work.

**1. The agent proposes; a function decides.** Not "the model is instructed
not to exceed the limit" — the model is never told the limit at all. A second
copy of the policy inside a prompt would be a second, drifting source of
truth. `features/guardian/decide.ts` reads no database, calls no provider and
does not know what an agent is. Whatever writes a proposal, this decides it —
including the owner's own Release button, so the road the agents take is
already the one in daily use.

**2. Facts come from the ledger; the model only writes sentences.** The
Reporter is handed the set of figures it is allowed to state, and
`unknownNumbers()` scans the answer afterwards. A number outside that set
throws the whole report away — including a correct subtraction, because
working one out is precisely the thing that seat must not do. The Advisor
does not write its query either: it picks one of six by name from an `enum`,
we run it scoped to the owner, and the rows it read are printed under the
answer, because an answer whose rows you cannot see is a claim.

**3. The agent's vocabulary is the app's own.** The Builder cannot write
markup — it writes **blocks**, fifteen kinds mapped onto the twenty the human
editor already offers, so `toHtml()` stays the only writer and an agent
cannot reach markup the sanitiser would quietly take apart. It cannot write a
web address either: it names one of the account's own pay links by key, and
we resolve it through a `Map`. And it does not decide what is wrong with a
page — `findings.ts` computes eight checks in pure code and the model is
handed one by id, because a model asked what is wrong with a page will always
answer something, and it would file taste as a defect.

Around those: one sanitiser that every write path goes through, a storefront
rendered in an iframe with **no** `allow-scripts` so even a hole in the
sanitiser has nothing to run, idempotency keys on every road into the ledger
(`capture:<id>`, a deterministic `sender_batch_id`, the webhook's own
`event_id` as a primary key), and `FOR UPDATE SKIP LOCKED` wherever two
workers could claim the same row.

Each thinking seat has a test file that drives its whole decision path
against a stubbed model. Those files are the eval sets: when a prompt
misbehaves, the case goes in the file rather than into the prompt.

## Challenges we ran into

**A dangling separator is a pattern to continue.** Asked to edit a page, the
model wrote four correct blocks and then repeated `"Browse the library →"`
until it had spent all 12,000 of its output tokens and was cut off mid-JSON.
We replayed the exact captured prompt against the live model rather than
theorising, and the cause was ours: our own page describer wrote
`cta: Browse the library → ` for a button whose address the sanitiser had
stripped. Arrow, then nothing. With the arrow gone the same call answered in
**287 tokens**. We then swept nine more lines with the same shape and wrote a
test that builds a block of every kind with every field blank and asserts
that no line ends in a separator.

**Structure beats persuasion.** Every edit came back with headings that had
no words — reliably, on every run. A sharper field description did not fix
it. More thinking did not fix it. Adding `text` to the schema's `required`
list did, and the same edit immediately returned *1 new · 9 unchanged*. The
lesson stuck: the API constrains shape far better than any sentence we can
write, so put the requirement where the API can enforce it.

**Bedrock's structured outputs are a subset of JSON Schema.** `enum`,
`pattern` and `maxLength` are accepted; array `minItems`/`maxItems` and
numeric `minimum`/`maximum` come back as a 400. We moved those bounds into
the zod schema — which is what decides whether an answer is acted on anyway —
and stated the range in the property description so the model still knows it.

**Ghost rows in the editor.** A design pasted from a saved document arrives
with a `<style>`, two `<meta>`s, a `<title>`, three `<link>`s and a `<script>`
in front of it, and every one came back as a row that claimed to be content.
We measured it: seven positions in the list against three things actually
drawn on the page. Because the canvas compares those two counts before it
lets anyone edit on the page, the mismatch was also silently switching
in-place editing off. The fix was to decide inertness by **content** — take
the inert elements out of the block's markup and see whether anything is left
— rather than by the tag it opens with.

**A button that looked right and did nothing.** Pay links inserted into a
shop page had their address stripped on the way out, leaving an `<a>` with no
href. The cause was mundane and awful: `APP_URL` was `http://localhost:3000`,
and the sanitiser allows `https` and `mailto` only. It hit the human path as
well as the agent's, and nothing said so — an `<a>` that lost its href is
still an `<a>`, so a tag count reported nothing missing. Now the sanitiser
reports stripped addresses, and the "dead button" check applies the
renderer's own rule rather than a list of example hostnames.

**`DOMParser is not defined`.** The block reader needs a DOM and it has two
callers in two runtimes: a browser that has `DOMParser`, and a server that
does not. Rather than write a second, server-shaped parser for the same
markup — a second parser is a second answer to "what is on this page" — we
made the parser an argument and passed linkedom's on the server. It wants a
whole document and returns an empty body if handed a fragment, so that
wrapper lives next to the parser that needs it.

**A feature we could not demonstrate.** We implemented drag-and-drop with the
HTML5 drag API and every handler worked when we dispatched the events by
hand. But a drag begun by a real mouse cannot be driven through the browser's
remote-control protocol, so there was no way to *show* it working — only to
argue that it should. We reversed our own decision and rewrote it on pointer
events, which can be driven end to end and work on a touchscreen, where HTML5
drag does not work at all. The move buttons stayed, because a list you can
only reorder by dragging is a list nobody on a keyboard can reorder.

**A hole in our own code, found two days before the deadline.** During a
security pass we found that the Telegram webhook skipped its authenticity
check entirely when no secret was configured — and the handler below it
approves and executes a Guardian proposal. The only thing left between an
attacker and an approved payout was guessing a chat id and a proposal id. The
endpoint now refuses to serve at all without a secret, the comparison is
timing-safe, and there is a test that fails when the fix is removed.

**The permission that never arrived.** PayPal's Payouts permission was not
approved on our sandbox account in time. We did not fake it and we did not
hide it: a release is recorded as `payout.simulated`, labelled as such in the
UI, in the settlement report and in the CSV, and counted separately from a
real payout everywhere it appears. The application also *asks PayPal* whether
the permission exists, so the answer appears before the button is pressed
rather than after.

## Accomplishments that we're proud of

- **Twelve seats, all built**, and the division is honest: everything on the
  money path is deterministic code, and every seat that thinks writes a
  proposal and stops.
- **484 tests across 71 files**, run with a real Postgres so the ledger,
  money-path and migration guarantees are not quietly skipped. The money path
  test stubs only PayPal — verification, the ledger, idempotency and the
  invoice logic all run for real.
- **The books balance.** `trialBalance()` is `0n`, a replayed capture writes
  nothing, and a refund of a split capture reverses in proportion to the cent.
- **Consent that cannot be transplanted.** An approval is logged against the
  hash of what was approved; amending the proposal voids it, and that voiding
  is itself a line in the audit log.
- **An editor that is the page.** Blocks, HTML and on-page editing over one
  stored field, with a pasted design kept whole rather than chopped into
  fields that would lose it.
- **We found our own vulnerability before anyone else did** — and the fix
  came with a test that proves it fails without it.

## What we learned

**A prompt is an input like any other, and it deserves the same debugging.**
The token runaway was not a model failing; it was our own string ending in an
arrow with nothing after it. We only found it by capturing the exact prompt
that failed and replaying it, instead of reasoning about what the model
"probably" did.

**Put the rule where both writers pass through it.** A duplicate-address
check written inside the agent turned out to be unreachable, because the
schema both the agent and the human form are held to had already refused it.
We deleted the agent's copy. The same principle killed several other
near-duplicates: one sanitiser, one renderer, one writer for the page, one
function that decides.

**The shape of the answer is worth more than the wording of the request.**
`required: ["kind", "text"]` fixed what three prompt rewrites could not.

**A model asked what is wrong will always answer.** That is what makes it
useless as a judge of its own work, and why "fix this" had to become "here is
a check this application computed; it is yours to fix or the owner's".

**Label the thing you could not do.** A simulated payout presented as a real
one would have been the only dishonest line in the project, and it would have
cost more than the feature was worth.

**Be willing to reverse yourself.** Two implementations we had already
finished — the HTML5 drag and an earlier address-splitting approach — went in
the bin when the evidence went against them. Both replacements are simpler.

## What's next for Pay-us

- **Real payouts.** The code path, the idempotency key and the Guardian
  approval all exist and are exercised; `PAYPAL_PAYOUTS_ENABLED=true` is the
  entire change once PayPal approves the permission.
- **More rails behind the same modules.** The integration points are the
  invoice, payment-link and checkout services, not the UI, so a second
  provider does not mean a second checkout screen.
- **Multi-currency**, which the ledger is already shaped for — amounts are
  minor units plus an ISO 4217 code — but which needs a policy on rates
  before it is honest to ship.
- **A thread across seats.** The Builder keeps its conversation per shop; the
  Advisor keeps its own. One shared record of what was asked and refused,
  across every seat, is the obvious next step.
- **The remaining dependency work**, in the open: two critical advisories sit
  in the test runner's worker pool and clearing them means a two-major
  upgrade of Vitest. It ships nothing to production, so it waited.

What is **not** next: custody, yield and treasury, or an embedded wallet.
Payus moves money between PayPal accounts and a ledger. Holding someone
else's funds is a different promise, with a different licence behind it.
