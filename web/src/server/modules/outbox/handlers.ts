import "server-only";
import { getCapture, getRefund } from "../../lib/paypal";
import { settleCapture } from "../ledger/settlement.service";
import { recordCapture } from "../payments/payments.service";
import { recordRefund } from "../payments/refunds.service";
import { topics } from "./topics";

// One handler per topic. A handler must be safe to run again: the worker
// retries after a crash, and a provider may deliver the same event twice.

export type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

const str = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  if (typeof value !== "string" || !value)
    throw new Error(`Outbox payload is missing "${key}"`);
  return value;
};

export const handlers: Record<string, Handler> = {
  // The webhook body is only a hint: the authoritative amounts come from the
  // capture itself, so a forged or stale body cannot move money.
  [topics.captureCompleted]: async (payload) =>
    recordCapture(await getCapture(str(payload, "captureId"))),

  // Same rule as a capture: PayPal's own record of the refund is the only
  // thing trusted for the amounts.
  [topics.refundCompleted]: async (payload) =>
    recordRefund(await getRefund(str(payload, "refundId")), {
      source: "paypal",
    }),

  // Settling again is harmless: the posting id comes from the capture.
  [topics.settleCapture]: async (payload) =>
    settleCapture({
      owner: str(payload, "owner"),
      captureId: str(payload, "captureId"),
      invoiceId: str(payload, "invoiceId"),
      grossMinor: BigInt(str(payload, "grossMinor")),
      currency: str(payload, "currency"),
    }),
};
