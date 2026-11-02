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
  const layout = store.template;
  const variant =
    layout === "menu" ? "row" : layout === "shelf" ? "card" : "hero";

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
          variant === "card"
            ? "mx-auto grid w-full max-w-3xl gap-5 px-6 pb-24 sm:grid-cols-2"
            : variant === "row"
              ? "mx-auto grid w-full max-w-3xl gap-2 px-6 pb-24"
              : "mx-auto grid w-full max-w-3xl gap-5 px-6 pb-24"
        }
      >
        {store.products.map((product) => (
          <Item
            key={product.id}
            slug={slug}
            currency={store.currency}
            product={product}
            variant={variant}
            wide={variant === "card" && store.products.length === 1}
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
  variant,
  wide,
}: {
  slug: string;
  currency: string;
  product: Product;
  /** How densely to draw it, decided by the shop's layout. */
  variant: "card" | "row" | "hero";
  wide: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState(1);
  const [paid, setPaid] = useState(false);
  const openAmount = product.priceMinor === null;
  const within =
    !openAmount ||
    (/^\d{1,12}(\.\d{1,2})?$/.test(amount.trim()) &&
      inBounds(amount.trim(), product));
  const payable = within && !product.soldOut;

  const unit = product.priceMinor ? BigInt(product.priceMinor) : null;
  const total = unit !== null ? unit * BigInt(count) : null;

  return (
    <article
      className={[
        "flex flex-col border border-(--shop-line) bg-(--shop-surface)",
        variant === "row" ? "rounded-xl p-4" : "rounded-2xl p-6",
        variant === "hero" ? "sm:p-8" : "",
        wide ? "sm:col-span-2" : "",
        product.soldOut ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          className={`font-(family-name:--font-landing-serif) leading-tight font-light ${
            variant === "hero" ? "text-3xl sm:text-4xl" : "text-2xl"
          }`}
        >
          {product.name}
        </h2>
        <p className="shrink-0 text-lg font-medium text-(--shop-accent) tabular-nums">
          {product.soldOut
            ? "Sold out"
            : total !== null
              ? formatMinor(total, currency)
              : "You choose"}
        </p>
      </div>

      {product.description ? (
        <p
          className={`text-[15px] leading-relaxed text-(--shop-muted) ${
            variant === "row" ? "mt-1.5" : "mt-3"
          }`}
        >
          {product.description}
        </p>
      ) : null}

      {product.soldOut ? null : (
        <div
          className={variant === "row" ? "mt-4 grid gap-3" : "mt-6 grid gap-3"}
        >
          {paid ? (
            <p className="rounded-xl border border-(--shop-accent) px-4 py-3 text-sm">
              Paid. Thank you — the seller has been told.
            </p>
          ) : (
            <>
              {openAmount ? (
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-semibold tracking-[0.16em] text-(--shop-muted) uppercase">
                    Amount
                    {product.minMinor || product.maxMinor ? (
                      <span className="ml-2 tracking-normal normal-case">
                        {bounds(product, currency)}
                      </span>
                    ) : null}
                  </span>
                  <input
                    value={amount}
                    inputMode="decimal"
                    placeholder="25.00"
                    onChange={(event) => setAmount(event.target.value)}
                    className="h-11 w-full rounded-xl border border-(--shop-line) bg-transparent px-3 text-[15px] tabular-nums outline-none placeholder:text-(--shop-muted) focus-visible:border-(--shop-accent)"
                  />
                </label>
              ) : null}

              {product.quantity ? (
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold tracking-[0.16em] text-(--shop-muted) uppercase">
                    How many
                  </span>
                  <span className="flex items-center gap-1">
                    <Step
                      label="One fewer"
                      disabled={count <= 1}
                      onClick={() => setCount((n) => Math.max(1, n - 1))}
                    >
                      −
                    </Step>
                    <span className="w-8 text-center text-[15px] tabular-nums">
                      {count}
                    </span>
                    <Step
                      label="One more"
                      disabled={count >= product.limit}
                      onClick={() =>
                        setCount((n) => Math.min(product.limit, n + 1))
                      }
                    >
                      +
                    </Step>
                  </span>
                  {count >= product.limit ? (
                    <span className="text-sm text-(--shop-muted)">
                      {product.limit} at a time
                    </span>
                  ) : null}
                </div>
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
                      quantity: product.quantity ? count : undefined,
                    })
                  ).orderId as string
                }
                onPaid={() => setPaid(true)}
              />
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Step({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full border border-(--shop-line) text-lg leading-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** The shop's own bounds, said plainly under the amount field. */
function bounds(product: Product, currency: string): string {
  const low = product.minMinor
    ? formatMinor(BigInt(product.minMinor), currency)
    : null;
  const high = product.maxMinor
    ? formatMinor(BigInt(product.maxMinor), currency)
    : null;
  if (low && high) return `${low} to ${high}`;
  if (low) return `${low} or more`;
  if (high) return `up to ${high}`;
  return "";
}

/**
 * Whether what the payer typed is inside the shop's bounds. The server
 * checks this again against the stored item — this is only so the button
 * does not invite a refusal.
 */
function inBounds(value: string, product: Product): boolean {
  const [whole, frac = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2));
  if (product.minMinor && minor < BigInt(product.minMinor)) return false;
  if (product.maxMinor && minor > BigInt(product.maxMinor)) return false;
  return minor > 0n;
}
