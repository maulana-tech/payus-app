import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

export const publicEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_PRIVY_APP_ID: optionalString,
});

/**
 * Keep every public variable as a direct property access. Next.js only embeds
 * NEXT_PUBLIC_* values in browser bundles when it can see this static form.
 */
export function getPublicEnv() {
  return publicEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  });
}

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const env: PublicEnv = getPublicEnv();
