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

// Sending what is owed to the merchant's PayPal address. The attempt gets an
// id of its own when the dialog opens: pressing the button twice, or a
// request that times out and is retried, is one payout and not two.

export function ReleaseDialog({
  open,
  onOpenChange,
  payableMinor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payableMinor: string;
}) {
  const utils = trpc.useUtils();
  const payable = BigInt(payableMinor);
  const [amount, setAmount] = useState(toDecimal(payable));
  const [destination, setDestination] = useState("");
  const [intentKey, setIntentKey] = useState(() => newId(16));
  const [done, setDone] = useState<string | null>(null);

  // A fresh attempt each time the dialog is opened, and the full balance
  // offered, since that is what someone usually means by "release".
  useEffect(() => {
    if (!open) return;
    setIntentKey(newId(16));
    setAmount(toDecimal(payable));
    setDone(null);
  }, [open, payable]);

  const release = trpc.ledger.release.useMutation({
    onSuccess: (payout) => {
      void utils.ledger.summary.invalidate();
      void utils.ledger.entries.invalidate();
      void utils.ledger.payouts.invalidate();
      setDone(payout.status);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release {formatMinor(payable)}</DialogTitle>
          <DialogDescription>
            This is what the ledger says you are owed after every split. It is
            sent to a PayPal address.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="grid gap-4">
            <p className="text-[15px] leading-relaxed">
              {done === "simulated"
                ? "Recorded as a simulated payout: Payouts is not enabled on this PayPal account yet, so no money moved. The ledger shows it as payout.simulated, labelled, rather than pretending it was sent."
                : "Sent. PayPal has the batch and the ledger has the posting."}
            </p>
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
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              release.mutate({ amount, destination, intentKey });
            }}
          >
            <Field label="Amount" hint={`Up to ${formatMinor(payable)}`}>
              <Input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="PayPal address">
              <Input
                type="email"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </Field>
            {release.error ? (
              <ErrorNote>{release.error.message}</ErrorNote>
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
                disabled={release.isPending || payable <= 0n}
              >
                {release.isPending ? "Releasing…" : "Release"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
