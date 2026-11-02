"use client";

import { useState } from "react";
import { formatMinor } from "@/features/invoices/money";
import { PayPalButton, post } from "@/features/payments/PayPalButton";
import type { StorefrontView } from "@/features/storefront/config";
import { paletteVars } from "@/features/storefront/theme";
import { trpc } from "@/trpc/react";

// A storefront as its visitors see it: the merchant's page, in the colours
// they chose, built only from stored values. There is no field anywhere in
// here that markup could arrive through — the configuration names a look,
// and this file is the only thing that turns a look into a page.

type Product = StorefrontView["products"][number];

export function StorefrontPanel({ slug }: { slug: string }) {
  const shop = trpc.storefront.public.useQuery({ slug });

  if (shop.isLoading) return <Shell>{null}</Shell>;

  if (!shop.data)
    return (
      <Shell>
        <div className="mx-auto max-w-lg px-6 py-32 text-center">
          <h1 className="font-(family-name:--font-landing-serif) text-4xl font-light">
            Nothing here
          </h1>
          <p className="mt-3 text-[15px] text-(--shop-muted)">
            This shop does not exist, or it has not been published yet.
          </p>
        </div>
      </Shell>
    );

  const store = shop.data;
  const tip = store.template === "tip";

  return (
    <Shell theme={store.theme} accent={store.accent}>
      <header className="mx-auto w-full max-w-3xl px-6 pt-20 pb-10 sm:pt-28">
        <p className="text-[11px] font-semibold tracking-[0.22em] text-(--shop-muted) uppercase">
          @{store.owner}
        </p>
        <h1 className="mt-4 font-(family-name:--font-landing-serif) text-[clamp(2.75rem,8vw,4.5rem)] leading-[0.95] font-light tracking-[-0.02em]">
          {store.title}
        </h1>
        <span
          aria-hidden="true"
          className="mt-6 block h-px w-16 bg-(--shop-accent)"
        />
        {store.blurb ? (
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-(--shop-muted)">
            {store.blurb}
          </p>
        ) : null}
      </header>

      <main
        className={
          tip
            ? "mx-auto grid w-full max-w-3xl gap-5 px-6 pb-24"
            : "mx-auto grid w-full max-w-3xl gap-5 px-6 pb-24 sm:grid-cols-2"
        }
      >
        {store.products.map((product) => (
          <Item
            key={product.id}
            slug={slug}
            currency={store.currency}
            product={product}
            wide={tip || store.products.length === 1}
          />
        ))}
      </main>

      <footer className="mx-auto w-full max-w-3xl border-t border-(--shop-line) px-6 py-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-(--shop-muted) uppercase">
          Paid securely with PayPal · Powered by Payus
        </p>
      </footer>
    </Shell>
  );
}

/** The page itself: the shop's colours, and nothing of ours inside them. */
function Shell({
  theme = "paper",
  accent = "clay",
  children,
}: {
  theme?: StorefrontView["theme"];
  accent?: StorefrontView["accent"];
  children: React.ReactNode;
}) {
  return (
    <div
      style={paletteVars(theme, accent) as React.CSSProperties}
      className="flex min-h-svh flex-col bg-(--shop-page) font-(family-name:--font-landing) text-(--shop-text) antialiased"
    >
      {children}
    </div>
  );
}

function Item({
  slug,
  currency,
  product,
  wide,
}: {
  slug: string;
  currency: string;
  product: Product;
  wide: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(false);
  const openAmount = product.priceMinor === null;
  const payable = !openAmount || /^\d{1,12}(\.\d{1,2})?$/.test(amount.trim());

  return (
    <article
      className={`flex flex-col rounded-2xl border border-(--shop-line) bg-(--shop-surface) p-6 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-(family-name:--font-landing-serif) text-2xl leading-tight font-light">
          {product.name}
        </h2>
        <p className="shrink-0 text-lg font-medium text-(--shop-accent) tabular-nums">
          {product.priceMinor
            ? formatMinor(BigInt(product.priceMinor), currency)
            : "You choose"}
        </p>
      </div>

      {product.description ? (
        <p className="mt-3 text-[15px] leading-relaxed text-(--shop-muted)">
          {product.description}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3">
        {paid ? (
          <p className="rounded-xl border border-(--shop-accent) px-4 py-3 text-sm text-(--shop-text)">
            Paid. Thank you — the seller has been told.
          </p>
        ) : (
          <>
            {openAmount ? (
              <label className="grid gap-1.5">
                <span className="text-[11px] font-semibold tracking-[0.16em] text-(--shop-muted) uppercase">
                  Amount
                </span>
                <input
                  value={amount}
                  inputMode="decimal"
                  placeholder="25.00"
                  onChange={(event) => setAmount(event.target.value)}
                  className="h-11 w-full rounded-xl border border-(--shop-line) bg-transparent px-3 text-[15px] text-(--shop-text) tabular-nums outline-none placeholder:text-(--shop-muted) focus-visible:border-(--shop-accent)"
                />
              </label>
            ) : null}
            <PayPalButton
              currency={currency}
              disabled={!payable}
              createOrder={async () =>
                (
                  await post("/api/payments/paypal/storefront", {
                    slug,
                    productId: product.id,
                    amount: openAmount ? amount.trim() : undefined,
                  })
                ).orderId as string
              }
              onPaid={() => setPaid(true)}
            />
          </>
        )}
      </div>
    </article>
  );
}
