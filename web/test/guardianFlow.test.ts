import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  type IsolatedDb,
  postgresAvailable,
} from "./helpers/pgTestDb";

// The Guardian against a real Postgres (skipped when none is reachable):
// what it refuses, what it holds back, and the thing that matters most —
// that consent is bound to the proposal it was given for.
const available = await postgresAvailable();

describe.skipIf(!available)("guardian (Postgres)", () => {
  let guardian: typeof import("../src/server/modules/guardian/guardian.service");
  let ledger: typeof import("../src/server/modules/ledger/ledger.service");
  let payouts: typeof import("../src/server/modules/payments/payouts.service");
  let db: typeof import("../src/server/db/client");
  let temp: IsolatedDb;

  beforeAll(async () => {
    temp = await createTestDb();
    process.env.DATABASE_URL = temp.url;
    process.env.PAYPAL_PAYOUTS_ENABLED = "";
    db = await import("../src/server/db/client");
    guardian = await import("../src/server/modules/guardian/guardian.service");
    ledger = await import("../src/server/modules/ledger/ledger.service");
    payouts = await import("../src/server/modules/payments/payouts.service");

    // $1,000.00 owed to @shop, so there is something to release.
    await ledger.post(
      { id: "capture:G1", kind: "payment.captured", owner: "shop" },
      [
        { account: ledger.account.paypalCash(), debitMinor: 100_000n },
        {
          account: ledger.account.merchantPayable("shop"),
          creditMinor: 100_000n,
        },
      ],
    );
  });

  afterAll(async () => {
    await db?.closeDb();
    await temp?.dispose();
  });

  const ask = (over: Partial<Record<string, string>> = {}) =>
    guardian.proposePayout({
      owner: "shop",
      payload: {
        amountMinor: "1000",
        currency: "USD",
        destination: "shop@example.com",
        intentKey: "attempt-1",
        ...over,
      },
    });

  it("carries out what is inside every limit, at once", async () => {
    await guardian.savePolicy("shop", {
      newRecipientNeedsApproval: false,
      approveAboveMinor: "50000",
    });
    const proposal = await ask();
    expect(proposal).toMatchObject({ verdict: "allow", status: "executed" });

    const sent = await payouts.listPayouts("shop");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: "simulated", amountMinor: "1000" });
    expect(await ledger.balance(ledger.account.merchantPayable("shop"))).toBe(
      99_000n,
    );

    const trail = await guardian.auditTrail("shop");
    expect(trail.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["proposed", "decided", "executed"]),
    );
  });

  it("refuses over the limit, and keeps the refusal with its reason", async () => {
    await guardian.savePolicy("shop", { perTransactionMinor: "5000" });
    await expect(
      ask({ amountMinor: "6000", intentKey: "too-big" }),
    ).rejects.toThrow(/limit for a single payment/);

    const [refused] = await guardian.recentProposals("shop");
    expect(refused).toMatchObject({ status: "refused", verdict: "refuse" });
    expect(refused.reason).toMatch(/\$50\.00 limit/);
    // Nothing was sent.
    expect(await payouts.listPayouts("shop")).toHaveLength(1);
  });

  it("holds back what it wants the owner to see", async () => {
    await guardian.savePolicy("shop", {
      perTransactionMinor: "100000",
      approveAboveMinor: "2000",
    });
    const proposal = await ask({
      amountMinor: "3000",
      intentKey: "needs-eyes",
    });
    expect(proposal).toMatchObject({ verdict: "ask", status: "awaiting" });
    expect(proposal.expiresAt).not.toBeNull();
    expect(await guardian.waiting("shop")).toHaveLength(1);
    expect(await payouts.listPayouts("shop")).toHaveLength(1); // still unsent
  });

  it("sends it once the owner approves", async () => {
    const [pending] = await guardian.waiting("shop");
    const approved = await guardian.approveProposal("shop", pending.id);
    expect(approved.status).toBe("executed");
    expect(await payouts.listPayouts("shop")).toHaveLength(2);
    expect(await guardian.waiting("shop")).toHaveLength(0);
    expect(await ledger.trialBalance()).toBe(0n);
  });

  it("treats the same attempt as the same proposal", async () => {
    const first = await ask({ amountMinor: "3000", intentKey: "needs-eyes" });
    expect(first.status).toBe("executed");
    // The attempt was already carried out: no second proposal, no second payout.
    expect(
      (await guardian.recentProposals("shop")).filter(
        (p) => (p.payload as { intentKey?: string }).intentKey === "needs-eyes",
      ),
    ).toHaveLength(1);
    expect(await payouts.listPayouts("shop")).toHaveLength(2);
  });

  it("approves the wording in front of the owner, not the one before it", async () => {
    const proposal = await ask({ amountMinor: "4000", intentKey: "amended" });
    expect(proposal.status).toBe("awaiting");

    const amended = await guardian.amendProposal("shop", proposal.id, {
      amountMinor: "9000", // the digit that matters
      currency: "USD",
      destination: "shop@example.com",
      intentKey: "amended",
    });
    expect(amended.hash).not.toBe(proposal.hash);

    await guardian.approveProposal("shop", proposal.id);
    const [latest] = await payouts.listPayouts("shop");
    expect(latest.amountMinor).toBe("9000");
  });

  it("refuses to run a proposal that changed after it was approved", async () => {
    const proposal = await ask({ amountMinor: "2500", intentKey: "raced" });
    const sentBefore = await payouts.listPayouts("shop");

    // Consent given, but not yet carried out — the state an executor picks
    // work up from. Written directly, because approving through the service
    // runs it in the same breath and leaves no window.
    await db.getDb().insert(db.approvals).values({
      id: "apr-raced",
      proposalId: proposal.id,
      hash: proposal.hash,
      approvedBy: "shop",
      via: "app",
    });
    await db
      .getDb()
      .update(db.proposals)
      .set({ status: "approved" })
      .where(db.eq(db.proposals.id, proposal.id));

    // Now the wording changes under it, and the executor arrives.
    await guardian.amendProposal("shop", proposal.id, {
      amountMinor: "9900",
      currency: "USD",
      destination: "shop@example.com",
      intentKey: "raced",
    });
    await db
      .getDb()
      .update(db.proposals)
      .set({ status: "approved" })
      .where(db.eq(db.proposals.id, proposal.id));

    await expect(guardian.executeApproved("shop", proposal.id)).rejects.toThrow(
      /no longer covers it/,
    );
    // Nothing was sent for the amount nobody agreed to.
    expect(await payouts.listPayouts("shop")).toHaveLength(sentBefore.length);

    // And the refusal is on the record.
    const trail = await guardian.auditTrail("shop");
    expect(trail.some((entry) => entry.action === "approval.void")).toBe(true);
  });

  it("lets the owner withdraw one", async () => {
    const proposal = await ask({ amountMinor: "5000", intentKey: "no-thanks" });
    const withdrawn = await guardian.refuseProposal("shop", proposal.id);
    expect(withdrawn.status).toBe("withdrawn");
    await expect(guardian.approveProposal("shop", proposal.id)).rejects.toThrow(
      /withdrawn/,
    );
  });

  it("closes what nobody answered in time", async () => {
    const proposal = await ask({ amountMinor: "6000", intentKey: "too-slow" });
    expect(proposal.status).toBe("awaiting");
    await db
      .getDb()
      .update(db.proposals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(db.eq(db.proposals.id, proposal.id));

    expect(await guardian.expireStaleProposals()).toBeGreaterThan(0);
    await expect(guardian.approveProposal("shop", proposal.id)).rejects.toThrow(
      /expired/,
    );
  });
});
