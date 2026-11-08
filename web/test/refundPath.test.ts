import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// Money going back out, against a real Postgres: the refund comes out of
// the same pots the capture went into, the invoice is owed again, the books
// still balance, and PayPal telling us twice changes nothing.
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

type Refund = {
  refundId: string;
  captureId: string | null;
  status: string;
  grossMinor: bigint;
  feeReturnedMinor: bigint;
  netMinor: bigint;
  currency: string;
};

const state = vi.hoisted(() => ({
  captures: new Map<string, unknown>(),
  orders: new Map<string, string>(),
  refunds: new Map<string, unknown>(),
  /** Every refund PayPal was asked to make, to prove it was asked once. */
  asked: [] as { captureId: string; amountMinor?: bigint; requestId: string }[],
}));

vi.mock("../src/server/lib/paypal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/lib/paypal")>();
  let next = 0;
  return {
    ...actual,
    paypalConfigured: () => true,
    verifyWebhookSignature: async () => true,
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
    getRefund: async (refundId: string) => {
      const refund = state.refunds.get(refundId);
      if (!refund) throw new Error(`no such refund ${refundId}`);
      return refund;
    },
    refundCapture: async (input: {
      captureId: string;
      amountMinor?: bigint;
      currency: string;
      requestId: string;
    }) => {
      // PayPal replays a request id rather than refunding twice.
      const seen = state.asked.find((a) => a.requestId === input.requestId);
      if (seen) {
        const existing = [...state.refunds.values()] as Refund[];
        const match = existing.find(
          (r) =>
            r.captureId === input.captureId &&
            (input.amountMinor === undefined ||
              r.grossMinor === input.amountMinor),
        );
        if (match) return match;
      }
      state.asked.push(input);
      const capture = state.captures.get(input.captureId) as Capture;
      const gross = input.amountMinor ?? capture.grossMinor;
      // A full refund returns the whole fee here; a partial one returns none,
      // which is the shape that makes the ledger work hardest.
      const feeBack = gross === capture.grossMinor ? capture.feeMinor : 0n;
      next += 1;
      const refund: Refund = {
        refundId: `REFUND-${next}`,
        captureId: input.captureId,
        status: "COMPLETED",
        grossMinor: gross,
        feeReturnedMinor: feeBack,
        netMinor: gross - feeBack,
        currency: input.currency,
      };
      state.refunds.set(refund.refundId, refund);
      return refund;
    },
  };
});

describe.skipIf(!available)("refund path (Postgres)", () => {
  let invoices: typeof import("../src/server/modules/invoices/invoices.service");
  let payments: typeof import("../src/server/modules/payments/payments.service");
  let refunds: typeof import("../src/server/modules/payments/refunds.service");
  let ledger: typeof import("../src/server/modules/ledger/ledger.service");
  let split: typeof import("../src/server/modules/ledger/split.service");
  let outbox: typeof import("../src/server/modules/outbox/outbox.service");
  let webhookRoute: typeof import("../src/app/api/webhooks/paypal/route");
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
    payments = await import("../src/server/modules/payments/payments.service");
    refunds = await import("../src/server/modules/payments/refunds.service");
    ledger = await import("../src/server/modules/ledger/ledger.service");
    split = await import("../src/server/modules/ledger/split.service");
    outbox = await import("../src/server/modules/outbox/outbox.service");
    webhookRoute = await import("../src/app/api/webhooks/paypal/route");
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  /** An invoice, paid in full through PayPal, split 25% to tax. */
  async function paidInvoice(owner: string, number: string, total: string) {
    await split.createRule(owner, {
      name: "Tax",
      target: "tax_reserve",
      kind: "percent",
      value: "2500",
      priority: 10,
    });
    const invoice = await invoices.createInvoice(owner, {
      number,
      clientName: "Acme",
      clientEmail: null,
      dueDate: "2026-12-01",
      notes: "",
      items: [{ description: "Work", quantity: 1, unitPrice: total }],
      recurrence: "none",
    });
    const order = await payments.startPaypalOrder(invoice.token);
    const captureId = `CAP-${number}`;
    state.captures.set(captureId, {
      captureId,
      orderId: order.orderId,
      paymentId: null,
      status: "COMPLETED",
      grossMinor: BigInt(invoice.totalMinor),
      feeMinor: 100n,
      currency: "USD",
    });
    state.orders.set(order.orderId, captureId);
    await payments.recordCapture(state.captures.get(captureId) as Capture);
    const payment = await payments.paymentByOrder(order.orderId);
    if (!payment) throw new Error("no payment");
    return { invoice, captureId, paymentId: payment.id };
  }

  it("takes a full refund back out of the pots it went into", async () => {
    const { invoice, paymentId } = await paidInvoice(
      "rita",
      "INV-R1",
      "100.00",
    );
    expect(await ledger.balance("tax_reserve:rita")).toBe(2500n);
    expect(await ledger.balance("merchant_payable:rita")).toBe(7500n);

    const refund = await refunds.startRefund("rita", {
      paymentId,
      intentKey: "one-attempt-1",
      reason: "Cancelled the order",
    });
    expect(refund.status).toBe("completed");

    // Every pot is back where it started, and so is PayPal's fee.
    expect(await ledger.balance("tax_reserve:rita")).toBe(0n);
    expect(await ledger.balance("merchant_payable:rita")).toBe(0n);
    expect(await ledger.balance("paypal_cash")).toBe(0n);
    expect(await ledger.balance("psp_fee")).toBe(0n);
    expect(await ledger.trialBalance()).toBe(0n);

    // And the invoice is owed again.
    const after = (await invoices.listInvoices("rita")).find(
      (row) => row.id === invoice.id,
    );
    expect(after?.status).toBe("pending");
    expect(after?.paidMinor).toBe("0");
  });

  it("takes a part refund in proportion, and leaves the rest", async () => {
    const { paymentId } = await paidInvoice("nina", "INV-N1", "100.00");

    await refunds.startRefund("nina", {
      paymentId,
      amountMinor: 4000n,
      intentKey: "one-attempt-2",
    });

    // 40% back: 1000 of the tax reserve and 3000 of what was hers.
    expect(await ledger.balance("tax_reserve:nina")).toBe(1500n);
    expect(await ledger.balance("merchant_payable:nina")).toBe(4500n);
    expect(await ledger.trialBalance()).toBe(0n);

    const left = await refunds.refundablePayments(
      "nina",
      (await invoices.listInvoices("nina"))[0].id,
    );
    expect(left[0]?.refundableMinor).toBe("6000");
  });

  it("refuses more than is left, and will not refund twice on one attempt", async () => {
    const { paymentId } = await paidInvoice("omar", "INV-O1", "50.00");

    await refunds.startRefund("omar", {
      paymentId,
      amountMinor: 3000n,
      intentKey: "one-attempt-3",
    });
    await expect(
      refunds.startRefund("omar", {
        paymentId,
        amountMinor: 3000n,
        intentKey: "another-attempt",
      }),
    ).rejects.toThrow(/still refundable/);

    // The same attempt again is the same refund, not a second one.
    const again = await refunds.startRefund("omar", {
      paymentId,
      amountMinor: 3000n,
      intentKey: "one-attempt-3",
    });
    expect(again.status).toBe("completed");
    expect(await ledger.balance("merchant_payable:omar")).toBe(1500n);
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("does not forget a refund when the invoice is paid again", async () => {
    // Found by the first real sandbox payment, on an invoice the demo had
    // already captured and partly refunded: the capture path reported
    // everything ever taken and dropped what had been given back, so the
    // invoice read as overpaid. A customer who is refunded and pays again
    // is the ordinary way to reach this.
    const { invoice, paymentId } = await paidInvoice(
      "vera",
      "INV-RP",
      "1000.00",
    );

    await refunds.startRefund("vera", {
      paymentId,
      amountMinor: 20000n,
      intentKey: "rp-1",
    });
    const owed = (await invoices.listInvoices("vera")).find(
      (row) => row.id === invoice.id,
    );
    expect(owed?.paidMinor).toBe("80000");
    expect(owed?.status).toBe("pending");

    // Paid again, for exactly what is still owed.
    const second = await payments.startPaypalOrder(invoice.token);
    const captureId = "CAP-INV-RP-2";
    state.captures.set(captureId, {
      captureId,
      orderId: second.orderId,
      paymentId: null,
      status: "COMPLETED",
      grossMinor: 20000n,
      feeMinor: 50n,
      currency: "USD",
    });
    state.orders.set(second.orderId, captureId);
    await payments.recordCapture(state.captures.get(captureId) as Capture);

    const after = (await invoices.listInvoices("vera")).find(
      (row) => row.id === invoice.id,
    );
    // 1000 captured, 200 given back, 200 captured again: paid 1000, not
    // 1200. The figure is absolute, and the refund is still in it.
    expect(after?.paidMinor).toBe("100000");
    expect(after?.status).toBe("paid");
  });

  it("records a refund made in PayPal's own dashboard, once", async () => {
    const { captureId } = await paidInvoice("pia", "INV-P1", "20.00");
    const refundId = "REFUND-DASHBOARD";
    state.refunds.set(refundId, {
      refundId,
      captureId,
      status: "COMPLETED",
      grossMinor: 2000n,
      feeReturnedMinor: 100n,
      netMinor: 1900n,
      currency: "USD",
    });

    const deliver = (eventId: string) =>
      webhookRoute.POST(
        new Request("http://payus.test/api/webhooks/paypal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: eventId,
            event_type: "PAYMENT.CAPTURE.REFUNDED",
            resource: { id: refundId },
          }),
        }),
      );

    expect(await (await deliver("evt-refund-1")).json()).toMatchObject({
      queued: true,
    });
    // The same event again is stored and does nothing.
    expect(await (await deliver("evt-refund-1")).json()).toMatchObject({
      duplicate: true,
    });
    await outbox.drainOutbox();

    expect(await ledger.balance("merchant_payable:pia")).toBe(0n);
    expect(await ledger.balance("tax_reserve:pia")).toBe(0n);
    expect(await ledger.trialBalance()).toBe(0n);

    // A second, different delivery of the same refund still changes nothing.
    await (await deliver("evt-refund-2")).json();
    await outbox.drainOutbox();
    expect(await ledger.trialBalance()).toBe(0n);
    expect(await ledger.balance("merchant_payable:pia")).toBe(0n);
  });
});
