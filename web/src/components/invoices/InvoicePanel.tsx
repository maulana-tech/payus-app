"use client";

import { Check, Download } from "lucide-react";
import { useState } from "react";
import { postToParent } from "@/features/embed/bridge";
import { formatMinor, toMinor } from "@/features/invoices/money";
import type { InvoiceView } from "@/features/invoices/types";
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
      ) : inv.status === "paid" ? (
        <Receipt invoice={inv} />
      ) : (
        <p className="rounded-xl bg-(--dash-tint) p-4 text-sm text-(--dash-ash)">
          This invoice was cancelled.
        </p>
      )}
    </Card>
  );
}

/**
 * What a payer gets to keep.
 *
 * "Paid in full. Thank you." is a sentence, not proof. This is the same
 * fact with the things that make it checkable: what was taken, when, and
 * PayPal's own capture reference — the string that is also in the payer's
 * PayPal receipt, so the two can be held against each other.
 *
 * The download is the invoice renderer, which already titles itself a
 * Payment Receipt once the invoice is paid.
 */
function Receipt({ invoice }: { invoice: InvoiceView }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState("");

  const save = async () => {
    setFailed("");
    setSaving(true);
    try {
      const { downloadInvoicePdf } = await import("@/lib/invoicePdf");
      await downloadInvoicePdf(invoice, { origin: window.location.origin });
    } catch (cause: unknown) {
      setFailed(
        cause instanceof Error ? cause.message : "That did not download.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border border-(--dash-line) p-4">
      <div className="flex items-center gap-2">
        <Check className="size-4 shrink-0" aria-hidden="true" />
        <p className="text-sm font-medium">Paid in full</p>
      </div>

      <dl className="grid text-sm">
        {invoice.receipts.map((receipt, index) => (
          <div
            key={receipt.reference}
            // An invoice can be paid in parts, and two payments stacked with
            // no line between them read as one payment with six fields.
            className={cn(
              "grid gap-1",
              index > 0 && "mt-3 border-t border-(--dash-line) pt-3",
            )}
          >
            {invoice.receipts.length > 1 ? (
              <p className="text-[11px] tracking-[0.12em] text-(--dash-ash) uppercase">
                Payment {invoice.receipts.length - index} of{" "}
                {invoice.receipts.length}
              </p>
            ) : null}
            <Pair label="Amount" value={receipt.amountFormatted} />
            <Pair label="Paid" value={when(receipt.at)} />
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-(--dash-ash)">Reference</dt>
              {/* Selectable and whole: a reference you cannot copy is a
                  reference you cannot check against your own PayPal
                  receipt, which is the only thing that makes it proof. */}
              <dd className="min-w-0 font-mono text-[12px] break-all select-all">
                {receipt.reference}
              </dd>
            </div>
          </div>
        ))}
        {invoice.receipts.length === 0 ? (
          // Marked paid by the owner rather than captured through PayPal:
          // there is no reference to show, and inventing one would be the
          // opposite of a receipt.
          <p className="text-(--dash-ash)">
            Recorded as paid by @{invoice.username}.
          </p>
        ) : null}
      </dl>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        // mt-1: the divider above already spaces the last payment, so the
        // button only needs to stop touching it.
        className={cn(
          "flex min-h-10 items-center justify-center gap-2 rounded-xl px-4",
          "border border-(--dash-line) text-sm font-medium",
          "transition-colors hover:bg-(--dash-tint)",
          "focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Download className="size-4" aria-hidden="true" />
        {saving ? "Preparing…" : "Download receipt"}
      </button>
      {failed ? (
        <p className="text-sm font-medium" role="alert">
          {failed}
        </p>
      ) : null}
    </div>
  );
}

/** A timestamp a person reads, in their own zone. */
function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-(--dash-ash)">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}
