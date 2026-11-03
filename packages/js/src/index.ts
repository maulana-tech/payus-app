// The Payus API from a server of your own. No dependencies: `fetch` and
// Web Crypto are both standard in Node 18+, Bun, Deno and the edge
// runtimes, so this works wherever your code already runs.
//
// Two things it deliberately does not do. It never runs in a browser with
// a real key — `payus_sk_…` is a secret, and a secret in a page is a
// published secret — and it never tells you an event is genuine without
// checking the signature over the *raw* body.

export type Checkout = {
  id: string;
  object: "checkout";
  status: "open" | "partially_paid" | "paid" | "void";
  currency: string;
  /** A decimal string, as written: "25.00". */
  amount: string;
  /** Integer minor units, as a string so nothing is lost to a float. */
  amount_minor: string;
  paid_minor: string;
  reference: string | null;
  description: string | null;
  /** Where to send the buyer. */
  url: string;
  /** The same page, framed in yours. */
  embed_url: string;
  created_at: string;
  paid_reported_at: string | null;
};

export type CreateCheckout = {
  /** Up to two decimals: "25.00". */
  amount: string;
  currency?: string;
  /** Your own order id. Comes back on the webhook, so use it to dedupe. */
  reference?: string;
  description?: string;
  customer_name?: string;
  customer_email?: string;
  /** YYYY-MM-DD. */
  due_date?: string;
};

export type WebhookEvent = {
  id: string;
  type: "checkout.paid" | "invoice.paid" | "test";
  created: number;
  data: Checkout;
};

/** An error Payus itself reported, with the code it used. */
export class PayusError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PayusError";
  }
}

/** The signature did not check out. Treat the request as hostile. */
export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureError";
  }
}

export type PayusOptions = {
  /** Your secret key: `payus_sk_…`. Server side only. */
  apiKey: string;
  /** Where Payus is hosted, e.g. "https://pay.example.com". */
  baseUrl: string;
  /** Defaults to the global `fetch`; pass your own to log or retry. */
  fetch?: typeof fetch;
};

export class Payus {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: PayusOptions) {
    if (!options.apiKey) throw new Error("A Payus API key is required.");
    if (!options.baseUrl) throw new Error("A Payus baseUrl is required.");
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  /** Opens a checkout. Send the buyer to its `url`. */
  async createCheckout(input: CreateCheckout): Promise<Checkout> {
    return this.#call<Checkout>("POST", "/api/v1/checkouts", input);
  }

  /** Reads one back — the authority on whether it is paid. */
  async getCheckout(id: string): Promise<Checkout> {
    return this.#call<Checkout>(
      "GET",
      `/api/v1/checkouts/${encodeURIComponent(id)}`,
    );
  }

  async #call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } })
        ?.error;
      throw new PayusError(
        response.status,
        error?.code ?? "error",
        error?.message ?? `Payus answered ${response.status}`,
      );
    }
    return parsed as T;
  }
}

const encoder = new TextEncoder();

/** Constant time, so a wrong signature tells an attacker nothing. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type VerifyOptions = {
  /** How old a delivery may be. Default five minutes. */
  toleranceSeconds?: number;
  /** For tests. Seconds since the epoch. */
  now?: number;
};

/**
 * Whether a delivery really came from your Payus account.
 *
 * `rawBody` has to be the bytes as received — a re-serialised object is a
 * different string and will not verify, which is the usual reason this
 * returns false on a genuine event.
 */
export async function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
  options: VerifyOptions = {},
): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key ?? "", rest.join("=")];
    }),
  );
  const timestamp = Number(parts.t);
  const given = parts.v1;
  if (!given || !Number.isFinite(timestamp)) return false;

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  if (Math.abs(now - timestamp) > tolerance) return false;

  return sameString(given, await sign(secret, `${timestamp}.${rawBody}`));
}

/**
 * The event, once the signature is checked. Throws rather than returning
 * null, because the one mistake worth preventing here is acting on an
 * event you forgot to verify.
 */
export async function constructEvent(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
  options: VerifyOptions = {},
): Promise<WebhookEvent> {
  if (!(await verifyWebhook(secret, rawBody, header, options)))
    throw new SignatureError(
      "This delivery is not signed by that secret, or it is too old.",
    );
  return JSON.parse(rawBody) as WebhookEvent;
}
