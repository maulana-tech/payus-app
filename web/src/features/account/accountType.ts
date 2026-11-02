import {
  DASHBOARD_PATH,
  DEVELOPERS_PATH,
  INVOICES_PATH,
  LINKS_PATH,
  REQUESTS_PATH,
  SETTINGS_PATH,
  STOREFRONT_PATH,
  TRANSACTIONS_PATH,
} from "../../lib/auth-routes";
import type { AccountType } from "../../server/modules/accounts/accounts.schema";

export type { AccountType };

export type AccountTypeInfo = {
  type: AccountType;
  label: string;
  /** One plain sentence: what you do with this account. */
  summary: string;
  /** What the dashboard puts first for this type. */
  tools: string;
  /** The line that helps someone recognise themselves in it. */
  goodIf: string;
};

export const ACCOUNT_TYPES: readonly AccountTypeInfo[] = [
  {
    type: "personal",
    label: "Personal",
    summary:
      "Ask someone to pay you back, or take money from anyone with a link.",
    tools: "Requests, links",
    goodIf: "You split bills more often than you bill anyone.",
  },
  {
    type: "freelancer",
    label: "Freelancer or creator",
    summary:
      "Bill clients by the job, let the invoice remind them, and hear the moment it is paid.",
    tools: "Invoices, links, requests",
    goodIf: "You work job to job and want the paperwork to write itself.",
  },
  {
    type: "business",
    label: "Business",
    summary:
      "Sell from your own site, and reconcile what lands against what you billed.",
    tools: "Invoices, links, developer keys",
    goodIf:
      "Your own software creates the checkout and listens for the webhook.",
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
    TRANSACTIONS_PATH,
    LINKS_PATH,
    STOREFRONT_PATH,
    REQUESTS_PATH,
    SETTINGS_PATH,
  ],
  business: [
    DASHBOARD_PATH,
    INVOICES_PATH,
    TRANSACTIONS_PATH,
    STOREFRONT_PATH,
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
