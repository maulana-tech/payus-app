"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMinor, toDecimal } from "@/features/invoices/money";
import { newId } from "@/lib/ids";
import { trpc } from "@/trpc/react";
import { dashButtonPrimary, dashButtonSecondary } from "../styles";
import { Field } from "./InvoicesScreen";
import { ErrorNote } from "./kit";

// Giving money back. What is refundable is read from the payments and the
// refunds rather than from the invoice, because a partly refunded invoice
// is two facts and not one. The attempt carries an id of its own, so a
// double press or a retried request is one refund.

export function RefundDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  currency: string;
}) {
  const utils = trpc.useUtils();
  const refundable = trpc.invoices.refundable.useQuery(
    { id: invoiceId },
    { enabled: open },
  );
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [intentKey, setIntentKey] = useState(() => newId(16));
  const [done, setDone] = useState<string | null>(null);

  const payments = (refundable.data?.payments ?? []).filter(
    (payment) => BigInt(payment.refundableMinor) > 0n,
  );
  const chosen =
    payments.find((payment) => payment.paymentId === paymentId) ?? payments[0];

  // A fresh attempt each time it is opened, offering the whole of what is
  // left — which is what "refund" usually means.
  useEffect(() => {
    if (!open) return;
    setIntentKey(newId(16));
    setDone(null);
    setReason("");
  }, [open]);

  useEffect(() => {
    if (chosen) setAmount(toDecimal(BigInt(chosen.refundableMinor)));
  }, [chosen]);

  const refund = trpc.invoices.refund.useMutation({
    onSuccess: (result) => {
      void utils.invoices.list.invalidate();
      void utils.invoices.refundable.invalidate({ id: invoiceId });
      void utils.ledger.summary.invalidate();
      void utils.ledger.entries.invalidate();
      setDone(
        result.status === "completed"
          ? "Given back. The ledger has taken it out of the same pots it went into, and the invoice is owed again."
          : `PayPal has the refund and says it is ${result.status}. The ledger moves when it completes.`,
      );
    },
  });

  const returned = (refundable.data?.refunds ?? []).filter(
    (row) => row.status === "completed",
  );
  const returnedMinor = returned.reduce(
    (sum, row) => sum + BigInt(row.amountMinor),
    0n,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {invoiceNumber}</DialogTitle>
          <DialogDescription>
            The money comes back out of the pots it went into — tax set aside on
            a sale that was undone is not tax.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="grid gap-4">
            <p className="text-[15px] leading-relaxed">{done}</p>
            <div className="flex justify-end">
              <button
                type="button"
                className={dashButtonPrimary}
                onClick={() => onOpenChange(false)}
              >
                Done
              </button>
            </div>
          </div>
        ) : refundable.isLoading ? (
          <p className="text-sm text-(--dash-ash)">Reading the payments…</p>
        ) : payments.length === 0 ? (
          <div className="grid gap-4">
            <p className="text-[15px] leading-relaxed">
              {returnedMinor > 0n
                ? `Everything taken against this invoice has already been given back (${formatMinor(returnedMinor, currency)}).`
                : "Nothing was captured against this invoice through PayPal, so there is nothing here to give back."}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => onOpenChange(false)}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!chosen) return;
              refund.mutate({
                paymentId: chosen.paymentId,
                amount,
                reason: reason.trim() || undefined,
                intentKey,
              });
            }}
          >
            {payments.length > 1 ? (
              <Field label="Which payment">
                <select
                  value={chosen?.paymentId}
                  onChange={(e) => setPaymentId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-card/70 px-3 text-sm"
                >
                  {payments.map((payment) => (
                    <option key={payment.paymentId} value={payment.paymentId}>
                      {formatMinor(
                        BigInt(payment.refundableMinor),
                        payment.currency,
                      )}{" "}
                      left of{" "}
                      {formatMinor(
                        BigInt(payment.capturedMinor),
                        payment.currency,
                      )}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <Field
              label="Amount"
              hint={
                chosen
                  ? `Up to ${formatMinor(BigInt(chosen.refundableMinor), chosen.currency)}`
                  : undefined
              }
            >
              <Input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </Field>

            <Field label="Reason" hint="Optional, and the payer sees it">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Cancelled the order"
              />
            </Field>

            {returnedMinor > 0n ? (
              <p className="text-sm text-(--dash-ash)">
                {formatMinor(returnedMinor, currency)} has already been given
                back against this invoice.
              </p>
            ) : null}

            {refund.error ? (
              <ErrorNote>{refund.error.message}</ErrorNote>
            ) : null}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={dashButtonPrimary}
                disabled={refund.isPending || !chosen}
              >
                {refund.isPending ? "Giving back…" : "Give it back"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
