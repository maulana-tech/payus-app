"use client";

import { useEffect, useRef, useState } from "react";
import { env } from "@/env";
import { cn } from "@/lib/utils";

// The payer's half of the money path: our own button opens PayPal, PayPal
// returns an approval, and our server captures it. The browser never names
// an amount — the server reads what the invoice still owes.
//
// This is PayPal's v6 Web SDK, which exists so a site can keep its own
// button. v5 rendered PayPal's buttons into a cross-origin iframe, which
// brought a white panel, a "Powered by PayPal" strip we were not allowed to
// remove, and a layout that changed under 480px. None of that is here: the
// button below is ours, and PayPal appears only as the popup it opens.
//
// A bare client id is enough. The set-up page contradicts itself about this
// — its examples mint a client token — so it was checked against the live
// sandbox SDK before this was written: `createInstance({ clientId })`
// resolves and hands back `createPayPalOneTimePaymentSession`.

type Session = {
  start: (
    options: { presentationMode?: "auto" | "popup" | "modal" | "redirect" },
    order: Promise<{ orderId: string }>,
  ) => Promise<void>;
  destroy?: () => void;
};

type SdkInstance = {
  createPayPalOneTimePaymentSession: (handlers: {
    onApprove: (data: { orderId: string }) => void | Promise<void>;
    onCancel?: (data?: { orderId?: string }) => void;
    onError?: (cause: { code?: string; message?: string }) => void;
  }) => Session;
};

declare global {
  interface Window {
    paypal?: { createInstance?: (o: unknown) => Promise<SdkInstance> };
  }
}

/** Sandbox unless this deployment says otherwise. */
const sdkUrl = () =>
  env.NEXT_PUBLIC_PAYPAL_ENV?.trim().toLowerCase() === "live"
    ? "https://www.paypal.com/web-sdk/v6/core"
    : "https://www.sandbox.paypal.com/web-sdk/v6/core";

let ready: Promise<SdkInstance> | null = null;

/** Loads the SDK and creates the instance once per page. */
function sdk(clientId: string): Promise<SdkInstance> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    if (window.paypal?.createInstance) return resolve();
    const script = document.createElement("script");
    script.src = sdkUrl();
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("PayPal could not be reached."));
    document.head.append(script);
  })
    .then(() => {
      const create = window.paypal?.createInstance;
      if (!create) throw new Error("PayPal loaded without an SDK.");
      return create({ clientId, components: ["paypal-payments"] });
    })
    .catch((cause: unknown) => {
      // Let the next attempt try again rather than caching the failure.
      ready = null;
      throw cause;
    });
  return ready;
}

export async function post(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      "That did not work. Try again in a moment.";
    throw new Error(message);
  }
  return data as Record<string, unknown>;
}

export function PayPalButton({
  createOrder,
  currency: _currency = "USD",
  disabled = false,
  label = "Pay with PayPal",
  onPaid,
}: {
  /** Opens the order on our server and returns PayPal's order id. */
  createOrder: () => Promise<string>;
  currency?: string;
  /** Refuses to start, e.g. while the payer has not named an amount. */
  disabled?: boolean;
  /** What the button says. Give it the amount where there is one. */
  label?: string;
  onPaid: () => void;
}) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const session = useRef<Session | null>(null);
  const clientId = env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  // The handlers outlive this render; keep them reading fresh values.
  const paid = useRef(onPaid);
  paid.current = onPaid;
  const open = useRef(createOrder);
  open.current = createOrder;
  const blocked = useRef(disabled);
  blocked.current = disabled;

  useEffect(() => {
    const id = env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!id) return;
    let live = true;

    sdk(id)
      .then((instance) => {
        if (!live) return;
        session.current = instance.createPayPalOneTimePaymentSession({
          onApprove: async (data) => {
            setWorking(true);
            try {
              await post(
                `/api/payments/paypal/orders/${encodeURIComponent(
                  data.orderId,
                )}/capture`,
              );
              paid.current();
            } catch (cause: unknown) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "The payment went through but we could not record it.",
              );
            } finally {
              setWorking(false);
            }
          },
          // Closing PayPal is not a failure, and must not read as one.
          onCancel: () => setWorking(false),
          onError: (cause) =>
            setError(
              cause?.message ||
                "PayPal stopped before the payment went through.",
            ),
        });
        setLoaded(true);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "PayPal is unavailable.",
        ),
      );

    return () => {
      live = false;
      session.current?.destroy?.();
      session.current = null;
    };
    // One session per mount. Its handlers read the refs above, so a
    // re-render never tears it down in the middle of a payment.
  }, []);

  // Everything here is synchronous up to `start`, and the order promise is
  // created before it: a popup opened later than the click is a popup the
  // browser blocks.
  const pay = () => {
    if (!session.current || blocked.current || working) return;
    setError("");
    const order = open
      .current()
      .then((orderId) => ({ orderId }))
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "That order could not start.",
        );
        throw cause;
      });
    // `auto` opens a popup and falls back to a modal where popups are
    // blocked, which is PayPal's own advice.
    void session.current
      .start({ presentationMode: "auto" }, order)
      .catch(() => {});
  };

  if (!clientId)
    return (
      // No opacity on the text: this is the one page a payer sees, and
      // these three lines are the only things on it that explain the
      // button's state. The border carries the quietness instead.
      <p className="rounded-lg border border-current/15 p-4 text-sm">
        This deployment has no PayPal client id, so the pay button is off. The
        invoice, its totals and its webhook all work.
      </p>
    );

  const busy = working || !loaded;
  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={pay}
        disabled={disabled || busy}
        aria-busy={working}
        className={cn(
          "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5",
          "text-[15px] font-medium transition-colors",
          "bg-foreground text-background hover:bg-foreground/90",
          "focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {working ? "Recording the payment…" : label}
      </button>
      {/* The button is ours, so it does not say PayPal — and a payer who
          presses it should not be surprised by what opens. One line, here
          rather than on each page, so every surface that takes a payment
          says the same thing. */}
      <p className="text-center text-[11px] tracking-[0.1em] uppercase opacity-60">
        Opens PayPal · Payus never sees your card
      </p>
      {error ? (
        <p className="text-sm font-medium" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
