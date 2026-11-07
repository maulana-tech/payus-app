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
  // The same client id as PAYPAL_CLIENT_ID; the payer's browser loads the
  // PayPal SDK with it. Absent means this deployment cannot take payments.
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: optionalString,
  /**
   * Development only: act as this username without signing in, so the
   * dashboard screens can be looked at. Ignored outside `NODE_ENV`
   * development — see `lib/demo.ts`.
   */
  NEXT_PUBLIC_DEMO_USER: optionalString,
  /**
   * "true" turns on the public demo: a sandbox account per visitor, in
   * production. Unlike NEXT_PUBLIC_DEMO_USER this is not development-only,
   * so what a demo account may do is fenced in code rather than by NODE_ENV.
   */
  NEXT_PUBLIC_PUBLIC_DEMO: optionalString,
});

/**
 * Keep every public variable as a direct property access. Next.js only embeds
 * NEXT_PUBLIC_* values in browser bundles when it can see this static form.
 */
export function getPublicEnv() {
  return publicEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
    NEXT_PUBLIC_DEMO_USER: process.env.NEXT_PUBLIC_DEMO_USER,
    NEXT_PUBLIC_PUBLIC_DEMO: process.env.NEXT_PUBLIC_PUBLIC_DEMO,
  });
}

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const env: PublicEnv = getPublicEnv();
