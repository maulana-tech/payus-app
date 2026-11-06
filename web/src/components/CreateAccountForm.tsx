"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { usernameSchema } from "../server/modules/profiles/profiles.schema";
import { OnboardingSettled, OnboardingStep } from "./onboarding/Steps";
import { useSession } from "./SessionProvider";
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

const claimInput = z.object({ username: usernameSchema });
type ClaimInput = z.infer<typeof claimInput>;

export function CreateAccountForm({
  open,
  onClose,
  onClaimed,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onClaimed: (username: string) => void;
  error?: string | null;
}) {
  const { claimUsername, signIn, recoveryMethod } = useSession();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClaimInput>({
    resolver: zodResolver(claimInput),
    defaultValues: { username: "" },
  });

  const usernameField = register("username");

  const onSubmit = handleSubmit(async ({ username }) => {
    try {
      await claimUsername(username);
      onClaimed(username);
    } catch (e) {
      setError("username", {
        message: e instanceof Error ? e.message : "Registration failed.",
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent appearance="linen" size="sm">
        <DialogHeader className="px-1">
          <OnboardingStep step={2} />
          <DialogTitle>Pick your username</DialogTitle>
          <DialogDescription>
            It is how people address money to you, and it is signed with keys
            only your browser can derive — so a payer can check the name really
            is yours.
          </DialogDescription>
        </DialogHeader>

        <OnboardingSettled
          items={
            recoveryMethod
              ? [
                  {
                    label: "Unlocks with",
                    value:
                      recoveryMethod === "passkey"
                        ? "A passkey on this device"
                        : "A 6-digit PIN",
                  },
                ]
              : []
          }
        />

        <form className="grid gap-3" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="username">
              Username
            </label>
            <Input
              appearance="linen"
              id="username"
              className="min-h-11"
              placeholder="jimmymcgill"
              maxLength={20}
              {...usernameField}
              onChange={(e) => {
                e.target.value = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
                usernameField.onChange(e);
              }}
            />
            <span className="text-xs text-muted-foreground">
              3-20 characters. Letters, numbers, underscore. It is signed to
              your keys when you claim it, so it stays yours and cannot be
              changed afterwards.
            </span>
          </div>

          <Button
            variant="default"
            className="min-h-11 w-full"
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting && (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {isSubmitting ? "Creating your account…" : "Claim"}
          </Button>

          <ToastFeedback
            message={errors.username?.message}
            variant="error"
            toastId="create-account-error"
          />
        </form>

        <ToastFeedback
          title="Could not create account"
          message={error}
          variant="error"
          toastId="create-account-submit-error"
          action={{ label: "Try again", onClick: signIn }}
        />
      </DialogContent>
    </Dialog>
  );
}
