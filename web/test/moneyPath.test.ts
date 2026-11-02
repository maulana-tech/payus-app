import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The money path end to end against a real Postgres (skipped when none is
// reachable): a PayPal order, the webhook that reports it captured, the
// outbox worker, the ledger and the invoice becoming paid — and every one of
// those steps surviving a replay.
const available = await postgresAvailable();

type Capture = {
  captureId: string;
  orderId: string | null;
  paymentId: string | null;
  status: string;
  grossMinor: bigint;
  feeMinor: bigint;
  currency: string;
};

const state = vi.hoisted(() => ({
  configured: true,
  verified: true,
  captures: new Map<string, unknown>(),
  orders: new Map<string, string>(), // orderId → captureId
}));

// PayPal itself is the only thing stubbed: our verification, ledger,
// idempotency and invoice logic all run for real.
vi.mock("../src/server/lib/paypal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/lib/paypal")>();
  return {
    ...actual,
    paypalConfigured: () => state.configured,
    verifyWebhookSignature: async () => state.verified,
    createOrder: async (input: { paymentId: string }) => ({
      orderId: `ORDER-${input.paymentId}`,
      status: "CREATED",
      approveUrl: null,
    }),
    getCapture: async (captureId: string) => {
      const capture = state.captures.get(captureId);
      if (!capture) throw new Error(`no such capture ${captureId}`);
      return capture;
    },
    captureOrder: async (orderId: string) => {
      const captureId = state.orders.get(orderId);
      const capture = captureId ? state.captures.get(captureId) : undefined;
      if (!capture) throw new Error(`order ${orderId} is not approved`);
      return capture;
    },
  };
});

describe.skipIf(!available)("money path (Postgres)", () => {
  let invoices: typeof import("../src/server/modules/invoices/invoices.service");
  let links: typeof import("../src/server/modules/paymentLinks/paymentLinks.service");
  let payments: typeof import("../src/server/modules/payments/payments.service");
  let ledger: typeof import("../src/server/modules/ledger/ledger.service");
  let outbox: typeof import("../src/server/modules/outbox/outbox.service");
  let webhookRoute: typeof import("../src/app/api/webhooks/paypal/route");
  let captureRoute: typeof import("../src/app/api/payments/paypal/orders/[orderId]/capture/route");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    process.env.PAYPAL_CLIENT_ID = "test-client";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
    process.env.PAYPAL_WEBHOOK_ID = "test-webhook";
    db = await import("../src/server/db/client");
    invoices = await import("../src/server/modules/invoices/invoices.service");
    links = await import(
      "../src/server/modules/paymentLinks/paymentLinks.service"
    );
    payments = await import("../src/server/modules/payments/payments.service");
    ledger = await import("../src/server/modules/ledger/ledger.service");
    outbox = await import("../src/server/modules/outbox/outbox.service");
    webhookRoute = await import("../src/app/api/webhooks/paypal/route");
    captureRoute = await import(
      "../src/app/api/payments/paypal/orders/[orderId]/capture/route"
    );
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  const invoiceFor = (owner: string, number: string, unitPrice: string) =>
    invoices.createInvoice(owner, {
      number,
      clientName: "Acme",
      clientEmail: null,
      dueDate: "2026-12-01",
      notes: `Invoice ${number}`,
      items: [{ description: "Work", quantity: 1, unitPrice }],
      recurrence: "none",
    });

  /** Pretends the payer approved the order and PayPal captured it. */
  function approve(
    orderId: string,
    captureId: string,
    grossMinor: bigint,
    feeMinor: bigint,
  ) {
    const capture: Capture = {
      captureId,
      orderId,
      paymentId: null,
      status: "COMPLETED",
      grossMinor,
      feeMinor,
      currency: "USD",
    };
    state.captures.set(captureId, capture);
    state.orders.set(orderId, captureId);
  }

  const deliver = (eventId: string, captureId: string) =>
    webhookRoute.POST(
      new Request("http://payus.test/api/webhooks/paypal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: eventId,
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: { id: captureId },
        }),
      }),
    );

  it("turns a captured order into a paid invoice and a balanced posting", async () => {
    const invoice = await invoiceFor("shop", "MP-1", "150");
    expect(invoice.totalMinor).toBe("15000");
    const order = await payments.startPaypalOrder(invoice.token);
    expect(order.amountMinor).toBe("15000");
    approve(order.orderId, "CAP-1", 15000n, 500n);

    const response = await deliver("EVT-1", "CAP-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      duplicate: false,
      queued: true,
    });

    expect(await outbox.drainOutbox()).toEqual({
      done: 1,
      failed: 0,
      retried: 0,
    });

    const paid = await invoices.publicInvoice(invoice.token);
    expect(paid).toMatchObject({ status: "paid", paidMinor: "15000" });
    // The payer's 150.00 arrives as 145.00 of cash plus 5.00 of PayPal's fee.
    expect(await ledger.balance(ledger.account.paypalCash())).toBe(14500n);
    expect(await ledger.balance(ledger.account.pspFee())).toBe(500n);
    // With no split rules yet, settlement passes the whole 150.00 straight
    // through to the merchant and leaves nothing in flight.
    expect(await ledger.balance(ledger.account.inFlight("shop"))).toBe(0n);
    expect(await ledger.balance(ledger.account.merchantPayable("shop"))).toBe(
      15000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("ignores a redelivery of the same event", async () => {
    const again = await deliver("EVT-1", "CAP-1");
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      duplicate: true,
      queued: false,
    });
    expect(await outbox.drainOutbox()).toEqual({
      done: 0,
      failed: 0,
      retried: 0,
    });
    expect(await ledger.balance(ledger.account.paypalCash())).toBe(14500n);
  });

  it("counts the same capture once even under a new event id", async () => {
    const response = await deliver("EVT-2", "CAP-1");
    expect(await response.json()).toMatchObject({ queued: true });
    expect(await outbox.drainOutbox()).toMatchObject({ done: 1 });
    // The job ran again and changed nothing: the ledger refused both the
    // capture and the settlement, and the invoice is reported with the sum
    // of its captures.
    expect(await ledger.balance(ledger.account.paypalCash())).toBe(14500n);
    expect(await ledger.balance(ledger.account.inFlight("shop"))).toBe(0n);
    expect(await ledger.balance(ledger.account.merchantPayable("shop"))).toBe(
      15000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("rejects a delivery PayPal does not vouch for, and stores nothing", async () => {
    state.verified = false;
    const response = await deliver("EVT-FORGED", "CAP-1");
    expect(response.status).toBe(400);
    state.verified = true;
    const stored = await db
      .getDb()
      .select()
      .from(db.webhookEvents)
      .where(eq(db.webhookEvents.eventId, "EVT-FORGED"));
    expect(stored).toHaveLength(0);
  });

  it("records a payment captured from the payer's browser", async () => {
    const invoice = await invoiceFor("shop", "MP-2", "40");
    const order = await payments.startPaypalOrder(invoice.token);
    approve(order.orderId, "CAP-2", 4000n, 100n);

    const response = await captureRoute.POST(
      new Request("http://payus.test/api/payments/paypal/orders/x/capture", {
        method: "POST",
      }),
      { params: Promise.resolve({ orderId: order.orderId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "captured",
      paid_minor: "4000",
      became_paid: true,
    });
    expect(await invoices.publicInvoice(invoice.token)).toMatchObject({
      status: "paid",
    });
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("refuses to start an order for an invoice that is already paid", async () => {
    const paid = await invoices.listInvoices("shop");
    const target = paid.find((i) => i.number === "MP-2");
    await expect(
      payments.startPaypalOrder(target?.token ?? ""),
    ).rejects.toThrow(/already paid/);
  });

  it("writes an invoice when a payment link is paid", async () => {
    await links.createLink("shop", {
      slug: "coffee",
      title: "Coffee",
      description: null,
      amount: null, // the payer chooses
    });

    await expect(
      payments.startLinkOrder({ owner: "shop", slug: "coffee" }),
    ).rejects.toThrow(/amount/i);
    await expect(
      payments.startLinkOrder({ owner: "shop", slug: "tea" }),
    ).rejects.toThrow(/No such payment link/);

    const order = await payments.startLinkOrder({
      owner: "shop",
      slug: "coffee",
      amount: "7.50",
    });
    expect(order.amountMinor).toBe("750");
    approve(order.orderId, "CAP-LINK", 750n, 40n);

    const response = await deliver("EVT-LINK", "CAP-LINK");
    expect(await response.json()).toMatchObject({ queued: true });
    expect(await outbox.drainOutbox()).toMatchObject({ done: 1 });

    const invoice = await invoices.publicInvoice(order.token);
    expect(invoice).toMatchObject({
      status: "paid",
      paidMinor: "750",
      reference: "link:coffee",
    });
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("retries a job that throws, then parks it", async () => {
    const id = await outbox.enqueue("paypal.capture.completed", {
      captureId: "CAP-MISSING",
    });
    expect(await outbox.drainOutbox()).toMatchObject({ retried: 1, done: 0 });
    const [queued] = await db
      .getDb()
      .select()
      .from(db.outbox)
      .where(eq(db.outbox.id, id));
    expect(queued).toMatchObject({ status: "pending", attempts: 1 });
    expect(queued.lastError).toMatch(/no such capture/);
    // It is not due yet, so a run right now leaves it alone.
    expect(await outbox.drainOutbox()).toMatchObject({ retried: 0, done: 0 });

    await db
      .getDb()
      .update(db.outbox)
      .set({ attempts: 8, availableAt: new Date(Date.now() - 1000) })
      .where(eq(db.outbox.id, id));
    expect(await outbox.drainOutbox()).toMatchObject({ failed: 1 });
    expect(await outbox.failedJobs()).toHaveLength(1);
  });
});
