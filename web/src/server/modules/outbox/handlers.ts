import "server-only";
import { getCapture } from "../../lib/paypal";
import { recordCapture } from "../payments/payments.service";

// One handler per topic. A handler must be safe to run again: the worker
// retries after a crash, and a provider may deliver the same event twice.

export type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

const str = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  if (typeof value !== "string" || !value)
    throw new Error(`Outbox payload is missing "${key}"`);
  return value;
};

export const topics = {
  /** A PayPal capture completed; the amounts are read back from PayPal. */
  captureCompleted: "paypal.capture.completed",
} as const;

export const handlers: Record<string, Handler> = {
  // The webhook body is only a hint: the authoritative amounts come from the
  // capture itself, so a forged or stale body cannot move money.
  [topics.captureCompleted]: async (payload) =>
    recordCapture(await getCapture(str(payload, "captureId"))),
};
