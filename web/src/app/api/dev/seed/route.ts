import { demoMode, demoUser } from "@/lib/demo";
import { newId } from "@/lib/ids";
import { getDb, payments } from "@/server/db/client";
import { ensureDemoAccount } from "@/server/modules/demo/demo.service";
import {
  proposePayout,
  savePolicy,
} from "@/server/modules/guardian/guardian.service";
import {
  createInvoice,
  listInvoices,
} from "@/server/modules/invoices/invoices.service";
import { createRule, listRules } from "@/server/modules/ledger/split.service";
import { createLink } from "@/server/modules/paymentLinks/paymentLinks.service";
import { recordCapture } from "@/server/modules/payments/payments.service";
import {
  listRefunds,
  recordRefund,
} from "@/server/modules/payments/refunds.service";
import {
  createStorefront,
  listStorefronts,
  setPublished,
} from "@/server/modules/storefront/storefront.service";

// Fills the demo account with something to look at: a paid invoice that
// really went through the rail, one still open, one overdue, split rules, a
// link, and a proposal the Guardian is holding.
//
// Demo mode is development-only, so this route answers 404 anywhere else.
export const dynamic = "force-dynamic";

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export async function POST() {
  if (!demoMode()) return new Response("Not found", { status: 404 });
  const owner = demoUser();
  if (!owner) return new Response("Not found", { status: 404 });
  await ensureDemoAccount();

  const made: string[] = [];

  if ((await listRules(owner)).length === 0) {
    await createRule(owner, {
      name: "Tax",
      target: "tax_reserve",
      kind: "percent",
      value: "1000",
      priority: 1,
    });
    await createRule(owner, {
      name: "Rainy day",
      target: "pos:savings",
      kind: "percent",
      value: "500",
      priority: 2,
    });
    made.push("2 split rules");
  }

  const existing = await listInvoices(owner);
  if (existing.length === 0) {
    const line = (description: string, unitPrice: string) => ({
      description,
      quantity: 1,
      unitPrice,
    });

    const paid = await createInvoice(owner, {
      number: "INV-001",
      clientName: "Acme Supply",
      clientEmail: null,
      dueDate: day(-3),
      notes: "Design retainer, October",
      items: [line("Design retainer", "1500")],
      recurrence: "none",
    });
    // The capture is written the way the rail writes one, so the ledger,
    // the split and the invoice status all follow from the same code.
    await getDb()
      .insert(payments)
      .values({
        id: newId(),
        invoiceId: paid.id,
        owner,
        provider: "paypal",
        orderId: `DEMO-${paid.id}`,
        status: "created",
        amountMinor: paid.totalMinor,
        currency: paid.currency,
      });
    await recordCapture({
      captureId: `DEMOCAP-${paid.id}`,
      orderId: `DEMO-${paid.id}`,
      paymentId: null,
      status: "COMPLETED",
      grossMinor: BigInt(paid.totalMinor),
      feeMinor: 4_650n,
      currency: paid.currency,
    });

    // Part of it came back. The demo is more honest with a refund in it:
    // it shows the split being reversed in proportion, and gives the
    // settlement report and the Advisor something real to read.
    if ((await listRefunds(owner)).length === 0)
      await recordRefund(
        {
          refundId: `DEMOREF-${paid.id}`,
          captureId: `DEMOCAP-${paid.id}`,
          status: "COMPLETED",
          grossMinor: 20_000n,
          feeReturnedMinor: 0n,
          netMinor: 20_000n,
          currency: paid.currency,
        },
        { source: "owner", reason: "Two days of the retainer unused" },
      );

    await createInvoice(owner, {
      number: "INV-002",
      clientName: "Blue Harbour",
      clientEmail: null,
      dueDate: day(9),
      notes: "Landing page build",
      items: [line("Landing page", "850")],
      recurrence: "none",
    });
    await createInvoice(owner, {
      number: "INV-003",
      clientName: "Rivet & Co",
      // An address, so the Collector has somewhere to write in the demo.
      clientEmail: "accounts@rivet.example",
      dueDate: day(-11),
      notes: "Monthly support",
      items: [line("Support, September", "400")],
      recurrence: "monthly",
    });
    made.push("3 invoices, one paid through the rail and partly refunded");
  }

  try {
    await createLink(owner, {
      slug: "coffee",
      title: "Buy me a coffee",
      description: "Tip jar — you choose the amount",
      amount: null,
    });
    made.push("1 payment link");
  } catch {
    // Already there.
  }

  if ((await listStorefronts(owner)).length === 0) {
    const shop = await createStorefront(
      owner,
      {
        slug: "kopi-senja",
        title: "Kopi Senja",
        blurb: "Single-origin beans, roasted on Fridays in Bandung.",
        template: "shelf",
        theme: "sun",
        accent: "ochre",
        html: [
          "<h2>How we roast</h2>",
          "<p>Small batches on a 1kg drum, Friday mornings, so a bag you order",
          "on Saturday was green coffee the day before.</p>",
          "<ul><li>Washed Gayo, Aceh</li><li>Natural Kintamani, Bali</li></ul>",
          '<p><a href="https://example.com/visit">Come and see the roastery</a></p>',
        ].join("\n"),
        currency: "USD",
        products: [
          {
            name: "Bag of beans, 250g",
            description: "This week: Gayo, washed.",
            price: "1800",
            min: null,
            max: null,
            quantity: true,
            limit: 6,
            soldOut: false,
          },
          {
            name: "Flat white",
            description: "Made at the counter.",
            price: "450",
            min: null,
            max: null,
            quantity: true,
            limit: 4,
            soldOut: false,
          },
          {
            name: "Saturday cupping, 2 seats left",
            description: "Taste the week's lots side by side.",
            price: "12000",
            min: null,
            max: null,
            quantity: false,
            limit: 1,
            soldOut: true,
          },
          {
            name: "Tip the roaster",
            description: "Only if you want to.",
            price: null,
            min: "200",
            max: "20000",
            quantity: false,
            limit: 1,
            soldOut: false,
          },
        ],
      },
      "builder-agent",
    );
    await setPublished(owner, shop.id, true);
    made.push("1 storefront, published at /shop/kopi-senja");
  }

  // One proposal the Guardian holds, so "Waiting for you" has something in
  // it: the threshold is set below the amount asked for.
  await savePolicy(owner, {
    approveAboveMinor: "20000",
    perTransactionMinor: "200000",
    perDayMinor: "400000",
    newRecipientNeedsApproval: false,
  });
  try {
    await proposePayout({
      owner,
      payload: {
        amountMinor: "45000",
        currency: "USD",
        destination: "demo@example.com",
        intentKey: "seed-awaiting-approval",
      },
      proposedBy: "payer-agent",
      model: "claude-opus-5-5@seed",
    });
    made.push("1 proposal waiting for approval");
  } catch {
    // Already proposed, or nothing is available to release.
  }

  return Response.json({ owner, made });
}
