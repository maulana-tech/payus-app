"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { toDecimal, toMinor } from "@/features/invoices/money";
import { trpc } from "@/trpc/react";
import { dashButtonPrimary } from "../styles";
import { Field } from "./InvoicesScreen";
import { ErrorNote, Panel } from "./kit";

// The limits the Guardian decides by. They are the owner's to set, which is
// the only reason the Guardian's refusals are legitimate.

export function GuardianLimits() {
  const overview = trpc.guardian.overview.useQuery();
  const utils = trpc.useUtils();
  const policy = overview.data?.policy;

  const [perPayment, setPerPayment] = useState("");
  const [perDay, setPerDay] = useState("");
  const [approveAbove, setApproveAbove] = useState("");
  const [askForNew, setAskForNew] = useState(true);
  const [expiry, setExpiry] = useState("60");
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!policy) return;
    setPerPayment(toDecimal(BigInt(policy.perTransactionMinor)));
    setPerDay(toDecimal(BigInt(policy.perDayMinor)));
    setApproveAbove(toDecimal(BigInt(policy.approveAboveMinor)));
    setAskForNew(policy.newRecipientNeedsApproval);
    setExpiry(String(policy.expiryMinutes));
  }, [policy]);

  const save = trpc.guardian.savePolicy.useMutation({
    onSuccess: () => {
      void utils.guardian.overview.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const submit = () => {
    setProblem("");
    try {
      save.mutate({
        perTransactionMinor: toMinor(perPayment).toString(),
        perDayMinor: toMinor(perDay).toString(),
        approveAboveMinor: toMinor(approveAbove).toString(),
        newRecipientNeedsApproval: askForNew,
        expiryMinutes: Number(expiry),
      });
    } catch {
      setProblem("Amounts look like 500.00.");
    }
  };

  return (
    <Panel
      title="Guardian"
      hint="A deterministic check between every proposal and the money. These are the numbers it checks against."
    >
      <form
        className="grid gap-5 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Refuse above" hint="Per payment, USD">
            <Input
              value={perPayment}
              inputMode="decimal"
              onChange={(e) => setPerPayment(e.target.value)}
              required
            />
          </Field>
          <Field label="Refuse above" hint="Per day, USD">
            <Input
              value={perDay}
              inputMode="decimal"
              onChange={(e) => setPerDay(e.target.value)}
              required
            />
          </Field>
          <Field label="Ask me above" hint="USD">
            <Input
              value={approveAbove}
              inputMode="decimal"
              onChange={(e) => setApproveAbove(e.target.value)}
              required
            />
          </Field>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={askForNew}
            onChange={(e) => setAskForNew(e.target.checked)}
            className="mt-0.5 size-4 accent-(--dash-fg)"
          />
          <span>
            Ask me before paying someone for the first time.
            <span className="mt-0.5 block text-(--dash-ash)">
              A recipient who has been paid before, within the limits above,
              goes through without stopping.
            </span>
          </span>
        </label>

        <div className="sm:max-w-48">
          <Field label="Hold for" hint="Minutes">
            <Input
              value={expiry}
              inputMode="numeric"
              onChange={(e) => setExpiry(e.target.value)}
              required
            />
          </Field>
        </div>

        {problem || save.error ? (
          <ErrorNote>{problem || save.error?.message}</ErrorNote>
        ) : null}

        <div className="flex items-center justify-end gap-4">
          {saved ? (
            <span className="text-sm text-(--dash-ash)" role="status">
              Saved
            </span>
          ) : null}
          <button
            type="submit"
            className={dashButtonPrimary}
            disabled={save.isPending || !policy}
          >
            {save.isPending ? "Saving…" : "Save limits"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
