# Accepting payments on your site

Two ways to take payments outside the Payus dashboard.

> **Status:** the payment rail itself is being rebuilt. The pages, the
> checkout objects, the widget and the signed webhooks below all work; what
> is missing is the step where money actually moves.

- **Website widget**: one `<script>` tag, no server code. For tips, donations,
  simple products.
- **Checkout API**: your server creates a checkout per order and gets a signed
  webhook once it is paid. For shops.

## How "paid" is known

A checkout becomes `paid` when the payment is reported against it, and the
`checkout.paid` webhook fires then. Who reports it depends on the payment
rail, which is being rebuilt.

## Website widget

```html
<script src="https://YOUR-PAYUS/embed.js" async
        data-to="@yourname" data-link="coffee"></script>
```

| Attribute | Meaning |
|---|---|
| `data-to` | `@username` to pay (required unless `data-invoice`) |
| `data-link` | one of your payment links (fixed amount, its own address) |
| `data-amount` | suggested amount for open-amount pages |
| `data-invoice` | a public invoice or checkout token, instead of `data-to` |
| `data-mode` | `button` (default, opens a dialog) or `inline` |
| `data-label` | button text |
| `data-theme` | `light` or `dark` |

Several widgets on one page: put the attributes on any element with
`data-payus-pay` and load `embed.js` once.

Events bubble to `document` as `CustomEvent`s:

| Event | When |
|---|---|
| `payus:ready` | the widget loaded |
| `payus:payer-says-paid` | the payer pressed "I've paid" (a claim, not a confirmation) |
| `payus:paid` | an invoice/checkout was confirmed paid (`detail.invoice`) |
| `payus:close` | the dialog closed |

`/embed-demo.html?to=yourname` shows it on a sample shop page.

## Checkout API

Create a key in **Developers → API keys**. Send it as
`Authorization: Bearer payus_sk_…` from your server only.

### Create a checkout

`POST /api/v1/checkouts`

```json
{
  "amount": "25.00",
  "currency": "USD",
  "reference": "order_1042",
  "description": "Coffee x2",
  "customer_name": "Ada",
  "customer_email": "ada@example.com",
  "due_date": "2026-11-01"
}
```

Only `amount` is required, with up to 2 decimals. `currency` is `USD` for
now. Returns `201` with a checkout:

```json
{
  "id": "Q7…",
  "object": "checkout",
  "status": "open",
  "currency": "USD",
  "amount": "25.00",
  "amount_minor": "2500",
  "paid_minor": "0",
  "reference": "order_1042",
  "description": "Coffee x2",
  "url": "https://YOUR-PAYUS/i/…",
  "embed_url": "https://YOUR-PAYUS/embed/i/…",
  "created_at": "2026-10-15T10:00:00.000Z",
  "paid_reported_at": null
}
```

Send the buyer to `url`, or show it on your page with the widget
(`data-invoice` = the token at the end of `url`) or an iframe of `embed_url`.

### Get a checkout

`GET /api/v1/checkouts/:id` returns the same object. `status` is `open`,
`partially_paid`, `paid` or `void`. `amount_minor` and `paid_minor` are
integer minor units (cents) of `currency`.

### Errors

`{ "error": { "code": "invalid_request", "message": "…" } }` with `400`,
`401` (missing or revoked key), `404` or `429` (more than 120 requests a
minute per key).

## Webhooks

Set an endpoint in **Developers → Webhook** (`https://`; `http://localhost`
works in development). Events are POSTed as JSON:

```json
{
  "id": "evt_…",
  "type": "checkout.paid",
  "created": 1792000000,
  "data": { "id": "Q7…", "object": "checkout", "status": "paid", "reference": "order_1042", "…": "…" }
}
```

Types: `checkout.paid` (API checkouts), `invoice.paid` (dashboard invoices)
and `test`. A failed delivery is retried twice (after 2 s and 8 s); the last
20 deliveries are listed in the dashboard.

Every request has a `Payus-Signature: t=<unix seconds>,v1=<hex>` header, where
`v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Verify it before trusting the
event, and reject timestamps more than 5 minutes old:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1?.length === expected.length &&
    timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

Treat events as at-least-once: use `data.id` or `data.reference` to ignore
duplicates.

## The library

`@payus/js` (in `packages/js`) is the same two things with the mistakes
taken out: no dependencies, amounts never floats, and `constructEvent`
*throws* rather than returning null, because the one error worth preventing
is acting on an event nobody verified.

```ts
import { Payus, constructEvent } from "@payus/js";

const payus = new Payus({ apiKey: process.env.PAYUS_SECRET_KEY!, baseUrl });
const checkout = await payus.createCheckout({ amount: "25.00", reference: "order_1042" });

// …and in your webhook route, with the raw body, not a parsed object:
const event = await constructEvent(secret, raw, request.headers.get("payus-signature"));
```

Its tests verify a signature produced by *this server's* own signer, so the
two cannot drift apart. `packages/js/README.md` has the rest.
