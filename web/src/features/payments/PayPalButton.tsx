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
            style: { layout: "vertical", shape: "pill", label: "pay" },
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
      <p className="rounded-lg bg-(--dash-tint) p-4 text-sm text-(--dash-ash)">
        This deployment has no PayPal client id, so the pay button is off. The
        invoice, its totals and its webhook all work.
      </p>
    );

  return (
    <div className="grid gap-2">
      <div ref={container} />
      {working ? (
        <p className="text-sm text-(--dash-ash)" role="status">
          Recording the payment…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-(--dash-err)" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
