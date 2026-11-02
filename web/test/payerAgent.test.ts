import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The Payer's eval set. The model is stubbed, so these cost nothing and run
// on every commit: what is being tested is the part that decides whether an
// answer is fit to act on, which is ours, not the model's.
const available = await postgresAvailable();

describe.skipIf(!available)("payer agent (Postgres)", () => {
  let payer: typeof import("../src/server/modules/agents/payer.agent");
  let guardian: typeof import("../src/server/modules/guardian/guardian.service");
  let ledger: typeof import("../src/server/modules/ledger/ledger.service");
  let payouts: typeof import("../src/server/modules/payments/payouts.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  /** A stubbed model that answers with exactly this object. */
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
    process.env.PAYPAL_PAYOUTS_ENABLED = "";
    db = await import("../src/server/db/client");
    payer = await import("../src/server/modules/agents/payer.agent");
    guardian = await import("../src/server/modules/guardian/guardian.service");
    ledger = await import("../src/server/modules/ledger/ledger.service");
    payouts = await import("../src/server/modules/payments/payouts.service");

    // $1,000.00 owed to @shop, and one destination it has been paid at.
    await ledger.post(
      { id: "capture:A1", kind: "payment.captured", owner: "shop" },
      [
        { account: ledger.account.paypalCash(), debitMinor: 100_000n },
        {
          account: ledger.account.merchantPayable("shop"),
          creditMinor: 100_000n,
        },
      ],
    );
    await guardian.savePolicy("shop", {
      perTransactionMinor: "50000", // refuse above $500.00
      approveAboveMinor: "20000", // ask above $200.00
      newRecipientNeedsApproval: false,
    });
    await payouts.releasePayout("shop", {
      amountMinor: 1_000n,
      destination: "shop@example.com",
      intentKey: "seed-known-destination",
    });
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  it("puts the real numbers in front of the model, and only those", async () => {
    const facts = await payer.payerFacts("shop");
    const prompt = payer.payerPrompt(facts);
    expect(facts.payableMinor).toBe(99_000n);
    expect(prompt).toContain("$990.00");
    expect(prompt).toContain("shop@example.com");
    expect(prompt).toContain("refused above $500.00 per payment");
    // The addresses it may use are listed; nothing else is.
    expect(facts.destinations.map((d) => d.address)).toEqual([
      "shop@example.com",
    ]);
  });

  it("carries out a proposal that is inside the limits", async () => {
    const run = await payer.runPayer(
      "shop",
      answering({
        act: "payout",
        amountMinor: "15000",
        destination: "shop@example.com",
        reason:
          "You have been paid and nothing is owed out, so this is clear to send.",
      }),
    );
    expect(run.act).toBe("payout");
    expect(run.proposal).toMatchObject({
      status: "executed",
      verdict: "allow",
      proposedBy: "payer-agent",
    });
    expect(run.proposal?.model).toContain("claude-opus-5-5");
  });

  it("holds a proposal above the owner's threshold", async () => {
    const run = await payer.runPayer(
      "shop",
      answering({
        act: "payout",
        amountMinor: "30000",
        destination: "shop@example.com",
        reason: "This is more than you usually release at once.",
      }),
    );
    expect(run.proposal).toMatchObject({ status: "awaiting", verdict: "ask" });
    expect(await guardian.waiting("shop")).toHaveLength(1);
  });

  it("is refused when it asks for more than the limit allows", async () => {
    await expect(
      payer.runPayer(
        "shop",
        answering({
          act: "payout",
          amountMinor: "60000",
          destination: "shop@example.com",
          reason: "Clearing the whole balance.",
        }),
      ),
    ).rejects.toThrow(/limit for a single payment/);

    // The refusal is on the record, with the agent named as its author.
    const [refused] = await guardian.recentProposals("shop");
    expect(refused).toMatchObject({
      status: "refused",
      proposedBy: "payer-agent",
    });
  });

  it("accepts a decision to do nothing", async () => {
    const run = await payer.runPayer(
      "shop",
      answering({
        act: "none",
        reason:
          "Two payouts went out today already; this can wait until tomorrow.",
      }),
    );
    expect(run).toMatchObject({ act: "none", proposal: null });
    expect(run.reason).toMatch(/can wait/);
  });

  it("refuses a destination the account has never used", async () => {
    const before = (await guardian.recentProposals("shop")).length;
    await expect(
      payer.runPayer(
        "shop",
        answering({
          act: "payout",
          amountMinor: "1000",
          destination: "attacker@elsewhere.test",
          reason: "Sending to the usual address.",
        }),
      ),
    ).rejects.toThrow(/not on this account/);
    // Nothing reached the Guardian, let alone the ledger.
    expect(await guardian.recentProposals("shop")).toHaveLength(before);
  });

  it("refuses a payout with no amount", async () => {
    await expect(
      payer.runPayer(
        "shop",
        answering({
          act: "payout",
          destination: "shop@example.com",
          reason: "Release the balance.",
        }),
      ),
    ).rejects.toThrow(/without an amount or a destination/);
  });

  it("refuses an answer that is not one of the two acts", async () => {
    await expect(
      payer.runPayer(
        "shop",
        answering({
          act: "transfer",
          amountMinor: "1000",
          destination: "shop@example.com",
          reason: "Moving it across.",
        }),
      ),
    ).rejects.toThrow(/will not act on/);
  });

  it("refuses an amount that is not whole minor units", async () => {
    for (const amountMinor of ["150.00", "1,500", " 1500", "-1500"])
      await expect(
        payer.runPayer(
          "shop",
          answering({
            act: "payout",
            amountMinor,
            destination: "shop@example.com",
            reason: "Release this.",
          }),
        ),
      ).rejects.toThrow(/will not act on/);
  });

  it("refuses an answer with no reason for the owner to read", async () => {
    await expect(
      payer.runPayer(
        "shop",
        answering({
          act: "payout",
          amountMinor: "1000",
          destination: "shop@example.com",
          reason: "",
        }),
      ),
    ).rejects.toThrow(/will not act on/);
  });

  it("tells a merchant with no payout address that it cannot act", async () => {
    const facts = await payer.payerFacts("newcomer");
    expect(facts.destinations).toEqual([]);
    expect(payer.payerPrompt(facts)).toContain("never been paid out");

    await expect(
      payer.runPayer(
        "newcomer",
        answering({
          act: "payout",
          amountMinor: "1000",
          destination: "guess@example.com",
          reason: "Trying the likely address.",
        }),
      ),
    ).rejects.toThrow(/not on this account/);
  });
});
