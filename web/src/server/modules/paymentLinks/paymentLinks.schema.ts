import { z } from "zod";
import { usernameSchema } from "../profiles/profiles.schema";

const MAX_MINOR = 10n ** 12n;

/** Decimal amount in, minor units out; empty means "payer chooses". */
export const amountInput = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value == null || value.trim() === "") return null;
    const v = value.trim();
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter an amount, e.g. 25.00." });
      return z.NEVER;
    }
    const [whole, frac = ""] = v.split(".");
    const minor = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
    if (minor <= 0n || minor > MAX_MINOR) {
      ctx.addIssue({ code: "custom", message: "Amount is out of range." });
      return z.NEVER;
    }
    return minor.toString();
  });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(48, "Use 48 characters or fewer.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens.",
  );

const text = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null(), z.undefined()])
    .transform((v) => (v ? v : null));

export const createLinkInput = z
  .object({
    slug: slugSchema,
    title: z.string().trim().min(1, "Give the link a title.").max(80),
    description: text(500),
    amount: amountInput,
  })
  .strict();

export const updateLinkInput = z
  .object({
    id: z.string().min(8).max(24),
    title: z.string().trim().min(1).max(80),
    description: text(500),
    amount: amountInput,
  })
  .strict();

export const archiveLinkInput = z
  .object({ id: z.string().min(8).max(24), archived: z.boolean() })
  .strict();

export const resolveLinkInput = z
  .object({ owner: usernameSchema, slug: slugSchema })
  .strict();

export const linkOutput = z.object({
  id: z.string(),
  owner: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  amountMinor: z.string().nullable(),
  currency: z.string(),
  state: z.enum(["active", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Minor units → a decimal string for display ("2500" → "25.00"). */
export const toDecimal = (minor: string | null) => {
  if (minor == null) return null;
  const n = BigInt(minor);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
};

export type CreateLinkInput = z.infer<typeof createLinkInput>;
export type UpdateLinkInput = z.infer<typeof updateLinkInput>;
export type ArchiveLinkInput = z.infer<typeof archiveLinkInput>;
export type ResolveLinkInput = z.infer<typeof resolveLinkInput>;
export type LinkOutput = z.infer<typeof linkOutput>;
