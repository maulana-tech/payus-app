import {
  DASHBOARD_PATH,
  DEVELOPERS_PATH,
  INVOICES_PATH,
  LINKS_PATH,
  REQUESTS_PATH,
  SETTINGS_PATH,
} from "../../lib/auth-routes";
import type { AccountType } from "../../server/modules/accounts/accounts.schema";

export type { AccountType };

export type AccountTypeInfo = {
  type: AccountType;
  label: string;
  /** One line under the label in the picker. */
  summary: string;
  /** What the dashboard puts first for this type. */
  tools: string;
};

export const ACCOUNT_TYPES: readonly AccountTypeInfo[] = [
  {
    type: "personal",
    label: "Personal",
    summary: "Request and receive money from friends and family.",
    tools: "Requests, payment link",
  },
  {
    type: "freelancer",
    label: "Freelancer or creator",
    summary: "Invoice clients and take payments for your work.",
    tools: "Invoices, payment links, requests",
  },
  {
    type: "business",
    label: "Business",
    summary: "Sell online and reconcile what comes in.",
    tools: "Invoices, payment links, checkout API",
  },
];

export function accountTypeInfo(type: AccountType): AccountTypeInfo {
  return ACCOUNT_TYPES.find((t) => t.type === type) ?? ACCOUNT_TYPES[0];
}

// Dashboard routes each type shows, in navigation order. The rest stay
// reachable from Settings ("Other tools"); nothing is locked away.
const NAV: Record<AccountType, readonly string[]> = {
  personal: [DASHBOARD_PATH, REQUESTS_PATH, LINKS_PATH, SETTINGS_PATH],
  freelancer: [
    DASHBOARD_PATH,
    INVOICES_PATH,
    LINKS_PATH,
    REQUESTS_PATH,
    SETTINGS_PATH,
  ],
  business: [
    DASHBOARD_PATH,
    INVOICES_PATH,
    LINKS_PATH,
    DEVELOPERS_PATH,
    SETTINGS_PATH,
  ],
};

/**
 * Orders `items` for the account type and drops the ones it doesn't use.
 * Without a type yet (before onboarding) every item is shown.
 */
export function navFor<T extends { href: string }>(
  type: AccountType | null,
  items: readonly T[],
): T[] {
  if (!type) return [...items];
  return NAV[type].flatMap((href) => items.filter((i) => i.href === href));
}

/** Items the account type hides, for the "Other tools" list in Settings. */
export function hiddenFor<T extends { href: string }>(
  type: AccountType | null,
  items: readonly T[],
): T[] {
  if (!type) return [];
  return items.filter((i) => !NAV[type].includes(i.href));
}
