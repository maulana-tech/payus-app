"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { SIGN_IN_PATH } from "@/lib/auth-routes";
import { useSession } from "../SessionProvider";
import { DashboardNotice } from "./DashboardNotice";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { dashButtonPrimary } from "./styles";

/**
 * The frame every dashboard screen shares: the sign-in redirect, the loading
 * skeleton, and the prompt to claim a username before anything can be
 * created. `children` is called only once there is a username to act as.
 */
export function DashboardGuard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  /** Rendered beside the title once the screen is usable. */
  action?: ReactNode;
  children: (username: string) => ReactNode;
}) {
  const {
    authenticated,
    sessionReady,
    username,
    usernameResolved,
    openUsernameModal,
  } = useSession();

  useEffect(() => {
    if (!sessionReady || authenticated) return;
    window.location.replace(SIGN_IN_PATH);
  }, [authenticated, sessionReady]);

  if (!sessionReady || !authenticated || !usernameResolved) {
    return (
      <div
        className="motion-safe:animate-pulse"
        role="status"
        aria-busy="true"
        aria-label={`Loading ${title}`}
      >
        <div className="mb-8 space-y-3">
          <div className="h-12 w-56 max-w-full rounded-lg bg-brand-linen/12" />
          <div className="h-4 w-96 max-w-full rounded-full bg-brand-linen/8" />
        </div>
        <div className="h-72 rounded-(--dash-radius) bg-(--dash-surface) ring-1 ring-(--dash-line)" />
      </div>
    );
  }

  if (!username) {
    return (
      <>
        <DashboardPageHeader title={title} description={description} />
        <DashboardNotice
          label="Username needed"
          title="Claim a username first"
          action={
            <button
              type="button"
              onClick={openUsernameModal}
              className={dashButtonPrimary}
            >
              Claim username
            </button>
          }
        >
          Your username identifies every link, invoice and request you create.
        </DashboardNotice>
      </>
    );
  }

  return (
    <>
      <DashboardPageHeader
        title={title}
        description={description}
        action={action}
      />
      {children(username)}
    </>
  );
}
