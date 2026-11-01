"use client";

import { CreateAccountForm } from "./CreateAccountForm";
import { useSession } from "./SessionProvider";

// Onboarding modal shown to a connected user who has no username yet. Wraps the
// shared CreateAccountForm; on a successful claim it updates the session
// (so the nav reflects @username) and closes.
export function UsernameModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { setUsername, error } = useSession();

  return (
    <CreateAccountForm
      open={open}
      onClose={onClose}
      error={error}
      onClaimed={(name) => {
        setUsername(name);
        onClose();
      }}
    />
  );
}
