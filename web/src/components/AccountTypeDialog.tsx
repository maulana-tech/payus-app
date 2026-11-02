"use client";

import { Loader } from "lucide-react";
import { useState } from "react";
import {
  ACCOUNT_TYPES,
  type AccountType,
} from "../features/account/accountType";
import { ChoiceCard } from "./onboarding/ChoiceCard";
import { OnboardingStep } from "./onboarding/Steps";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ToastFeedback } from "./ui/toast-feedback";

/**
 * The last onboarding step: how the account will be used. It only decides
 * what the dashboard puts first — every page stays reachable from Settings,
 * and the choice can be changed there.
 */
export function AccountTypeDialog({
  open,
  onChoose,
}: {
  open: boolean;
  onChoose: (type: AccountType, businessName: string | null) => Promise<void>;
}) {
  const [selected, setSelected] = useState<AccountType | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await onChoose(
        selected,
        selected === "business" ? businessName.trim() || null : null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't save your choice.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        appearance="linen"
        size="md"
        showCloseButton={false}
        className="max-h-[90svh] overflow-y-auto"
      >
        <DialogHeader className="px-1">
          <OnboardingStep step={3} />
          <DialogTitle>How will you use Payus?</DialogTitle>
          <DialogDescription>
            This orders your navigation, nothing else. Every page stays
            reachable from Settings, and you can change this later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3" role="radiogroup" aria-label="Account type">
          {ACCOUNT_TYPES.map(({ type, label, summary, tools, goodIf }, i) => (
            <ChoiceCard
              key={type}
              index={i + 1}
              title={label}
              summary={summary}
              rows={[
                { label: "You get", value: tools },
                { label: "Good if", value: goodIf },
              ]}
              selected={selected === type}
              disabled={busy}
              onSelect={() => setSelected(type)}
            />
          ))}
        </div>

        {selected === "business" ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="business-name">
              Business name{" "}
              <span className="font-normal text-foreground/50">(optional)</span>
            </label>
            <Input
              appearance="linen"
              id="business-name"
              className="min-h-11"
              placeholder="Kopi Senja"
              maxLength={60}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Shown to you on your own screens. It is not published.
            </span>
          </div>
        ) : null}

        <Button
          className="min-h-11 w-full"
          onClick={() => void submit()}
          disabled={!selected || busy}
          aria-busy={busy}
        >
          {busy ? (
            <Loader
              className="size-4 motion-safe:animate-spin"
              aria-hidden="true"
            />
          ) : null}
          {busy ? "Saving…" : "Continue"}
        </Button>

        <ToastFeedback
          message={error}
          variant="error"
          toastId="account-type-error"
        />
      </DialogContent>
    </Dialog>
  );
}
