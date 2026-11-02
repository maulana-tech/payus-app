import { z } from "zod";
import { CURRENCIES, DEFAULT_CURRENCY, toMinor } from "../invoices/money";

// What a storefront is allowed to be. Everything that renders a storefront
// reads this schema, so a configuration written by hand and one written by
// an agent are held to exactly the same shape — and neither can carry markup.

export const MAX_PRODUCTS = 12;

/**
 * The look a shop can wear. These are the whole vocabulary — a storefront
 * chooses from them, it does not describe a page of its own — and they are
 * named after what they feel like rather than what they are made of.
 */
export const THEMES = ["paper", "ink", "sun"] as const;
export type Theme = (typeof THEMES)[number];

export const ACCENTS = [
  "clay",
  "olive",
  "indigo",
  "plum",
  "ochre",
  "sea",
] as const;
export type Accent = (typeof ACCENTS)[number];

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(40, "Use 40 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens.",
  );

/** Addresses the app needs for itself. */
const RESERVED = new Set([
  "api",
  "app",
  "shop",
  "admin",
  "dashboard",
  "settings",
  "payus",
  "about",
  "help",
  "support",
  "new",
  "edit",
]);

export const isReservedSlug = (slug: string) => RESERVED.has(slug);

/** A price as typed: a decimal string, or empty for "payer chooses". */
export const priceInput = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value == null || value.trim() === "") return null;
    try {
      const minor = toMinor(value.trim());
      if (minor <= 0n) throw new Error("zero");
      if (minor > 100_000_000n) throw new Error("too large");
      return minor.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a price like 25.00." });
      return z.NEVER;
    }
  });

export const productInput = z
  .object({
    name: z.string().trim().min(1, "Give it a name.").max(80),
    description: z.string().trim().max(200).default(""),
    price: priceInput,
  })
  .strict();

export const storefrontInput = z
  .object({
    slug: slugSchema.refine(
      (s) => !isReservedSlug(s),
      "That address is taken.",
    ),
    title: z.string().trim().min(1, "Give the shop a name.").max(80),
    blurb: z.string().trim().max(300).default(""),
    template: z.enum(["shelf", "tip"]),
    theme: z.enum(THEMES).default("paper"),
    accent: z.enum(ACCENTS).default("clay"),
    currency: z.enum(CURRENCIES).default(DEFAULT_CURRENCY),
    products: z.array(productInput).min(1).max(MAX_PRODUCTS),
  })
  .strict()
  .refine(
    (config) =>
      config.template !== "tip" ||
      config.products.every((product) => product.price === null),
    { message: "A tip jar lets the payer choose, so leave its prices empty." },
  );

export type StorefrontInput = z.input<typeof storefrontInput>;
export type StorefrontConfig = z.output<typeof storefrontInput>;

export type StorefrontView = {
  id: string;
  owner: string;
  slug: string;
  title: string;
  blurb: string;
  template: "shelf" | "tip";
  theme: Theme;
  accent: Accent;
  currency: string;
  state: "draft" | "published";
  writtenBy: string;
  products: {
    id: string;
    name: string;
    description: string;
    priceMinor: string | null;
  }[];
  updatedAt: string;
};
