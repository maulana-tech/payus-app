import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// Double-entry rules against a real Postgres (skipped when none is
// reachable): nothing unbalanced can be stored, a transaction id posts once,
// and balances read in each account's normal direction.
const available = await postgresAvailable();

describe.skipIf(!available)("ledger (Postgres)", () => {
  let ledger: typeof import("../src/server/modules/ledger/ledger.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    db = await import("../src/server/db/client");
    ledger = await import("../src/server/modules/ledger/ledger.service");
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  const capture = (id: string, amount: bigint, owner = "shop") =>
    ledger.post({ id, kind: "payment.captured", owner, ref: `invoice:${id}` }, [
      { account: ledger.account.paypalCash(), debitMinor: amount },
      { account: ledger.account.inFlight(owner), creditMinor: amount },
    ]);

  it("refuses postings that do not balance", async () => {
    await expect(
      ledger.post({ id: "bad-1", kind: "test" }, [
        { account: ledger.account.paypalCash(), debitMinor: 1000n },
        { account: ledger.account.inFlight("shop"), creditMinor: 999n },
      ]),
    ).rejects.toThrow(/unbalanced/i);
    expect(await ledger.rawBalance(ledger.account.paypalCash())).toBe(0n);
  });

  it("refuses a posting that is both a debit and a credit, or neither", async () => {
    await expect(
      ledger.post({ id: "bad-2", kind: "test" }, [
        {
          account: ledger.account.paypalCash(),
          debitMinor: 100n,
          creditMinor: 100n,
        },
        { account: ledger.account.inFlight("shop"), creditMinor: 100n },
      ]),
    ).rejects.toThrow(/either a debit or a credit/);
    await expect(
      ledger.post({ id: "bad-3", kind: "test" }, [
        { account: ledger.account.paypalCash() },
        { account: ledger.account.inFlight("shop"), creditMinor: 100n },
      ]),
    ).rejects.toThrow(/either a debit or a credit/);
  });

  it("refuses an unknown account kind", async () => {
    await expect(
      ledger.post({ id: "bad-4", kind: "test" }, [
        { account: "slush_fund:shop", debitMinor: 100n },
        { account: ledger.account.inFlight("shop"), creditMinor: 100n },
      ]),
    ).rejects.toThrow(/Unknown ledger account kind/);
  });

  it("posts a transaction id exactly once", async () => {
    expect(await capture("capture:A", 2500n)).toEqual({ posted: true });
    expect(await capture("capture:A", 2500n)).toEqual({ posted: false });
    expect(await ledger.balance(ledger.account.paypalCash())).toBe(2500n);
    expect(await ledger.balance(ledger.account.inFlight("shop"))).toBe(2500n);
    expect(await ledger.entriesOf("capture:A")).toHaveLength(2);
  });

  it("reads assets and liabilities both as positive numbers", async () => {
    await capture("capture:B", 1000n, "cafe");
    // paypal_cash is an asset: it grows with debits.
    expect(await ledger.rawBalance(ledger.account.paypalCash())).toBe(3500n);
    expect(await ledger.balance(ledger.account.paypalCash())).toBe(3500n);
    // in_flight is a liability: it grows with credits, and still reads +.
    expect(await ledger.rawBalance(ledger.account.inFlight("cafe"))).toBe(
      -1000n,
    );
    expect(await ledger.balance(ledger.account.inFlight("cafe"))).toBe(1000n);
  });

  it("keeps the whole ledger at zero and lists per-owner balances", async () => {
    expect(await ledger.trialBalance()).toBe(0n);
    const cafe = await ledger.balances("cafe");
    expect(cafe).toEqual([
      expect.objectContaining({
        account: "in_flight:cafe",
        kind: "in_flight",
        owner: "cafe",
        balanceMinor: "1000",
        currency: "USD",
      }),
    ]);
  });

  it("lists both halves of a transaction, and only this owner's", async () => {
    const rows = await ledger.entriesFor("cafe");
    expect(rows).toHaveLength(2); // one capture, two postings
    expect(rows.map((r) => r.account).sort()).toEqual([
      "in_flight:cafe",
      "paypal_cash",
    ]);
    // paypal_cash is a platform account, but it is part of cafe's
    // transaction, so hiding it would show half a posting.
    expect(rows.every((r) => r.txnId === "capture:B")).toBe(true);
    expect(rows.every((r) => r.kind === "payment.captured")).toBe(true);
    expect(await ledger.entriesFor("nobody")).toEqual([]);
  });

  it("splits what is in flight without leaving the ledger unbalanced", async () => {
    await ledger.post({ id: "settle:A", kind: "settlement", owner: "shop" }, [
      { account: ledger.account.inFlight("shop"), debitMinor: 2500n },
      { account: ledger.account.platformFee(), creditMinor: 75n },
      { account: ledger.account.taxReserve("shop"), creditMinor: 250n },
      { account: ledger.account.merchantPayable("shop"), creditMinor: 2175n },
    ]);
    expect(await ledger.balance(ledger.account.inFlight("shop"))).toBe(0n);
    expect(await ledger.balance(ledger.account.merchantPayable("shop"))).toBe(
      2175n,
    );
    expect(await ledger.trialBalance()).toBe(0n);
  });
});
