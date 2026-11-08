"use client";

import { useEffect, useRef, useState } from "react";
import { env } from "@/env";

// The payer's half of the money path: PayPal's buttons create an order
// through our API and capture it through our API. The browser never names
// an amount — the server reads what the invoice still owes.

type PaypalNamespace = {
  Buttons: (options: Record<string, unknown>) => {
    render: (container: HTMLElement) => Promise<void>;
    close?: () => void;
  };
};

declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

let loading: Promise<PaypalNamespace> | null = null;

function loadSdk(clientId: string, currency: string) {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (loading) return loading;
  loading = new Promise<PaypalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
    script.async = true;
    script.onload = () =>
      window.paypal
        ? resolve(window.paypal)
        : reject(new Error("PayPal SDK loaded without a namespace"));
    script.onerror = () => {
      loading = null;
      reject(new Error("PayPal could not be reached"));
    };
    document.head.append(script);
  });
  return loading;
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
  currency = "USD",
  disabled = false,
  onPaid,
}: {
  /** Opens the order on our server and returns PayPal's order id. */
  createOrder: () => Promise<string>;
  currency?: string;
  /** Refuses to start, e.g. while the payer has not named an amount. */
  disabled?: boolean;
  onPaid: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const clientId = env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  // The callbacks below outlive this render; keep them reading fresh values.
  const paid = useRef(onPaid);
  paid.current = onPaid;
  const start = useRef(createOrder);
  start.current = createOrder;
  const blocked = useRef(disabled);
  blocked.current = disabled;

  useEffect(() => {
    // Read straight from the build's env: both linters treat an imported
    // value as stable, so neither argues about the dependency list.
    const id = env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!id || !container.current) return;
    let cancelled = false;
    const mount = container.current;

    loadSdk(id, currency)
      .then((paypal) => {
        if (cancelled) return;
        return paypal
          .Buttons({
            // `borderRadius` rather than `shape: "pill"`: the SDK says it
            // takes priority over `shape`, and 12 is the card's own corner,
            // so the buttons read as part of this page instead of as
            // PayPal's default lozenge dropped into it.
            //
            // `height` fixes both buttons to one size — the SDK's own cap
            // is 55, and it must not be combined with `disableMaxHeight`.
            //
            // What is *not* here: `tagline: false`. It only applies to
            // `layout: "horizontal"`, and the "Powered by PayPal" line in a
            // vertical stack is required attribution for the card button.
            style: {
              layout: "vertical",
              label: "pay",
              borderRadius: 12,
              height: 48,
            },
            createOrder: async () => {
              setError("");
              if (blocked.current)
                throw new Error("Choose an amount before paying.");
              return start.current();
            },
            onApprove: async (data: { orderID: string }) => {
              setWorking(true);
              try {
                await post(
                  `/api/payments/paypal/orders/${encodeURIComponent(
                    data.orderID,
                  )}/capture`,
                );
                paid.current();
              } finally {
                setWorking(false);
              }
            },
            onError: (cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "PayPal stopped before the payment went through.",
              ),
          })
          .render(mount);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "PayPal is unavailable.",
        ),
      );

    return () => {
      cancelled = true;
      mount.replaceChildren();
    };
    // The buttons are mounted once: their callbacks read the refs above, so
    // a re-render never tears PayPal's iframe down mid-payment.
  }, [currency]);

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

  return (
    <div className="grid gap-3">
      {/* No background of our own. PayPal's buttons arrive transparent and
          sit straight on the card — a white panel behind them was ours, and
          it read as a slab pasted onto a dark page.
          
          What stays white is the "Powered by PayPal" strip inside their
          cross-origin frame — and below about 480px they paint the whole
          block white, because their buttons switch layout there. That is
          their chrome and their required attribution for the card button,
          so it is not ours to remove or restyle; rounding the corners is
          all we can do, so that whatever they paint matches the card.

          `rounded-xl` as a literal, not `--dash-radius`: that token is the
          dashboard's and is deliberately 0 there ("panels stay square"), so
          using it here silently rounded nothing. */}
      <div className="overflow-hidden rounded-xl">
        <div ref={container} />
      </div>
      {working ? (
        <p className="text-sm" role="status">
          Recording the payment…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
