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
