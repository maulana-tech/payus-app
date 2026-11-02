import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The Allocator's eval set, and with it the Guardian's second kind of
// proposal. The model is stubbed; what is tested is which answers this app
// will act on, and which the Guardian stops.
const available = await postgresAvailable();

describe.skipIf(!available)("allocator agent (Postgres)", () => {
  let allocator: typeof import("../src/server/modules/agents/allocator.agent");
  let guardian: typeof import("../src/server/modules/guardian/guardian.service");
  let split: typeof import("../src/server/modules/ledger/split.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  const answering = (json: unknown) => ({
    ask: async () => ({
      json,
      model: "claude-opus-5-5",
      promptVersion: "test",
    }),
  });

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    db = await import("../src/server/db/client");
    allocator = await import("../src/server/modules/agents/allocator.agent");
    guardian = await import("../src/server/modules/guardian/guardian.service");
    split = await import("../src/server/modules/ledger/split.service");
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  const active = async (owner: string) =>
    (await split.listRules(owner))
      .filter((rule) => rule.state === "active")
      .map((rule) => [rule.target, rule.value.toString()]);

  it("applies a modest split straight away", async () => {
    const run = await allocator.runAllocator(
      "shop",
      answering({
        act: "change",
        rules: [{ name: "Tax", target: "tax_reserve", percent: 8 }],
        reason:
          "Eight per cent covers what you will owe at the end of the quarter.",
      }),
    );
    expect(run.proposal).toMatchObject({
      status: "executed",
      verdict: "allow",
      proposedBy: "allocator-agent",
    });
    expect(await active("shop")).toEqual([["tax_reserve", "800"]]);
  });

  it("holds a change that moves the split a long way", async () => {
    const run = await allocator.runAllocator(
      "shop",
      answering({
        act: "change",
        rules: [
          { name: "Tax", target: "tax_reserve", percent: 8 },
          { name: "Rainy day", target: "pos:savings", percent: 25 },
        ],
        reason: "Your income is steady enough to put a quarter aside.",
      }),
    );
    expect(run.proposal).toMatchObject({ status: "awaiting", verdict: "ask" });
    expect(run.proposal?.reason).toMatch(/moves what you set aside/);
    // Nothing changed while it waits.
    expect(await active("shop")).toEqual([["tax_reserve", "800"]]);
  });

  it("refuses a split that leaves the owner almost nothing", async () => {
    // The Guardian is the only one that sees the total: each share here is
    // within what one rule may take, but together they take everything.
    await expect(
      allocator.runAllocator(
        "shop",
        answering({
          act: "change",
          rules: [
            { name: "Tax", target: "tax_reserve", percent: 40 },
            { name: "Vault", target: "pos:vault", percent: 40 },
            { name: "Buffer", target: "pos:buffer", percent: 40 },
          ],
          reason: "Save as much as possible.",
        }),
      ),
    ).rejects.toThrow(/too little to live on/);
  });

  it("refuses a single share larger than any rule may take", async () => {
    await expect(
      allocator.runAllocator(
        "shop",
        answering({
          act: "change",
          rules: [{ name: "Everything", target: "pos:vault", percent: 95 }],
          reason: "Save as much as possible.",
        }),
      ),
    ).rejects.toThrow(/will not act on/);
  });

  it("refuses to set the platform's own cut", async () => {
    await expect(
      allocator.runAllocator(
        "shop",
        answering({
          act: "change",
          rules: [{ name: "Fee", target: "platform_fee", percent: 5 }],
          reason: "Covering the platform.",
        }),
      ),
    ).rejects.toThrow(/will not act on/);
  });

  it("refuses a destination that is not a pot or tax", async () => {
    for (const target of ["merchant_payable", "savings", "pos:Upper", "../x"])
      await expect(
        allocator.runAllocator(
          "shop",
          answering({
            act: "change",
            rules: [{ name: "Odd", target, percent: 5 }],
            reason: "Trying somewhere else.",
          }),
        ),
      ).rejects.toThrow(/will not act on/);
  });

  it("refuses shares that are not shares", async () => {
    for (const percent of [0, -5, 120])
      await expect(
        allocator.runAllocator(
          "shop",
          answering({
            act: "change",
            rules: [{ name: "Odd", target: "tax_reserve", percent }],
            reason: "A strange share.",
          }),
        ),
      ).rejects.toThrow(/will not act on/);
  });

  it("refuses a change that does not say what to change to", async () => {
    await expect(
      allocator.runAllocator(
        "shop",
        answering({
          act: "change",
          rules: [],
          reason: "Something should move.",
        }),
      ),
    ).rejects.toThrow(/without saying what it should be/);
  });

  it("accepts leaving the split alone", async () => {
    const run = await allocator.runAllocator(
      "shop",
      answering({
        act: "none",
        reason: "What you set aside already matches what you earn.",
      }),
    );
    expect(run).toMatchObject({ act: "none", proposal: null });
    expect(await active("shop")).toEqual([["tax_reserve", "800"]]);
  });

  it("archives the rules it replaces instead of deleting them", async () => {
    const pending = await guardian.waiting("shop");
    await guardian.approveProposal("shop", pending[0].id);

    expect(await active("shop")).toEqual([
      ["tax_reserve", "800"],
      ["pos:savings", "2500"],
    ]);
    // The earlier rule is still on the record, so past postings can be read
    // against the split that produced them.
    const all = await split.listRules("shop");
    expect(
      all.filter((rule) => rule.state === "archived").length,
    ).toBeGreaterThan(0);
  });
});
