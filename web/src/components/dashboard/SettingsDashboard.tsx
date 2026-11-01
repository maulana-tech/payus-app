"use client";

import { useState } from "react";
import { accountTypeInfo } from "@/features/account/accountType";
import { EmailNotificationsRow } from "@/features/notifications/EmailNotificationsRow";
import { useChangeRecoveryPin } from "@/features/recovery/hooks/useChangeRecoveryPin";
import { useSession } from "../SessionProvider";
import { ChangeRecoveryPinDialog } from "./ChangeRecoveryPinDialog";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { dashButtonSecondary } from "./styles";

/** Account, recovery and notification settings. */
export function SettingsDashboard({ username }: { username: string }) {
  const { accountType, businessName, recoveryMethod, disconnect } =
    useSession();
  const { changeRecoveryPin, validateCurrentPin, isChanging } =
    useChangeRecoveryPin();
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const type = accountType ? accountTypeInfo(accountType) : null;

  return (
    <>
      <DashboardPageHeader
        title="Settings"
        description="Your account, how you unlock it, and what you get emailed about."
      />
      <div className="grid gap-4">
        <Row label="Username" value={`@${username}`} />
        {type ? (
          <Row
            label="Account type"
            value={
              businessName ? `${type.label} · ${businessName}` : type.label
            }
          />
        ) : null}
        <Row
          label="Unlock method"
          value={recoveryMethod === "passkey" ? "Passkey" : "6-digit PIN"}
          action={
            recoveryMethod === "pin" ? (
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => setPinDialogOpen(true)}
              >
                Change PIN
              </button>
            ) : null
          }
        />
        <EmailNotificationsRow />
        <Row
          label="Session"
          value="Sign out of this browser."
          action={
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => void disconnect()}
            >
              Sign out
            </button>
          }
        />
      </div>
      <ChangeRecoveryPinDialog
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        onSubmit={changeRecoveryPin}
        onValidateCurrentPin={validateCurrentPin}
        isChanging={isChanging}
      />
    </>
  );
}

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-(--dash-radius) bg-(--dash-surface) p-5 ring-1 ring-(--dash-line)">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-(--dash-ash)">
          {label}
        </p>
        <p className="mt-1 truncate text-[15px] text-(--dash-fg)">{value}</p>
      </div>
      {action}
    </div>
  );
}
