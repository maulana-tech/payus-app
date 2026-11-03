import "server-only";

import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);
export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: optionalString,
  CRON_SECRET: optionalString,
  PRIVY_APP_ID: optionalString,
  PRIVY_APP_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  /** The bot that carries approvals. Without it, Telegram is simply off. */
  TELEGRAM_BOT_TOKEN: optionalString,
  /** Sent back by Telegram as X-Telegram-Bot-Api-Secret-Token. */
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  EMAIL_FROM: optionalString,
  APP_URL: optionalString,
  // PayPal REST. `sandbox` unless deliberately pointed at live.
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  // From the webhook you registered; without it no event is trusted.
  PAYPAL_WEBHOOK_ID: optionalString,
  // "true" once Payouts is approved on the PayPal account. Until then a
  // release is recorded as simulated and labelled in the UI.
  PAYPAL_PAYOUTS_ENABLED: optionalString,
  // Without it the agents are switched off; the rail works regardless.
  ANTHROPIC_API_KEY: optionalString,
  /**
   * Which way the agents reach Claude. Left unset it follows the key: an
   * `ANTHROPIC_API_KEY` means the first-party API. Set it to "bedrock" to go
   * through Amazon Bedrock instead, which needs a region below and leaves
   * credentials to the ordinary AWS chain (env vars, profile, or an IAM role
   * with no environment variable at all).
   */
  ANTHROPIC_BACKEND: z.enum(["api", "bedrock"]).optional(),
  BEDROCK_AWS_REGION: optionalString,
  /**
   * The exact id to ask Bedrock for. Leave unset in us-east-1; elsewhere set
   * the inference profile, e.g. "au.anthropic.claude-opus-5-5" in Sydney.
   */
  BEDROCK_MODEL_ID: optionalString,
  AWS_REGION: optionalString,
});

export function getServerEnv() {
  return serverEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    PRIVY_APP_ID: process.env.PRIVY_APP_ID,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_URL: process.env.APP_URL,
    PAYPAL_ENV: process.env.PAYPAL_ENV,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID,
    PAYPAL_PAYOUTS_ENABLED: process.env.PAYPAL_PAYOUTS_ENABLED,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BACKEND: process.env.ANTHROPIC_BACKEND,
    BEDROCK_AWS_REGION: process.env.BEDROCK_AWS_REGION,
    BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID,
    AWS_REGION: process.env.AWS_REGION,
  });
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
