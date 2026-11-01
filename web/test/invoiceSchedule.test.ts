import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// Real-Postgres test of recurring invoices and reminders. Runs when a local
// server is reachable (PAYUS_TEST_DATABASE_URL, default
// postgres://localhost:5432/postgres) and skips otherwise. Uses its own
// throwaway database.
const available = await postgresAvailable();

describe.skipIf(!available)("invoice schedule (Postgres)", () => {
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

  const create = (
    number: string,
    recurrence: "none" | "monthly",
    dueDate = "2026-10-20",
  ) =>
    service.createInvoice("dinar", {
      number,
      clientName: "Acme",
      clientEmail: "ap@acme.test",
      dueDate,
      notes: "",
      items: [{ description: "Retainer", quantity: 1, unitPrice: "1.5" }],
      recurrence,
    });

  it("issues the next invoice once, moving the schedule to it", async () => {
    const first = await create("RET-1", "monthly");
    expect(first.recurrence).toBe("monthly");
    expect(first.nextIssueAt).not.toBeNull();

    const later = new Date(Date.parse(first.nextIssueAt ?? "") + 1000);
    // Two concurrent runs (cron + dashboard) must not issue it twice.
    const [a, b] = await Promise.all([
      service.issueDueRecurring(later, "dinar"),
      service.issueDueRecurring(later, "dinar"),
    ]);
    const issued = [...a, ...b].map((x) => x.invoice);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({
      number: "RET-1-2",
      totalMinor: "15000",
      dueDate: "2026-11-20",
      recurrence: "monthly",
      status: "pending",
    });

    const all = await service.listInvoices("dinar");
    const original = all.find((i) => i.id === first.id);
    expect(original?.recurrence).toBe("none");
    expect(original?.nextIssueAt).toBeNull();
  });

  it("keeps numbers unique when the owner already used the next one", async () => {
    const first = await create("SUB-1", "monthly");
    await create("SUB-1-2", "none");
    const later = new Date(Date.parse(first.nextIssueAt ?? "") + 1000);
    const [issued] = await service.issueDueRecurring(later, "dinar");
    expect(issued.invoice.number).toMatch(/^SUB-1-2-[0-9A-Za-z]{4}$/);
  });

  it("stops a series and reminds each overdue client once", async () => {
    const inv = await create("ONE-1", "monthly", "2026-01-01");
    expect((await service.stopRecurring("dinar", inv.id)).recurrence).toBe(
      "none",
    );
    const now = new Date("2026-02-01T00:00:00Z");
    const first = await service.claimDueReminders(now, "dinar");
    expect(first.map((r) => r.invoice.number)).toContain("ONE-1");
    const again = await service.claimDueReminders(now, "dinar");
    expect(again.map((r) => r.invoice.number)).not.toContain("ONE-1");
  });
});
