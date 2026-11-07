import {
  Code2,
  FileText,
  Inbox,
  LayoutGrid,
  Link2,
  Settings,
  Sparkles,
  Store,
  Table2,
} from "lucide-react";
import {
  AGENTS_PATH,
  DASHBOARD_PATH,
  DEVELOPERS_PATH,
  INVOICES_PATH,
  LINKS_PATH,
  REQUESTS_PATH,
  SETTINGS_PATH,
  STOREFRONT_PATH,
  TRANSACTIONS_PATH,
} from "../../lib/auth-routes";

export type NavItem = {
  href: string;
  label: string;
  /** Mobile tab label, when the full one doesn't fit. */
  short?: string;
  /** For the "Other tools" list in Settings. */
  description: string;
  icon: typeof LayoutGrid;
};

// Every dashboard page. The account type (features/account) picks which of
// these the navigation shows and in what order.
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: DASHBOARD_PATH,
    label: "Overview",
    description: "Balance, payment link and recent activity.",
    icon: LayoutGrid,
  },
  {
    href: AGENTS_PATH,
    label: "Agents",
    description: "Ask about your money, and run the seats that think.",
    icon: Sparkles,
  },
  {
    href: LINKS_PATH,
    label: "Links",
    description: "Reusable payment links with a fixed or open amount.",
    icon: Link2,
  },
  {
    href: INVOICES_PATH,
    label: "Invoices",
    description: "Invoices that mark themselves paid, one-off or recurring.",
    icon: FileText,
  },
  {
    href: TRANSACTIONS_PATH,
    label: "Transactions",
    short: "Txns",
    description: "Every ledger posting, sortable and exportable.",
    icon: Table2,
  },
  {
    href: STOREFRONT_PATH,
    label: "Shop",
    description: "A page of things people can pay for, at your own address.",
    icon: Store,
  },
  {
    href: REQUESTS_PATH,
    label: "Requests",
    description: "Ask another @username to pay you, end-to-end encrypted.",
    icon: Inbox,
  },
  {
    href: DEVELOPERS_PATH,
    label: "Developers",
    short: "Dev",
    description: "Checkout API, API keys and signed webhooks.",
    icon: Code2,
  },
  {
    href: SETTINGS_PATH,
    label: "Settings",
    description: "Account, notifications and recovery.",
    icon: Settings,
  },
];
