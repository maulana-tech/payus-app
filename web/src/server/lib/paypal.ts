import "server-only";
import { getServerEnv } from "../../env.server";
import { toDecimal, toMinor } from "../../features/invoices/money";

// PayPal REST: OAuth2 client credentials, Orders v2 (create/capture), the
// capture lookup, and webhook signature verification. Amounts cross this
// boundary as decimal strings and come back as minor units at once, so no
// float ever reaches the ledger.

const BASE = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

export class PaypalNotConfiguredError extends Error {
  constructor() {
    super(
      "PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
    );
    this.name = "PaypalNotConfiguredError";
  }
}

export class PaypalApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    path: string,
  ) {
    super(`PayPal ${path} failed with ${status}: ${body.slice(0, 500)}`);
    this.name = "PaypalApiError";
  }
}

function credentials() {
  const env = getServerEnv();
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)
    throw new PaypalNotConfiguredError();
  return {
    base: BASE[env.PAYPAL_ENV],
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    webhookId: env.PAYPAL_WEBHOOK_ID,
  };
}

/** True when the keys are present, so callers can degrade instead of throw. */
export function paypalConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const { base, clientId, clientSecret } = credentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await response.text();
  if (!response.ok) throw new PaypalApiError(response.status, body, "oauth2");
  const parsed = JSON.parse(body) as {
    access_token: string;
    expires_in: number;
  };
  token = {
    value: parsed.access_token,
    expiresAt: Date.now() + parsed.expires_in * 1000,
  };
  return token.value;
}

/** Drops the cached token; used by tests and after a 401. */
export function resetPaypalToken() {
  token = null;
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; requestId?: string } = {
    method: "GET",
  },
): Promise<T> {
  const { base } = credentials();
  const headers: Record<string, string> = {
    authorization: `Bearer ${await accessToken()}`,
    "content-type": "application/json",
  };
  // PayPal replays a request with the same key instead of acting twice.
  if (init.requestId) headers["paypal-request-id"] = init.requestId;
  const response = await fetch(`${base}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new PaypalApiError(response.status, text, path);
  return (text ? JSON.parse(text) : {}) as T;
}

export type CreateOrderInput = {
  /** Our payment id; comes back on the capture as `custom_id`. */
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  /** Shown to the payer at PayPal. */
  description: string;
  /** The merchant-facing invoice number. */
  invoiceNumber: string;
  returnUrl?: string;
  cancelUrl?: string;
};

/** Creates an order to be approved by the payer. Returns its PayPal id. */
export async function createOrder(input: CreateOrderInput): Promise<{
  orderId: string;
  status: string;
  approveUrl: string | null;
}> {
  const order = await call<{
    id: string;
    status: string;
    links?: { rel: string; href: string }[];
  }>("/v2/checkout/orders", {
    method: "POST",
    // Same payment id ⇒ PayPal returns the order it already created.
    requestId: `order-${input.paymentId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.paymentId,
          custom_id: input.paymentId,
          invoice_id: `${input.invoiceNumber}-${input.paymentId}`,
          description: input.description.slice(0, 127) || "Payment",
          amount: {
            currency_code: input.currency,
            value: toDecimal(input.amountMinor),
          },
        },
      ],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
        ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
      },
    },
  });
  return {
    orderId: order.id,
    status: order.status,
    approveUrl: order.links?.find((l) => l.rel === "approve")?.href ?? null,
  };
}

export type Capture = {
  captureId: string;
  orderId: string | null;
  /** Our payment id, as sent in `custom_id`. */
  paymentId: string | null;
  status: string;
  grossMinor: bigint;
  feeMinor: bigint;
  currency: string;
};

type CaptureResource = {
  id: string;
  status: string;
  custom_id?: string;
  amount?: { currency_code: string; value: string };
  seller_receivable_breakdown?: {
    gross_amount?: { currency_code: string; value: string };
    paypal_fee?: { currency_code: string; value: string };
  };
  supplementary_data?: { related_ids?: { order_id?: string } };
};

/** The provider's numbers, turned into minor units exactly once. */
export function toCapture(
  resource: CaptureResource,
  orderId?: string | null,
): Capture {
  const gross =
    resource.seller_receivable_breakdown?.gross_amount ?? resource.amount;
  if (!gross) throw new Error(`Capture ${resource.id} carries no amount`);
  const fee = resource.seller_receivable_breakdown?.paypal_fee;
  return {
    captureId: resource.id,
    orderId:
      orderId ?? resource.supplementary_data?.related_ids?.order_id ?? null,
    paymentId: resource.custom_id ?? null,
    status: resource.status,
    grossMinor: toMinor(gross.value),
    feeMinor: fee ? toMinor(fee.value) : 0n,
    currency: gross.currency_code,
  };
}

/**
 * Captures an approved order. The order id doubles as the request id, so a
 * retried capture returns the first result instead of charging twice.
 */
export async function captureOrder(orderId: string): Promise<Capture> {
  const result = await call<{
    id: string;
    status: string;
    purchase_units?: {
      payments?: { captures?: CaptureResource[] };
    }[];
  }>(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    requestId: `capture-${orderId}`,
    body: {},
  });
  const resource = result.purchase_units?.[0]?.payments?.captures?.[0];
  if (!resource)
    throw new Error(`Order ${orderId} captured with no capture in the reply`);
  return toCapture(resource, orderId);
}

/** Reads a capture back from PayPal; the webhook body is never the source. */
export async function getCapture(captureId: string): Promise<Capture> {
  return toCapture(
    await call<CaptureResource>(`/v2/payments/captures/${captureId}`),
  );
}

export type Refund = {
  refundId: string;
  /** The capture this gave money back out of. */
  captureId: string | null;
  status: string;
  /** Handed back to the payer. */
  grossMinor: bigint;
  /** What PayPal returned of its own fee — frequently zero. */
  feeReturnedMinor: bigint;
  /** What actually leaves the balance: gross minus the fee returned. */
  netMinor: bigint;
  currency: string;
};

type RefundResource = {
  id: string;
  status: string;
  amount?: { currency_code: string; value: string };
  seller_payable_breakdown?: {
    gross_amount?: { currency_code: string; value: string };
    paypal_fee?: { currency_code: string; value: string };
    net_amount?: { currency_code: string; value: string };
  };
  links?: { rel?: string; href?: string }[];
};

/** The provider's numbers, turned into minor units exactly once. */
export function toRefund(
  resource: RefundResource,
  captureId?: string | null,
): Refund {
  const gross =
    resource.seller_payable_breakdown?.gross_amount ?? resource.amount;
  if (!gross) throw new Error(`Refund ${resource.id} carries no amount`);
  const fee = resource.seller_payable_breakdown?.paypal_fee;
  const grossMinor = toMinor(gross.value);
  const feeReturnedMinor = fee ? toMinor(fee.value) : 0n;
  const net = resource.seller_payable_breakdown?.net_amount;
  return {
    refundId: resource.id,
    captureId: captureId ?? captureFromLinks(resource.links) ?? null,
    status: resource.status,
    grossMinor,
    feeReturnedMinor,
    netMinor: net ? toMinor(net.value) : grossMinor - feeReturnedMinor,
    currency: gross.currency_code,
  };
}

/** A refund names its capture only in its links, so that is where we look. */
function captureFromLinks(
  links: { rel?: string; href?: string }[] | undefined,
): string | null {
  for (const link of links ?? []) {
    const match = link.href?.match(/\/v2\/payments\/captures\/([^/?]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Gives money back. `requestId` is PayPal's idempotency key, so the same
 * attempt twice returns the first refund instead of refunding twice —
 * which is the whole reason the caller passes one.
 */
export async function refundCapture(input: {
  captureId: string;
  /** Leave out for the whole remaining amount. */
  amountMinor?: bigint;
  currency: string;
  requestId: string;
  note?: string;
}): Promise<Refund> {
  const body: Record<string, unknown> = {};
  if (input.amountMinor !== undefined)
    body.amount = {
      value: toDecimal(input.amountMinor),
      currency_code: input.currency,
    };
  if (input.note) body.note_to_payer = input.note.slice(0, 255);
  const resource = await call<RefundResource>(
    `/v2/payments/captures/${input.captureId}/refund`,
    { method: "POST", requestId: input.requestId, body },
  );
  return toRefund(resource, input.captureId);
}

/** Reads a refund back from PayPal; a webhook body is never the source. */
export async function getRefund(refundId: string): Promise<Refund> {
  return toRefund(
    await call<RefundResource>(`/v2/payments/refunds/${refundId}`),
  );
}

/**
 * Payouts needs its own approval on a PayPal account, so it is opt-in: until
 * `PAYPAL_PAYOUTS_ENABLED` is set, a release is recorded as simulated and
 * labelled as such rather than quietly doing nothing.
 */
export function payoutsEnabled(): boolean {
  return paypalConfigured() && getServerEnv().PAYPAL_PAYOUTS_ENABLED === "true";
}

export type PayoutsAccess =
  /** No keys at all: nothing to ask. */
  | { state: "not_configured" }
  /** Keys, but `PAYPAL_PAYOUTS_ENABLED` is not set, so we never try. */
  | { state: "off" }
  /** PayPal let the call through: the permission is on this account. */
  | { state: "approved" }
  /** PayPal refused the call itself, which is the answer we came for. */
  | { state: "denied"; reason: string }
  | { state: "unknown"; reason: string };

/**
 * Whether this PayPal account may send payouts, asked without sending one.
 * Reading a batch id that cannot exist costs nothing and separates the two
 * answers cleanly: a 404 (or a complaint about the id) means the call got
 * past authorisation, while a 401/403 is the permission being refused.
 *
 * Worth having because the alternative — find out on the owner's first real
 * release — reads as our failure, and because "approved" is otherwise a
 * claim nobody can check.
 */
export async function probePayoutsAccess(): Promise<PayoutsAccess> {
  if (!paypalConfigured()) return { state: "not_configured" };
  if (!payoutsEnabled()) return { state: "off" };
  try {
    await call(`/v1/payments/payouts/${PROBE_BATCH}`);
    // A batch under this id would be a surprise, but it answers the question.
    return { state: "approved" };
  } catch (error) {
    if (!(error instanceof PaypalApiError))
      return {
        state: "unknown",
        reason: error instanceof Error ? error.message : String(error),
      };
    if (error.status === 404 || error.status === 400)
      return { state: "approved" };
    if (error.status === 401 || error.status === 403)
      return { state: "denied", reason: paypalMessage(error) };
    return { state: "unknown", reason: paypalMessage(error) };
  }
}

/** A batch id of the right shape that no account will ever have issued. */
const PROBE_BATCH = "PAYUS_PROBE_0000000000";

/** PayPal's own words, when it bothered to send any. */
function paypalMessage(error: PaypalApiError): string {
  try {
    const body = JSON.parse(error.body) as {
      message?: string;
      error_description?: string;
      name?: string;
    };
    return (
      body.message ??
      body.error_description ??
      body.name ??
      error.body.slice(0, 200)
    );
  } catch {
    return error.body.slice(0, 200) || `HTTP ${error.status}`;
  }
}

export type PayoutResult = {
  batchId: string;
  status: string;
};

/**
 * Sends one payout. `senderBatchId` is PayPal's own idempotency key: the
 * same id returns the first batch instead of paying twice.
 */
export async function createPayout(input: {
  senderBatchId: string;
  destination: string;
  amountMinor: bigint;
  currency: string;
  note: string;
}): Promise<PayoutResult> {
  const result = await call<{
    batch_header?: { payout_batch_id?: string; batch_status?: string };
  }>("/v1/payments/payouts", {
    method: "POST",
    requestId: input.senderBatchId,
    body: {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        email_subject: "You have a payment",
        email_message: input.note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: input.destination,
          amount: {
            currency: input.currency,
            value: toDecimal(input.amountMinor),
          },
          note: input.note,
          sender_item_id: input.senderBatchId,
        },
      ],
    },
  });
  const header = result.batch_header;
  if (!header?.payout_batch_id)
    throw new Error("PayPal accepted the payout without naming a batch");
  return {
    batchId: header.payout_batch_id,
    status: header.batch_status ?? "PENDING",
  };
}

export type WebhookHeaders = {
  get(name: string): string | null;
};

/**
 * Asks PayPal whether this delivery really came from them. Returns false
 * when a header is missing or `PAYPAL_WEBHOOK_ID` is unset, so an
 * unverifiable event is never processed.
 */
export async function verifyWebhookSignature(
  headers: WebhookHeaders,
  rawBody: string,
): Promise<boolean> {
  const { webhookId } = credentials();
  if (!webhookId) return false;
  const required = {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
  };
  if (Object.values(required).some((v) => !v)) return false;
  try {
    const result = await call<{ verification_status: string }>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: {
          ...required,
          webhook_id: webhookId,
          webhook_event: JSON.parse(rawBody),
        },
      },
    );
    return result.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}
