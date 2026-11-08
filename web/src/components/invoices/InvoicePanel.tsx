"use client";

import { postToParent } from "@/features/embed/bridge";
import { formatMinor, toMinor } from "@/features/invoices/money";
import { PayPalButton, post } from "@/features/payments/PayPalButton";
import { cn } from "@/lib/utils";
import { trpc } from "../../trpc/react";
import { Card } from "../ui/card";

/** Public invoice (or API checkout) at /i/<token>, and in the embed frame. */
export function InvoicePanel({
  token,
  embed = false,
}: {
  token: string;
  embed?: boolean;
}) {
  const invoice = trpc.invoices.public.useQuery({ token });
  const utils = trpc.useUtils();

  if (invoice.isLoading)
    return <Card className="p-6 text-sm text-(--dash-ash)">Loading…</Card>;

  if (!invoice.data)
    return (
      <Card className="grid gap-2 p-6">
        <h1 className="text-lg">Invoice not found</h1>
        <p className="text-sm text-(--dash-ash)">
          This link is wrong, or the invoice was removed.
        </p>
      </Card>
    );

  const inv = invoice.data;
  return (
    <Card className={cn("grid gap-4 p-6", embed && "shadow-none")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-(--dash-ash) uppercase">
            Invoice {inv.number}
          </p>
          <h1 className="mt-1 text-4xl leading-none tracking-tight tabular-nums">
            {inv.totalFormatted}
          </h1>
        </div>
        <span className="rounded-full border border-(--dash-line) px-3 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase">
          {inv.status}
        </span>
      </div>
      <dl className="grid gap-1 text-sm text-(--dash-ash)">
        <Pair label="To" value={`@${inv.username}`} />
        <Pair label="For" value={inv.clientName} />
        <Pair label="Due" value={inv.dueDate} />
      </dl>
      <ul className="grid list-none gap-2 border-t border-(--dash-line) pt-3 text-sm">
        {inv.items.map((item) => (
          <li
            key={`${item.description}-${item.unitPrice}`}
            className="flex justify-between gap-4"
          >
            <span className="min-w-0 truncate text-(--dash-ash)">
              {item.quantity} × {item.description}
            </span>
            {/* The line's total, formatted like the headline: a bare
                `1000.00` beside a `$1,000.00` reads as a different kind of
                number, and with a quantity above one it was a different
                number — the unit price, against a total. */}
            <span className="shrink-0 tabular-nums">
              {formatMinor(
                toMinor(item.unitPrice) * BigInt(item.quantity),
                inv.currency,
              )}
            </span>
          </li>
        ))}
      </ul>
      {inv.notes ? (
        <p className="text-sm text-(--dash-ash)">{inv.notes}</p>
      ) : null}
      {inv.status === "pending" ? (
        <PayPalButton
          currency={inv.currency}
          // Our own button, so it can say what it will take.
          label={`Pay ${inv.totalFormatted}`}
          createOrder={async () =>
            (await post("/api/payments/paypal/orders", { token }))
              .orderId as string
          }
          onPaid={() => {
            void utils.invoices.public.invalidate({ token });
            // The framing site is told, so it can close the dialog or
            // advance its own checkout.
            if (embed) postToParent({ type: "payus:paid", invoice: token });
          }}
        />
      ) : (
        <p className="rounded-(--dash-radius) bg-(--dash-tint) p-4 text-sm text-(--dash-ash)">
          {inv.status === "paid"
            ? "Paid in full. Thank you."
            : "This invoice was cancelled."}
        </p>
      )}
    </Card>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-(--dash-ash)">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}
