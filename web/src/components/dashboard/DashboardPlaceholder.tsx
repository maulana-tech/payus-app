"use client";

import { useEffect } from "react";
import { SIGN_IN_PATH } from "@/lib/auth-routes";
import { useSession } from "../SessionProvider";
import { DashboardNotice } from "./DashboardNotice";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { dashButtonPrimary } from "./styles";

/**
 * A dashboard page whose screen has not been built yet: the shell, the auth
 * guard and the username prompt are real, the body is a placeholder. Replace
 * one of these with the actual screen as each feature lands.
 */
export function DashboardPlaceholder({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
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

  if (!sessionReady || !authenticated) {
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

  return (
    <>
      <DashboardPageHeader title={title} description={description} />
      {usernameResolved && !username ? (
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
      ) : (
        (children ?? (
          <DashboardNotice label="Not built yet" title="Nothing here yet">
            The server module behind this page still exists; the screen is
            waiting to be rebuilt on the new payment rail.
          </DashboardNotice>
        ))
      )}
    </>
  );
}
