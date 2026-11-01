import { getAccessToken } from "@privy-io/react-auth";

// Privy leaves a session cookie and/or a token in storage once someone has
// signed in on this device. Without either there is no token to send, and
// asking Privy for one would hold every request until its SDK has booted
// (payers on /pay, /i and /claim never sign in).
function maybeSignedIn(): boolean {
  try {
    if (/(?:^|;\s*)privy-(?:[\w-]+-)?(?:session|token)=/.test(document.cookie))
      return true;
    return Object.keys(localStorage).some(
      (key) => key.startsWith("privy:") && key.endsWith("token"),
    );
  } catch {
    return true;
  }
}

/** Longest a request waits for Privy; after that the cookie has to do. */
const TOKEN_WAIT_MS = 4000;

/** Bearer header for tRPC requests (the server also reads the privy-token cookie). */
export async function authHeader(): Promise<Record<string, string>> {
  if (typeof window === "undefined" || !maybeSignedIn()) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const token = await Promise.race([
    getAccessToken().catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), TOKEN_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  return token ? { authorization: `Bearer ${token}` } : {};
}
