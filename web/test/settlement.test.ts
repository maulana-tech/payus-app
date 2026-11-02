import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// Splitting what arrived and releasing what is owed, against a real Postgres
// (skipped when none is reachable). PayPal is not involved: Payouts is left
// disabled, which is the state the sandbox is in until it is approved, so a
// release is recorded as simulated.
const available = await postgresAvailable();

describe.skipIf(!available)("settlement and payout (Postgres)", () => {
  let ledger: typeof import("../src/server/modules/ledger/ledger.service");
  let split: typeof import("../src/server/modules/ledger/split.service");
  let settlement: typeof import("../src/server/modules/ledger/settlement.service");
  let payouts: typeof import("../src/server/modules/payments/payouts.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    process.env.PAYPAL_PAYOUTS_ENABLED = "";
    db = await import("../src/server/db/client");
    ledger = await import("../src/server/modules/ledger/ledger.service");
    split = await import("../src/server/modules/ledger/split.service");
    settlement = await import(
      "../src/server/modules/ledger/settlement.service"
    );
    payouts = await import("../src/server/modules/payments/payouts.service");
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  /** A capture of `gross`, as `recordCapture` would have posted it. */
  const capture = async (owner: string, id: string, gross: bigint) => {
    await ledger.post(
      { id: `capture:${id}`, kind: "payment.captured", owner },
      [
        { account: ledger.account.paypalCash(), debitMinor: gross },
        { account: ledger.account.inFlight(owner), creditMinor: gross },
      ],
    );
    return settlement.settleCapture({
      owner,
      captureId: id,
      invoiceId: `inv-${id}`,
      grossMinor: gross,
      currency: "USD",
    });
  };

  it("passes everything through when there are no rules", async () => {
    const result = await capture("plain", "P1", 10_000n);
    expect(result.settled).toBe(true);
    expect(await ledger.balance(ledger.account.inFlight("plain"))).toBe(0n);
    expect(await ledger.balance(ledger.account.merchantPayable("plain"))).toBe(
      10_000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("divides a capture the way the rules say", async () => {
    await split.createRule("shop", {
      name: "Tax",
      target: "tax_reserve",
      kind: "percent",
      value: "1000", // 10%
      priority: 1,
    });
    await split.createRule("shop", {
      name: "Our cut",
      target: "platform_fee",
      kind: "fixed",
      value: "250", // $2.50
      priority: 0,
    });
    await split.createRule("shop", {
      name: "Rainy day",
      target: "pos:savings",
      kind: "percent",
      value: "500", // 5%
      priority: 2,
    });

    await capture("shop", "S1", 10_000n);

    expect(await ledger.balance(ledger.account.platformFee())).toBe(250n);
    expect(await ledger.balance(ledger.account.taxReserve("shop"))).toBe(
      1_000n,
    );
    expect(await ledger.balance(ledger.account.pos("shop", "savings"))).toBe(
      500n,
    );
    expect(await ledger.balance(ledger.account.merchantPayable("shop"))).toBe(
      8_250n, // what is left of 100.00
    );
    expect(await ledger.balance(ledger.account.inFlight("shop"))).toBe(0n);
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("settles a capture once, however often it is asked", async () => {
    const again = await settlement.settleCapture({
      owner: "shop",
      captureId: "S1",
      invoiceId: "inv-S1",
      grossMinor: 10_000n,
      currency: "USD",
    });
    expect(again.settled).toBe(false);
    expect(await ledger.balance(ledger.account.taxReserve("shop"))).toBe(
      1_000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("leaves an archived rule out of the next split", async () => {
    const rules = await split.listRules("shop");
    const tax = rules.find((rule) => rule.name === "Tax");
    await split.updateRule("shop", tax?.id ?? "", { state: "archived" });

    await capture("shop", "S2", 10_000n);
    // Still 10.00 from the first capture, nothing added by the second.
    expect(await ledger.balance(ledger.account.taxReserve("shop"))).toBe(
      1_000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("refuses to release more than is owed", async () => {
    const payable = await payouts.payableMinor("plain");
    await expect(
      payouts.releasePayout("plain", {
        amountMinor: payable + 1n,
        destination: "shop@example.com",
        intentKey: "too-much-1",
      }),
    ).rejects.toThrow(/more than is owed/);
    await expect(
      payouts.releasePayout("plain", {
        amountMinor: 0n,
        destination: "shop@example.com",
        intentKey: "nothing-1",
      }),
    ).rejects.toThrow(/above zero/);
  });

  it("records a release, labelled as simulated while Payouts is off", async () => {
    const released = await payouts.releasePayout("plain", {
      amountMinor: 4_000n,
      destination: "Shop@Example.com",
      intentKey: "release-attempt-1",
    });
    expect(released).toMatchObject({
      status: "simulated",
      amountMinor: "4000",
      batchId: null,
    });
    expect(released.senderBatchId).toMatch(/^po_[0-9a-f]{24}$/);

    expect(await ledger.balance(ledger.account.merchantPayable("plain"))).toBe(
      6_000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("treats the same attempt as a retry, not a second payout", async () => {
    const first = await payouts.listPayouts("plain");
    const again = await payouts.releasePayout("plain", {
      amountMinor: 4_000n,
      destination: "shop@example.com", // the case differs; the intent does not
      intentKey: "release-attempt-1",
    });
    expect(again.senderBatchId).toBe(first[0].senderBatchId);
    expect(await payouts.listPayouts("plain")).toHaveLength(1);
    expect(await ledger.balance(ledger.account.merchantPayable("plain"))).toBe(
      6_000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("releases again for a deliberate second attempt", async () => {
    const before = await payouts.listPayouts("plain");
    const second = await payouts.releasePayout("plain", {
      amountMinor: 4_000n,
      destination: "shop@example.com",
      intentKey: "release-attempt-2",
    });
    expect(second.senderBatchId).not.toBe(before[0].senderBatchId);
    expect(await payouts.listPayouts("plain")).toHaveLength(2);
    expect(await ledger.balance(ledger.account.merchantPayable("plain"))).toBe(
      2_000n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });
});
