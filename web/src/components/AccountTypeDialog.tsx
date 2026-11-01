"use client";

import { Briefcase, Check, Loader, Store, User } from "lucide-react";
import { useState } from "react";
import {
  ACCOUNT_TYPES,
  type AccountType,
} from "../features/account/accountType";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { linenInsetClass } from "./ui/glass";
import { Input } from "./ui/input";
import { ToastFeedback } from "./ui/toast-feedback";

export const ACCOUNT_TYPE_ICONS: Record<AccountType, typeof User> = {
  personal: User,
  freelancer: Briefcase,
  business: Store,
};

/**
 * Onboarding step after the username: how the account will be used. It only
 * decides which tools the dashboard shows first, and can change in Settings.
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
      <DialogContent appearance="linen" size="sm" showCloseButton={false}>
        <DialogHeader className="px-6 text-center">
          <DialogTitle>How will you use Payus?</DialogTitle>
          <DialogDescription className="mx-auto">
            We put the right tools first. Every feature stays available, and you
            can change this anytime in Settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3" role="radiogroup" aria-label="Account type">
          {ACCOUNT_TYPES.map(({ type, label, summary, tools }) => {
            const Icon = ACCOUNT_TYPE_ICONS[type];
            const checked = selected === type;
            return (
              // biome-ignore lint/a11y/useSemanticElements: card-sized radio
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={busy}
                onClick={() => setSelected(type)}
                className={`${linenInsetClass} flex min-h-20 items-center gap-4 border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-foreground/70 disabled:cursor-not-allowed disabled:opacity-50 ${
                  checked
                    ? "border-foreground/60"
                    : "border-foreground/18 hover:border-foreground/30"
                }`}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-(--dash-radius-sm) bg-foreground/10 ring-1 ring-foreground/15">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">
                    {label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-foreground/60">
                    {summary}
                  </span>
                  <span className="mt-1 block text-[11px] leading-4 text-foreground/45">
                    {tools}
                  </span>
                </span>
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                    checked
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/30"
                  }`}
                  aria-hidden="true"
                >
                  {checked ? <Check className="size-3" /> : null}
                </span>
              </button>
            );
          })}
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
              Shown on your own point of sale screen. It is not published.
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
