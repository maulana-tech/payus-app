import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { suggestNextNumber } from "../src/features/invoices/input";

// Editing pending invoices against a real MongoDB (skipped when none is
// reachable): only before any payment, keeping the link and the address.
const URI = process.env.PAYUS_TEST_MONGODB_URI ?? "mongodb://localhost:27017";
const DB = `payus_test_${randomUUID().replaceAll("-", "")}`;
vi.mock("../src/server/lib/zecPrice", () => ({
  zecUsd: async () => ({ usd: 50, rates: { USD: 50 }, fetchedAt: Date.now() }),
}));

const { mongoAvailable } = await import("./helpers/mongoTestDb");
const available = await mongoAvailable();

describe("suggestNextNumber", () => {
  it("bumps the trailing number and skips used ones", () => {
    expect(suggestNextNumber("INV-2026-001", new Set())).toBe("INV-2026-002");
    expect(suggestNextNumber("INV-009", new Set(["INV-010"]))).toBe("INV-011");
    expect(suggestNextNumber("ACME", new Set())).toBe("ACME-2");
  });
});

describe.skipIf(!available)("invoice edits (MongoDB)", () => {
  let service: typeof import("../src/server/modules/invoices/invoices.service");
  let mongo: typeof import("../src/server/db/mongo");

  beforeAll(async () => {
    process.env.MONGODB_URI = `${URI.replace(/\/$/, "")}/${DB}`;
    mongo = await import("../src/server/db/mongo");
    service = await import("../src/server/modules/invoices/invoices.service");
    // As in the initial migration: invoice numbers are unique per owner.
    await (await mongo.getInvoices()).createIndex(
      { owner: 1, number: 1 },
      { unique: true, name: "owner_number" },
    );
    await (await mongo.getProfiles()).insertOne({
      _id: "dinar",
      userId: "u1",
      network: "main",
      ua: "u1profile",
      birthday: 1,
      signPubkeyHex: "",
      msgPubkeyHex: "",
      claimJson: "{}",
      claimSigHex: "",
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    const db = await mongo.getDb();
    if (db.databaseName.startsWith("payus_test_")) await db.dropDatabase();
  });

  const details = (number: string) => ({
    number,
    clientName: "Acme",
    clientEmail: "ap@acme.test",
    dueDate: "2026-12-01",
    notes: "",
    items: [{ description: "Design", quantity: 1, unitPrice: "1.5" }],
  });

  it("corrects a pending invoice in place", async () => {
    const inv = await service.createInvoice("dinar", details("ED-1"));
    const edited = await service.updateInvoice(
      "dinar",
      inv.id,
      {
        ...details("ED-1A"),
        clientEmail: null,
        notes: "Net 14",
        items: [{ description: "Design", quantity: 2, unitPrice: "1.5" }],
      },
      true,
    );
    expect(edited).toMatchObject({
      id: inv.id,
      token: inv.token,
      number: "ED-1A",
      totalFormatted: "$3.00",
      notes: "Net 14",
    });
    const doc = await (await mongo.getInvoices()).findOne({ _id: inv.id });
    expect(doc?.clientEmail).toBe("ap@acme.test"); // kept
    expect(doc?.seriesNumber).toBe("ED-1A");
  });

  it("refuses once a payment arrived, after void, for API checkouts and taken numbers", async () => {
    const paid = await service.createInvoice("dinar", details("ED-2"));
    await service.reportPayment("dinar", { id: paid.id, paidMinor: "100" });
    await expect(
      service.updateInvoice("dinar", paid.id, details("ED-2")),
    ).rejects.toThrow(/already received a payment/);

    const voided = await service.createInvoice("dinar", details("ED-3"));
    await service.voidInvoice("dinar", voided.id);
    await expect(
      service.updateInvoice("dinar", voided.id, details("ED-3")),
    ).rejects.toThrow(/paid or void/);

    const api = await service.createInvoice("dinar", {
      ...details("ED-4"),
      source: "api",
    });
    await expect(
      service.updateInvoice("dinar", api.id, details("ED-4")),
    ).rejects.toThrow(/API/);

    const other = await service.createInvoice("dinar", details("ED-5"));
    await expect(
      service.updateInvoice("dinar", other.id, details("ED-2")),
    ).rejects.toThrow(/already have an invoice with that number/);
    await expect(
      service.updateInvoice("someone", other.id, details("ED-5")),
    ).rejects.toThrow(/not found/);
  });
});
