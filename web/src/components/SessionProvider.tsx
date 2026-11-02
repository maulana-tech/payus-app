"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AccountType } from "../features/account/accountType";
import { DASHBOARD_PATH, SIGN_IN_PATH } from "../lib/auth-routes";
import { demoMaster, demoUser } from "../lib/demo";
import { messagingSecret, profileSigningSeed } from "../lib/derive";
import {
  decryptMaster,
  deserializeEscrow,
  encryptMaster,
  randomMaster,
  serializeEscrow,
} from "../lib/keys";
import {
  createPasskeyMaster,
  type PasskeyRecord,
  passkeyErrorMessage,
  passkeysAvailable,
  unlockPasskeyMaster,
} from "../lib/passkey";
import { BadPinError } from "../lib/pin-errors";
import {
  messagingPubkeyHex,
  open as openSealed,
  type Sealed,
} from "../lib/sealedBox";
import { signingPubkeyHex } from "../lib/signing";
import {
  canonicalClaim,
  signClaim,
  type UsernameClaim,
} from "../lib/usernameClaim";
import { api } from "../trpc/client";
import type { PinMode } from "./PinDialog";

export type RecoveryMethod = "passkey" | "pin";
export type RecoveryModal = "choose" | "passkey-unlock";

type SessionState = {
  authenticated: boolean;
  sessionReady: boolean;
  connecting: boolean;
  error: string;
  username: string | null;
  usernameResolved: boolean;
  setUsername: (u: string | null) => void;
  usernameModalOpen: boolean;
  openUsernameModal: () => void;
  closeUsernameModal: () => void;
  /** Claims @username with a claim signed by this account's keys. */
  claimUsername: (username: string) => Promise<void>;
  accountType: AccountType | null;
  businessName: string | null;
  accountTypeResolved: boolean;
  chooseAccountType: (
    type: AccountType,
    businessName?: string | null,
  ) => Promise<void>;
  accountUnlocked: boolean;
  pinModalOpen: boolean;
  pinMode: PinMode;
  pinSubmitting: boolean;
  pinError: string;
  submitPin: (pin: string) => Promise<void>;
  closePinModal: () => void;
  promptUnlock: () => void;
  signIn: () => void;
  disconnect: () => Promise<void>;
  recoveryMethod: RecoveryMethod | null;
  recoveryModal: RecoveryModal | null;
  recoveryBusy: boolean;
  recoveryError: string;
  passkeySupported: boolean;
  chooseRecovery: (method: RecoveryMethod) => Promise<void>;
  unlockWithPasskey: () => Promise<void>;
  closeRecoveryModal: () => void;
  /** Opens a sealed box addressed to this account; null while locked. */
  openBox: <T>(box: Sealed) => T | null;
  /** This account's messaging public key; null while locked. */
  messagingPubkey: () => string | null;
};

const SessionContext = createContext<SessionState | null>(null);

/**
 * Privy login, then unlock: a passkey (PRF) or a 6-digit PIN produces the
 * account master. Every other key is derived from it (lib/derive) and lives
 * in page memory only — nothing secret is ever sent to the server.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Public payment pages must not bootstrap an account or redirect.
  const payerRoute = Boolean(
    pathname?.startsWith("/pay") ||
      pathname?.startsWith("/i/") ||
      pathname?.startsWith("/unsubscribe") ||
      pathname?.startsWith("/embed/"),
  );
  const { ready, authenticated, user, login, logout } = usePrivy();
  const userId = user?.id ?? null;

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [usernameResolved, setUsernameResolved] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [accountTypeResolved, setAccountTypeResolved] = useState(false);
  const [accountUnlocked, setAccountUnlocked] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>("unlock");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinError, setPinError] = useState("");
  const [recoveryMethod, setRecoveryMethod] = useState<RecoveryMethod | null>(
    null,
  );
  const [recoveryModal, setRecoveryModal] = useState<RecoveryModal | null>(
    null,
  );
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);

  // Secrets live in refs (page memory) only, and are wiped on disconnect.
  const masterRef = useRef<Uint8Array | null>(null);
  const pendingMasterRef = useRef<Uint8Array | null>(null);
  const passkeyRef = useRef<(PasskeyRecord & { signPubkeyHex: string }) | null>(
    null,
  );
  const sessionRef = useRef(0);

  useEffect(() => setPasskeySupported(passkeysAvailable()), []);

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const routeToDashboard = useCallback(() => {
    if (pathnameRef.current === SIGN_IN_PATH) router.replace(DASHBOARD_PATH);
  }, [router]);

  const openPinModal = useCallback((mode: PinMode) => {
    setPinMode(mode);
    setPinError("");
    setPinModalOpen(true);
  }, []);

  const openRecoveryModal = useCallback((modal: RecoveryModal) => {
    setRecoveryError("");
    setRecoveryModal(modal);
  }, []);

  const afterUnlock = useCallback((name: string | null) => {
    setAccountUnlocked(true);
    if (!name) setUsernameModalOpen(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const session = ++sessionRef.current;
    if (!authenticated || !userId) {
      setUsername(null);
      setUsernameResolved(false);
      setAccountType(null);
      setBusinessName(null);
      setAccountTypeResolved(false);
      setAccountUnlocked(false);
      setSessionReady(true);
      return;
    }
    if (payerRoute) {
      setSessionReady(true);
      return;
    }
    let cancelled = false;
    setConnecting(true);
    setSessionReady(false);
    setError("");
    api.accounts.me
      .query()
      .then((me) => {
        if (cancelled || session !== sessionRef.current) return;
        setUsername(me.username);
        setUsernameResolved(true);
        setAccountType(me.accountType);
        setBusinessName(me.businessName);
        setAccountTypeResolved(true);
        setRecoveryMethod(me.recovery);
        passkeyRef.current = me.passkey;
        if (masterRef.current) return; // already unlocked this page
        if (me.recovery === "passkey") openRecoveryModal("passkey-unlock");
        else if (me.recovery === "pin") openPinModal("unlock");
        else if (passkeysAvailable()) openRecoveryModal("choose");
        else {
          pendingMasterRef.current = randomMaster();
          openPinModal("set");
        }
        routeToDashboard();
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Could not load account.",
          );
      })
      .finally(() => {
        if (!cancelled) {
          setConnecting(false);
          setSessionReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    authenticated,
    userId,
    payerRoute,
    openPinModal,
    openRecoveryModal,
    routeToDashboard,
  ]);

  const chooseRecovery = useCallback(
    async (method: RecoveryMethod) => {
      setRecoveryError("");
      if (method === "pin") {
        pendingMasterRef.current = randomMaster();
        setRecoveryModal(null);
        openPinModal("set");
        return;
      }
      setRecoveryBusy(true);
      try {
        const { master, record } = await createPasskeyMaster({
          userName: user?.email?.address ?? user?.google?.email ?? "account",
        });
        const signPubkeyHex = signingPubkeyHex(profileSigningSeed(master));
        await api.accounts.savePasskey.mutate({ ...record, signPubkeyHex });
        passkeyRef.current = { ...record, signPubkeyHex };
        masterRef.current = master;
        setRecoveryMethod("passkey");
        setRecoveryModal(null);
        afterUnlock(username);
      } catch (cause) {
        setRecoveryError(passkeyErrorMessage(cause));
      } finally {
        setRecoveryBusy(false);
      }
    },
    [user, username, openPinModal, afterUnlock],
  );

  const unlockWithPasskey = useCallback(async () => {
    const record = passkeyRef.current;
    if (!record) return;
    setRecoveryBusy(true);
    setRecoveryError("");
    try {
      const master = await unlockPasskeyMaster({ record });
      if (
        signingPubkeyHex(profileSigningSeed(master)) !== record.signPubkeyHex
      ) {
        master.fill(0);
        throw new Error(
          "This passkey derived different keys than your account uses. Choose the passkey you created for this account.",
        );
      }
      masterRef.current = master;
      setRecoveryModal(null);
      afterUnlock(username);
    } catch (cause) {
      setRecoveryError(passkeyErrorMessage(cause));
    } finally {
      setRecoveryBusy(false);
    }
  }, [username, afterUnlock]);

  const submitPin = useCallback(
    async (pin: string) => {
      setPinSubmitting(true);
      setPinError("");
      try {
        if (pinMode === "set" || pinMode === "secure") {
          const master = pendingMasterRef.current ?? randomMaster();
          await api.accounts.saveEscrow.mutate(
            serializeEscrow(encryptMaster(master, pin)),
          );
          pendingMasterRef.current = null;
          masterRef.current = master;
          setRecoveryMethod("pin");
        } else {
          const escrow = await api.accounts.getEscrow.query();
          if (!escrow) {
            openPinModal("set");
            return;
          }
          try {
            masterRef.current = decryptMaster(deserializeEscrow(escrow), pin);
          } catch {
            throw new BadPinError();
          }
        }
        setPinModalOpen(false);
        afterUnlock(username);
      } catch (cause) {
        setPinError(
          cause instanceof BadPinError
            ? "Incorrect PIN. Try again."
            : cause instanceof Error
              ? cause.message
              : "Something went wrong.",
        );
      } finally {
        setPinSubmitting(false);
      }
    },
    [pinMode, username, openPinModal, afterUnlock],
  );

  const claimUsername = useCallback(async (name: string) => {
    const master = masterRef.current;
    if (!master) throw new Error("Unlock your account first.");
    const seed = profileSigningSeed(master);
    const claim: UsernameClaim = {
      v: 1,
      username: name,
      signPubkeyHex: signingPubkeyHex(seed),
      msgPubkeyHex: messagingPubkeyHex(messagingSecret(master)),
      issuedAt: new Date().toISOString(),
    };
    await api.profiles.create.mutate({
      claimJson: canonicalClaim(claim),
      claimSigHex: signClaim(claim, seed),
    });
    setUsername(name);
    setUsernameModalOpen(false);
  }, []);

  const chooseAccountType = useCallback(
    async (type: AccountType, name: string | null = null) => {
      const saved = await api.accounts.setAccountType.mutate({
        accountType: type,
        businessName: name?.trim() || null,
      });
      setAccountType(saved.accountType);
      setBusinessName(saved.businessName);
    },
    [],
  );

  const openBox = useCallback(<T,>(box: Sealed): T | null => {
    const master = masterRef.current;
    if (!master) return null;
    try {
      return openSealed<T>(box, messagingSecret(master));
    } catch {
      return null;
    }
  }, []);

  const messagingPubkey = useCallback(() => {
    const master = masterRef.current;
    return master ? messagingPubkeyHex(messagingSecret(master)) : null;
  }, []);

  const closeRecoveryModal = useCallback(() => {
    setRecoveryModal(null);
  }, []);

  const signIn = useCallback(() => {
    if (!authenticated) login();
  }, [authenticated, login]);

  const disconnect = useCallback(async () => {
    masterRef.current?.fill(0);
    masterRef.current = null;
    pendingMasterRef.current?.fill(0);
    pendingMasterRef.current = null;
    passkeyRef.current = null;
    setAccountUnlocked(false);
    setUsername(null);
    setUsernameResolved(false);
    setAccountType(null);
    setBusinessName(null);
    setAccountTypeResolved(false);
    setRecoveryMethod(null);
    setRecoveryModal(null);
    setPinModalOpen(false);
    await logout();
  }, [logout]);

  const openUsernameModal = useCallback(() => setUsernameModalOpen(true), []);
  const closeUsernameModal = useCallback(() => setUsernameModalOpen(false), []);
  const closePinModal = useCallback(() => {
    if (pinMode !== "unlock") setPinModalOpen(false);
  }, [pinMode]);
  const promptUnlock = useCallback(() => {
    if (recoveryMethod === "passkey") openRecoveryModal("passkey-unlock");
    else openPinModal("unlock");
  }, [recoveryMethod, openPinModal, openRecoveryModal]);

  const demoValue = useDemoSession();

  const value = useMemo<SessionState>(
    () => ({
      authenticated,
      sessionReady,
      connecting,
      error,
      username,
      usernameResolved,
      setUsername,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      claimUsername,
      accountType,
      businessName,
      accountTypeResolved,
      chooseAccountType,
      accountUnlocked,
      pinModalOpen,
      pinMode,
      pinSubmitting,
      pinError,
      submitPin,
      closePinModal,
      promptUnlock,
      signIn,
      disconnect,
      recoveryMethod,
      recoveryModal,
      recoveryBusy,
      recoveryError,
      passkeySupported,
      chooseRecovery,
      unlockWithPasskey,
      closeRecoveryModal,
      openBox,
      messagingPubkey,
    }),
    [
      authenticated,
      sessionReady,
      connecting,
      error,
      username,
      usernameResolved,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      claimUsername,
      accountType,
      businessName,
      accountTypeResolved,
      chooseAccountType,
      accountUnlocked,
      pinModalOpen,
      pinMode,
      pinSubmitting,
      pinError,
      submitPin,
      closePinModal,
      promptUnlock,
      signIn,
      disconnect,
      recoveryMethod,
      recoveryModal,
      recoveryBusy,
      recoveryError,
      passkeySupported,
      chooseRecovery,
      unlockWithPasskey,
      closeRecoveryModal,
      openBox,
      messagingPubkey,
    ],
  );

  return (
    <SessionContext.Provider value={demoValue ?? value}>
      {children}
    </SessionContext.Provider>
  );
}

/**
 * Development only: a session for the username in NEXT_PUBLIC_DEMO_USER, so
 * the dashboard can be looked at without a login provider. `demoUser()`
 * returns null outside development, so this hook yields null in any
 * production build and the real session above is the only one.
 */
function useDemoSession(): SessionState | null {
  const name = demoUser();
  return useMemo(() => {
    if (!name) return null;
    const master = demoMaster(name);
    const messaging = messagingSecret(master);
    const noop = () => {};
    return {
      authenticated: true,
      sessionReady: true,
      connecting: false,
      error: "",
      username: name,
      usernameResolved: true,
      setUsername: noop,
      usernameModalOpen: false,
      openUsernameModal: noop,
      closeUsernameModal: noop,
      claimUsername: async () => {},
      accountType: "business",
      businessName: "Demo Co",
      accountTypeResolved: true,
      chooseAccountType: async () => {},
      accountUnlocked: true,
      pinModalOpen: false,
      pinMode: "unlock",
      pinSubmitting: false,
      pinError: "",
      submitPin: async () => {},
      closePinModal: noop,
      promptUnlock: noop,
      signIn: noop,
      disconnect: async () => {},
      recoveryMethod: "pin",
      recoveryModal: null,
      recoveryBusy: false,
      recoveryError: "",
      passkeySupported: false,
      chooseRecovery: async () => {},
      unlockWithPasskey: async () => {},
      closeRecoveryModal: noop,
      openBox: <T,>(box: Sealed) => {
        try {
          return openSealed<T>(box, messaging);
        } catch {
          return null;
        }
      },
      messagingPubkey: () => messagingPubkeyHex(messaging),
    };
  }, [name]);
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value)
    throw new Error("useSession must be used inside a SessionProvider.");
  return value;
}
