import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { suggestNextNumber } from "../src/features/invoices/input";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// Editing pending invoices against a real Postgres (skipped when none is
// reachable): only before any payment, and the link stays the same.
const available = await postgresAvailable();

describe("suggestNextNumber", () => {
  it("bumps the trailing number and skips used ones", () => {
    expect(suggestNextNumber("INV-2026-001", new Set())).toBe("INV-2026-002");
    expect(suggestNextNumber("INV-009", new Set(["INV-010"]))).toBe("INV-011");
    expect(suggestNextNumber("ACME", new Set())).toBe("ACME-2");
  });
});

describe.skipIf(!available)("invoice edits (Postgres)", () => {
  let service: typeof import("../src/server/modules/invoices/invoices.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    db = await import("../src/server/db/client");
    service = await import("../src/server/modules/invoices/invoices.service");
    await db.getDb().insert(db.profiles).values({
      username: "dinar",
      userId: "u1",
      signPubkeyHex: "",
      msgPubkeyHex: "",
      claimJson: "{}",
      claimSigHex: "",
    });
  });

  afterAll(async () => {
    await temp?.dispose();
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
    const [row] = await db
      .getDb()
      .select()
      .from(db.invoices)
      .where(eq(db.invoices.id, inv.id))
      .limit(1);
    expect(row?.clientEmail).toBe("ap@acme.test"); // kept
    expect(row?.seriesNumber).toBe("ED-1A");
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
