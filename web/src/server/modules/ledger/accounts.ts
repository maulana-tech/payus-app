import type { AccountKind } from "../../db/schema";

// Account ids are readable and derivable: `<kind>`, `<kind>:<owner>`, or
// `pos:<owner>:<slug>`. Nothing else may build one by hand.

export const account = {
  /** Asset: money sitting at PayPal. */
  paypalCash: () => "paypal_cash",
  /** Expense: what PayPal keeps out of a capture. */
  pspFee: () => "psp_fee",
  /** Revenue: our cut. */
  platformFee: () => "platform_fee",
  /** Liability: captured for this merchant, not split yet. */
  inFlight: (owner: string) => `in_flight:${owner}`,
  /** Liability: set aside for this merchant's tax. */
  taxReserve: (owner: string) => `tax_reserve:${owner}`,
  /** Liability: owed to this merchant, awaiting payout. */
  merchantPayable: (owner: string) => `merchant_payable:${owner}`,
  /** Liability: one of this user's envelopes. */
  pos: (owner: string, slug: string) => `pos:${owner}:${slug}`,
  /** Anything outside this system (a payer's wallet, a paid-out bank). */
  external: () => "external",
} as const;

const KINDS = new Set<AccountKind>([
  "pos",
  "in_flight",
  "platform_fee",
  "tax_reserve",
  "merchant_payable",
  "paypal_cash",
  "psp_fee",
  "external",
]);

/** The kind and owner an account id encodes. */
export function parseAccount(id: string): {
  kind: AccountKind;
  owner: string | null;
} {
  const [kind, owner] = id.split(":");
  if (!KINDS.has(kind as AccountKind))
    throw new Error(`Unknown ledger account kind in "${id}"`);
  return { kind: kind as AccountKind, owner: owner ?? null };
}

/**
 * The side on which each kind normally carries its balance. Assets and
 * expenses grow with debits; liabilities and revenue grow with credits. A
 * balance is reported in this direction, so day-to-day numbers are positive.
 */
const NORMAL_SIDE: Record<AccountKind, "debit" | "credit"> = {
  pos: "credit",
  in_flight: "credit",
  platform_fee: "credit",
  tax_reserve: "credit",
  merchant_payable: "credit",
  paypal_cash: "debit",
  psp_fee: "debit",
  external: "debit",
};

export const normalSide = (id: string) => NORMAL_SIDE[parseAccount(id).kind];

/** A human label, used when an account row is created on first use. */
export function labelFor(id: string): string {
  const { kind, owner } = parseAccount(id);
  const slug = id.split(":")[2];
  const base = kind.replaceAll("_", " ");
  if (kind === "pos") return `${owner} · ${slug}`;
  return owner ? `${base} · ${owner}` : base;
}
