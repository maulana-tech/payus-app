export interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Shared with InstallApp: the user already said no to our own card. */
export const INSTALL_DISMISSED_KEY = "payus:pwa-install-dismissed";

let pending: InstallEvent | null = null;

/**
 * True when Chrome should keep its own install UI. Calling preventDefault()
 * suppresses it, so we only do that while our card can actually appear: once
 * the user dismisses the card (or Payus already runs installed) suppressing the
 * browser's banner would leave no way to install at all.
 */
function browserHandlesInstall() {
  try {
    if (localStorage.getItem(INSTALL_DISMISSED_KEY) === "1") return true;
  } catch {}
  try {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return Boolean(standalone);
  } catch {
    return false;
  }
}

export function rememberInstallPrompt(event: Event) {
  if (browserHandlesInstall()) return;
  event.preventDefault();
  pending = event as InstallEvent;
}

export function getInstallPrompt() {
  return pending;
}

export function clearInstallPrompt() {
  pending = null;
}
