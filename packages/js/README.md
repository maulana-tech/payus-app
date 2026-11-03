# @payus/js

The Payus checkout API and webhook verification, with no dependencies.
Works anywhere `fetch` and Web Crypto exist: Node 18+, Bun, Deno, Workers.

```sh
pnpm add @payus/js
```

## Take a payment

```ts
import { Payus } from "@payus/js";

const payus = new Payus({
  apiKey: process.env.PAYUS_SECRET_KEY!, // payus_sk_… — server side only
  baseUrl: "https://pay.example.com",
});

const checkout = await payus.createCheckout({
  amount: "25.00",
  reference: "order_1042",
  description: "Coffee x2",
});

redirect(checkout.url);
```

`amount` is a decimal string and `amount_minor` comes back as integer minor
units, also a string. No amount is ever a float in this library.

## Trust the webhook, not the request

```ts
import { constructEvent, SignatureError } from "@payus/js";

export async function POST(request: Request) {
  const raw = await request.text(); // the raw bytes, not a parsed object
  try {
    const event = await constructEvent(
      process.env.PAYUS_WEBHOOK_SECRET!,
      raw,
      request.headers.get("payus-signature"),
    );
    if (event.type === "checkout.paid") await fulfil(event.data.reference);
  } catch (error) {
    if (error instanceof SignatureError) return new Response(null, { status: 400 });
    throw error;
  }
  return new Response(null, { status: 204 });
}
```

`constructEvent` throws rather than returning null: the mistake worth
preventing is acting on an event nobody verified. Deliveries are
at-least-once, so use `data.id` or your own `reference` to ignore repeats.

## Reading one back

```ts
const latest = await payus.getCheckout(checkout.id);
latest.status; // "open" | "partially_paid" | "paid" | "void"
```

The checkout is the authority on whether something is paid — a webhook you
missed does not change what it says.
