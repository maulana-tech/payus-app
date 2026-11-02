"use client";

import Link from "next/link";
import { useState } from "react";
import { accountTypeInfo, hiddenFor } from "@/features/account/accountType";
import { EmailNotificationsRow } from "@/features/notifications/EmailNotificationsRow";
import { useChangeRecoveryPin } from "@/features/recovery/hooks/useChangeRecoveryPin";
import { useSession } from "../SessionProvider";
import { ChangeRecoveryPinDialog } from "./ChangeRecoveryPinDialog";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { NAV_ITEMS } from "./navItems";
import { dashButtonSecondary } from "./styles";

/** Account, recovery and notification settings. */
export function SettingsDashboard({ username }: { username: string }) {
  const { accountType, businessName, recoveryMethod, disconnect } =
    useSession();
  const { changeRecoveryPin, validateCurrentPin, isChanging } =
    useChangeRecoveryPin();
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const type = accountType ? accountTypeInfo(accountType) : null;
  // The account type orders the navigation; it never locks a page away.
  const others = hiddenFor(accountType, NAV_ITEMS);

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
      {others.length > 0 ? (
        <section className="mt-8">
          <h2 className="dashboard-tile-title">Other tools</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-(--dash-ash)">
            Your account type decides what the navigation shows first. Nothing
            is locked away — these are the pages it leaves out.
          </p>
          <div className="mt-4 grid gap-4">
            {others.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-wrap items-center justify-between gap-4 rounded-(--dash-radius) bg-(--dash-surface) p-5 ring-1 ring-(--dash-line) transition-colors hover:ring-(--dash-line-strong)"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <item.icon
                    className="size-4 shrink-0 text-(--dash-ash)"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-[15px] text-(--dash-fg)">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-sm text-(--dash-ash)">
                      {item.description}
                    </span>
                  </span>
                </span>
                <span className={dashButtonSecondary}>Open</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
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
