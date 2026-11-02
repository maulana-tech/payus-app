"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isProtectedRoute } from "../lib/auth-routes";
import { AccountTypeDialog } from "./AccountTypeDialog";
import { BackLink } from "./BackLink";
import { DashboardBackground } from "./dashboard/DashboardBackground";
import { DashboardShell } from "./dashboard/DashboardShell";
import { PinDialog } from "./PinDialog";
import { RecoveryDialog } from "./RecoveryDialog";
import { useSession } from "./SessionProvider";
import { UsernameModal } from "./UsernameModal";

export function AppShell({ children }: { children: ReactNode }) {
  const {
    usernameModalOpen,
    closeUsernameModal,
    pinModalOpen,
    pinMode,
    pinSubmitting,
    pinError,
    submitPin,
    closePinModal,
    recoveryModal,
    recoveryBusy,
    recoveryError,
    passkeySupported,
    chooseRecovery,
    unlockWithPasskey,
    closeRecoveryModal,
    accountUnlocked,
    username,
    accountType,
    accountTypeResolved,
    chooseAccountType,
  } = useSession();
  const pathname = usePathname();
  const isPay = pathname.startsWith("/pay");
  const protectedRoute = isProtectedRoute(pathname);

  const usernameModal = (
    <UsernameModal open={usernameModalOpen} onClose={closeUsernameModal} />
  );
  const pinModal = (
    <PinDialog
      open={pinModalOpen}
      mode={pinMode}
      submitting={pinSubmitting}
      error={pinError}
      onSubmit={submitPin}
      onClose={closePinModal}
    />
  );
  const recoveryDialog = (
    <RecoveryDialog
      modal={recoveryModal}
      busy={recoveryBusy}
      error={recoveryError}
      passkeySupported={passkeySupported}
      onChoose={(method) => void chooseRecovery(method)}
      onUnlock={() => void unlockWithPasskey()}
      onClose={closeRecoveryModal}
    />
  );

  // Onboarding, after the username: which tools to put first.
  const accountTypeDialog = (
    <AccountTypeDialog
      open={
        accountUnlocked &&
        Boolean(username) &&
        accountTypeResolved &&
        accountType === null &&
        !usernameModalOpen
      }
      onChoose={chooseAccountType}
    />
  );

  if (pathname === "/" || protectedRoute) {
    if (pathname !== "/") {
      return (
        <div className="theme-product contents" data-product-theme="">
          <div className="block w-full m-0 p-0">{children}</div>
          {usernameModal}
          {pinModal}
          {recoveryDialog}
          {accountTypeDialog}
        </div>
      );
    }

    return (
      <>
        <div className="block w-full m-0 p-0">{children}</div>
        {usernameModal}
        {pinModal}
        {recoveryDialog}
      </>
    );
  }

  // Widgets framed by merchants' sites (public/embed.js): content only.
  if (pathname.startsWith("/embed/")) {
    return (
      <div className="theme-product contents" data-product-theme="">
        <DashboardBackground compact>
          <div
            id="payus-embed-root"
            className="mx-auto grid w-full max-w-xl gap-4 p-3"
          >
            {children}
          </div>
        </DashboardBackground>
      </div>
    );
  }

  // Standalone public pages share one shell: back link, the cat, content.
  if (
    isPay ||
    pathname.startsWith("/i/") ||
    pathname.startsWith("/shop/") ||
    pathname.startsWith("/unsubscribe/")
  ) {
    return (
      <div className="theme-product contents" data-product-theme="">
        <DashboardBackground>
          <DashboardShell contentClassName="flex min-h-svh max-w-3xl flex-col">
            <header className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center">
              <BackLink className="justify-self-start" />
              <Link href="/" aria-label="Payus home">
                <Image
                  src="/assets/payus-white.svg"
                  alt="Payus"
                  width={40}
                  height={40}
                  className="size-16"
                />
              </Link>
            </header>
            {/* my-auto, not flex-1 + content-center: a card taller than the
                viewport then grows the page instead of being stretched to the
                leftover height and clipped by its own overflow-hidden. */}
            <div className="my-auto grid gap-5 py-8">{children}</div>
          </DashboardShell>
        </DashboardBackground>
      </div>
    );
  }

  return (
    <div className="theme-product contents" data-product-theme="">
      {children}
    </div>
  );
}
