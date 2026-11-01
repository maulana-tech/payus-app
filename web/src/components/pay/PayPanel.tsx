"use client";

import { toDecimal } from "../../features/invoices/money";
import { trpc } from "../../trpc/react";
import { Card } from "../ui/card";

/**
 * Public payment page for @username, or one of their payment links. It shows
 * who is being paid and how much; the payment rail itself is not wired up.
 */
export function PayPanel({
  username,
  slug,
}: {
  username: string;
  slug?: string;
}) {
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

  const amount = link.data?.amountMinor
    ? `${toDecimal(BigInt(link.data.amountMinor))} ${link.data.currency}`
    : null;

  return (
    <Card className="grid gap-4 p-6">
      <div className="grid gap-1">
        <p className="text-xs uppercase tracking-wide text-ink/50">Pay</p>
        <h1 className="text-2xl">@{profile.data.username}</h1>
        {link.data ? (
          <p className="text-[15px] text-ink/70">{link.data.title}</p>
        ) : null}
      </div>
      {amount ? <p className="text-3xl tabular-nums">{amount}</p> : null}
      {link.data?.description ? (
        <p className="text-sm text-ink/60">{link.data.description}</p>
      ) : null}
      <p className="rounded-lg bg-ink/5 p-4 text-sm text-ink/60">
        Checkout is being rebuilt on a new payment rail. This page already
        resolves the username and the link; the payment step is next.
      </p>
    </Card>
  );
}
