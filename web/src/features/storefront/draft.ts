// A shop as it is being edited: the same fields the schema takes, but every
// number still a half-typed string. One module owns the three conversions —
// a stored shop in, the mutation's input out, and a view for the canvas to
// render — so the editor and the page it previews cannot drift apart.

import { toMinor } from "../invoices/money";
import type {
  Accent,
  PublicStorefrontView,
  StorefrontInput,
  Template,
  Theme,
} from "./config";

export type Line = {
  name: string;
  description: string;
  /** A decimal as typed ("18.00"). Empty means the payer names it. */
  price: string;
  min: string;
  max: string;
  quantity: boolean;
  limit: string;
  soldOut: boolean;
};

export type Draft = {
  slug: string;
  title: string;
  blurb: string;
  html: string;
  template: Template;
  theme: Theme;
  accent: Accent;
  lines: Line[];
};

/** What a stored shop looks like coming back from `storefront.mine`. */
type StoredShop = {
  slug: string;
  title: string;
  blurb: string;
  html: string;
  template: string;
  theme: string;
  accent: string;
  products: {
    name: string;
    description: string;
    priceMinor: string | null;
    minMinor: string | null;
    maxMinor: string | null;
    quantity: boolean;
    limit: number;
    soldOut: boolean;
  }[];
};

export const emptyLine: Line = {
  name: "",
  description: "",
  price: "",
  min: "",
  max: "",
  quantity: false,
  limit: "10",
  soldOut: false,
};

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export const blankDraft = (): Draft => ({
  slug: "",
  title: "",
  blurb: "",
  html: "",
  template: "shelf",
  theme: "paper",
  accent: "clay",
  lines: [{ ...emptyLine }],
});

const decimal = (minor: string | null): string => {
  if (!minor) return "";
  const value = BigInt(minor);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
};

export const draftFrom = (shop: StoredShop): Draft => ({
  slug: shop.slug,
  title: shop.title,
  blurb: shop.blurb,
  html: shop.html,
  template: shop.template as Template,
  theme: shop.theme as Theme,
  accent: shop.accent as Accent,
  lines: shop.products.map((product) => ({
    name: product.name,
    description: product.description,
    price: decimal(product.priceMinor),
    min: decimal(product.minMinor),
    max: decimal(product.maxMinor),
    quantity: product.quantity,
    limit: String(product.limit),
    soldOut: product.soldOut,
  })),
});

/** The mutation's input. The schema still has the final word on all of it. */
export const toInput = (draft: Draft): StorefrontInput => ({
  slug: draft.slug || slugify(draft.title),
  title: draft.title,
  blurb: draft.blurb,
  template: draft.template,
  theme: draft.theme,
  accent: draft.accent,
  html: draft.html,
  products: draft.lines.map((line) => {
    // A tip jar is priced by the payer, and so is any line left blank.
    const open = draft.template === "tip" || !line.price.trim();
    return {
      name: line.name,
      description: line.description,
      price: open ? null : line.price,
      // Bounds belong to an item the payer prices; the schema refuses them
      // on anything else, so they are dropped rather than sent.
      min: open ? line.min || null : null,
      max: open ? line.max || null : null,
      quantity: line.quantity,
      limit: Number(line.limit) || 10,
      soldOut: line.soldOut,
    };
  }),
});

/**
 * Minor units from a decimal still being typed. Junk and half-numbers are
 * `null` rather than an error: this feeds a live preview, and a page that
 * throws while someone types a price is worse than one reading "You choose".
 */
const minorOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const minor = toMinor(trimmed);
    return minor > 0n ? minor.toString() : null;
  } catch {
    return null;
  }
};

/**
 * The draft as the renderer wants it, so the canvas shows the real page
 * rather than a sketch of one. Ids are positional: nothing here is paid for.
 */
export const toPreview = (
  draft: Draft,
  owner: string,
  htmlClean: string,
  currency = "USD",
): PublicStorefrontView => ({
  id: "preview",
  owner,
  slug: draft.slug || slugify(draft.title) || "your-shop",
  title: draft.title || "Your shop",
  blurb: draft.blurb,
  template: draft.template,
  theme: draft.theme,
  accent: draft.accent,
  htmlClean,
  currency,
  state: "draft",
  writtenBy: "owner",
  products: draft.lines.map((line, index) => {
    const open = draft.template === "tip" || !line.price.trim();
    return {
      id: `preview-${index}`,
      name: line.name || "Untitled",
      description: line.description,
      priceMinor: open ? null : minorOrNull(line.price),
      minMinor: open ? minorOrNull(line.min) : null,
      maxMinor: open ? minorOrNull(line.max) : null,
      quantity: line.quantity,
      limit: Math.max(1, Number(line.limit) || 10),
      soldOut: line.soldOut,
    };
  }),
  updatedAt: new Date().toISOString(),
});
