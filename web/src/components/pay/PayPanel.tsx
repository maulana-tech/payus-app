"use client";

import { useState } from "react";
import { toDecimal } from "../../features/invoices/money";
import { PayPalButton, post } from "../../features/payments/PayPalButton";
import { trpc } from "../../trpc/react";
import { Card } from "../ui/card";
import { Input } from "../ui/input";

/**
 * Public payment page for @username, or one of their payment links. A link
 * with no price asks the payer for one; either way paying it writes an
 * invoice and settles down the ordinary path.
 */
export function PayPanel({
  username,
  slug,
}: {
  username: string;
  slug?: string;
}) {
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(false);
  const profile = trpc.profiles.byUsername.useQuery({ username });
  const link = trpc.paymentLinks.resolve.useQuery(
    { owner: username, slug: slug ?? "" },
    { enabled: Boolean(slug) },
  );

  if (profile.isLoading || (slug && link.isLoading))
    return <Card className="p-6 text-sm text-ink/60">Loading…</Card>;

  if (!profile.data)
    return (
      <Card className="grid gap-2 p-6">
        <h1 className="text-lg">No such username</h1>
        <p className="text-sm text-ink/60">Nobody has claimed @{username}.</p>
      </Card>
    );

  if (slug && !link.data)
    return (
      <Card className="grid gap-2 p-6">
        <h1 className="text-lg">Link not found</h1>
        <p className="text-sm text-ink/60">
          @{username} has no active link called “{slug}”.
        </p>
      </Card>
    );

  const fixed = link.data?.amountMinor
    ? `${toDecimal(BigInt(link.data.amountMinor))} ${link.data.currency}`
    : null;
  const openAmount = Boolean(link.data) && !link.data?.amountMinor;
  const payable =
    Boolean(link.data) &&
    (!openAmount || /^\d{1,12}(\.\d{1,2})?$/.test(amount.trim()));

  return (
    <Card className="grid gap-4 p-6">
      <div className="grid gap-1">
        <p className="text-xs uppercase tracking-wide text-ink/50">Pay</p>
        <h1 className="text-2xl">@{profile.data.username}</h1>
        {link.data ? (
          <p className="text-[15px] text-ink/70">{link.data.title}</p>
        ) : null}
      </div>
      {fixed ? <p className="text-3xl tabular-nums">{fixed}</p> : null}
      {link.data?.description ? (
        <p className="text-sm text-ink/60">{link.data.description}</p>
      ) : null}
      {paid ? (
        <p className="rounded-lg bg-ink/5 p-4 text-sm text-ink/60">
          Paid. Thank you — @{username} has been told.
        </p>
      ) : link.data ? (
        <div className="grid gap-3">
          {openAmount ? (
            <label className="grid gap-1.5 text-sm">
              <span className="text-ink/60">Amount to pay</span>
              <Input
                value={amount}
                inputMode="decimal"
                placeholder="25.00"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          ) : null}
          <PayPalButton
            currency={link.data.currency}
            disabled={!payable}
            createOrder={async () =>
              (
                await post("/api/payments/paypal/links", {
                  owner: username,
                  slug: link.data?.slug,
                  amount: openAmount ? amount.trim() : undefined,
                })
              ).orderId as string
            }
            onPaid={() => setPaid(true)}
          />
        </div>
      ) : (
        <p className="rounded-lg bg-ink/5 p-4 text-sm text-ink/60">
          Open one of @{username}&rsquo;s payment links to pay them.
        </p>
      )}
    </Card>
  );
}
