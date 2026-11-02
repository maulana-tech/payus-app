"use client";

import { useState } from "react";
import { formatMinor } from "@/features/invoices/money";
import { PayPalButton, post } from "@/features/payments/PayPalButton";
import { trpc } from "@/trpc/react";
import { Card } from "../ui/card";
import { Input } from "../ui/input";

// A storefront as its visitors see it. Everything here comes from the stored
// configuration: there is no field a merchant or an agent could put markup
// into, because the renderer only ever reads these values.

export function StorefrontPanel({ slug }: { slug: string }) {
  const shop = trpc.storefront.public.useQuery({ slug });
  const [paid, setPaid] = useState<string | null>(null);

  if (shop.isLoading)
    return <Card className="p-6 text-sm text-ink/60">Loading…</Card>;

  if (!shop.data)
    return (
      <Card className="grid gap-2 p-6">
        <h1 className="text-lg">Nothing here</h1>
        <p className="text-sm text-ink/60">
          This shop does not exist, or it has not been published yet.
        </p>
      </Card>
    );

  const store = shop.data;

  return (
    <div className="grid gap-4">
      <Card className="grid gap-2 p-6">
        <p className="text-xs uppercase tracking-wide text-ink/50">
          @{store.owner}
        </p>
        <h1 className="text-2xl">{store.title}</h1>
        {store.blurb ? (
          <p className="text-[15px] leading-relaxed text-ink/70">
            {store.blurb}
          </p>
        ) : null}
      </Card>

      {store.products.map((product) => (
        <ProductCard
          key={product.id}
          slug={slug}
          currency={store.currency}
          product={product}
          paid={paid === product.id}
          onPaid={() => setPaid(product.id)}
        />
      ))}
    </div>
  );
}

function ProductCard({
  slug,
  currency,
  product,
  paid,
  onPaid,
}: {
  slug: string;
  currency: string;
  product: {
    id: string;
    name: string;
    description: string;
    priceMinor: string | null;
  };
  paid: boolean;
  onPaid: () => void;
}) {
  const [amount, setAmount] = useState("");
  const openAmount = product.priceMinor === null;
  const payable = !openAmount || /^\d{1,12}(\.\d{1,2})?$/.test(amount.trim());

  return (
    <Card className="grid gap-3 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg">{product.name}</h2>
        {product.priceMinor ? (
          <p className="text-xl tabular-nums">
            {formatMinor(BigInt(product.priceMinor), currency)}
          </p>
        ) : (
          <p className="text-sm text-ink/60">You choose</p>
        )}
      </div>
      {product.description ? (
        <p className="text-sm leading-relaxed text-ink/70">
          {product.description}
        </p>
      ) : null}

      {paid ? (
        <p className="rounded-lg bg-ink/5 p-4 text-sm text-ink/60">
          Paid. Thank you — the seller has been told.
        </p>
      ) : (
        <div className="grid gap-3">
          {openAmount ? (
            <label className="grid gap-1.5 text-sm">
              <span className="text-ink/60">Amount</span>
              <Input
                value={amount}
                inputMode="decimal"
                placeholder="25.00"
                onChange={(event) => setAmount(event.target.value)}
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
            onPaid={onPaid}
          />
        </div>
      )}
    </Card>
  );
}
