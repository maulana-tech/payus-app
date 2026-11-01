import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(20, "Use 20 characters or fewer.")
  .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores.");

const RESERVED = new Set([
  "admin",
  "api",
  "app",
  "checkout",
  "dashboard",
  "developers",
  "embed",
  "help",
  "invoices",
  "links",
  "pay",
  "payus",
  "requests",
  "settings",
  "support",
  "webhooks",
]);

export const createProfileInput = z
  .object({
    claimJson: z.string().min(10).max(2000),
    claimSigHex: z
      .string()
      .length(128)
      .regex(/^[0-9a-fA-F]+$/),
  })
  .strict();

export const usernameInput = z.object({ username: usernameSchema }).strict();

export const publicProfileOutput = z.object({
  username: z.string(),
  signPubkeyHex: z.string(),
  msgPubkeyHex: z.string(),
  claimJson: z.string(),
  claimSigHex: z.string(),
});

export const isReservedUsername = (name: string) => RESERVED.has(name);

export type CreateProfileInput = z.infer<typeof createProfileInput>;
export type PublicProfile = z.infer<typeof publicProfileOutput>;
