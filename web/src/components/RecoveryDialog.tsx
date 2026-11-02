"use client";

import { Loader } from "lucide-react";
import { ChoiceCard } from "./onboarding/ChoiceCard";
import { OnboardingStep } from "./onboarding/Steps";
import type { RecoveryMethod, RecoveryModal } from "./SessionProvider";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ToastFeedback } from "./ui/toast-feedback";

/**
 * Protects the privacy keys of a new account (passkey or PIN) and re-derives
 * them from the passkey on a new device.
 */
export function RecoveryDialog({
  modal,
  busy,
  error,
  passkeySupported,
  onChoose,
  onUnlock,
  onClose,
}: {
  modal: RecoveryModal | null;
  busy: boolean;
  error: string;
  passkeySupported: boolean;
  onChoose: (method: RecoveryMethod) => void;
  onUnlock: () => void;
  onClose: () => void;
}) {
  const choosing = modal === "choose";
  return (
    <Dialog
      open={Boolean(modal)}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        appearance="linen"
        size="md"
        showCloseButton={!choosing}
        className="max-h-[90svh] overflow-y-auto"
      >
        <DialogHeader className="px-1">
          {choosing ? <OnboardingStep step={1} /> : null}
          <DialogTitle>
            {choosing ? "Choose how to unlock" : "Unlock with your passkey"}
          </DialogTitle>
          <DialogDescription>
            {choosing
              ? "Your account has keys that only your browser can derive. Pick how you will prove it is you on your next device."
              : "Use the passkey you created for Payus. The keys are derived again on this device — nothing is downloaded."}
          </DialogDescription>
        </DialogHeader>

        {choosing ? (
          <fieldset
            className="m-0 grid gap-3 border-0 p-0"
            aria-label="How to unlock this account"
          >
            <ChoiceCard
              index={1}
              title="Passkey"
              note="Recommended"
              pick={false}
              disabled={busy || !passkeySupported}
              summary={
                passkeySupported
                  ? "Face ID, Touch ID or your device's own lock. Your keys are derived from the passkey itself, so there is nothing secret for us to store."
                  : "This browser has no passkey support, so this option is unavailable here."
              }
              rows={[
                { label: "New device", value: "Use the same passkey again." },
                { label: "We store", value: "Only its public identifier." },
              ]}
              onSelect={() => onChoose("passkey")}
            />
            <ChoiceCard
              index={2}
              title="6-digit PIN"
              pick={false}
              disabled={busy}
              summary="Your key is encrypted with a PIN you choose; only the encrypted copy is kept. Works in any browser, including ones without passkeys."
              rows={[
                { label: "New device", value: "Enter the same PIN." },
                {
                  label: "Careful",
                  value: "Forget the PIN and the keys cannot be recovered.",
                },
              ]}
              onSelect={() => onChoose("pin")}
            />
            {busy ? (
              <p
                className="flex items-center gap-2 text-sm text-foreground/60"
                role="status"
              >
                <Loader
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                Waiting for your device…
              </p>
            ) : null}
          </fieldset>
        ) : (
          <Button
            className="min-h-11 w-full"
            onClick={onUnlock}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {busy ? "Waiting for passkey…" : "Unlock with passkey"}
          </Button>
        )}

        <ToastFeedback
          message={error}
          variant="error"
          toastId="recovery-error"
        />
      </DialogContent>
    </Dialog>
  );
}
