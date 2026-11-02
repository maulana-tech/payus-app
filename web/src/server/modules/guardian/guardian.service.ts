import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  type Context,
  DEFAULT_POLICY,
  type Decision,
  decide,
  type PayoutProposal,
  type Policy,
} from "../../../features/guardian/decide";
import { newId } from "../../../lib/ids";
import {
  approvals,
  auditLog,
  getDb,
  guardianPolicies,
  type ProposalRow,
  payouts,
  proposals,
} from "../../db/client";
import { payableMinor, releasePayout } from "../payments/payouts.service";
import { canonical } from "./canonical";
import {
  ApprovalVoidError,
  ProposalClosedError,
  ProposalNotFoundError,
  ProposalRefusedError,
} from "./guardian.errors";

// Everything that would move money comes through here: a proposal is
// written, the Guardian decides it, and only an approval bound to that exact
// proposal lets it run. The owner's own "Release" button goes down this path
// too, so the route the agents will use is the one already in daily use.

export type ProposalView = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  hash: string;
  status: ProposalRow["status"];
  verdict: ProposalRow["verdict"];
  reason: string;
  findings: unknown;
  proposedBy: string;
  model: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Set when this call carried it out, so the UI can say which kind. */
  payoutStatus?: "pending" | "paid" | "failed" | "simulated";
};

const toView = (row: ProposalRow): ProposalView => ({
  id: row.id,
  kind: row.kind,
  payload: row.payload,
  hash: row.hash,
  status: row.status,
  verdict: row.verdict,
  reason: row.reason,
  findings: row.findings,
  proposedBy: row.proposedBy,
  model: row.model,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** The owner's limits, or the defaults they have not changed yet. */
export async function policyFor(owner: string): Promise<Policy> {
  const [row] = await getDb()
    .select()
    .from(guardianPolicies)
    .where(eq(guardianPolicies.owner, owner))
    .limit(1);
  if (!row) return DEFAULT_POLICY;
  return {
    perTransactionMinor: BigInt(row.perTransactionMinor),
    perDayMinor: BigInt(row.perDayMinor),
    approveAboveMinor: BigInt(row.approveAboveMinor),
    newRecipientNeedsApproval: row.newRecipientNeedsApproval,
    expiryMinutes: row.expiryMinutes,
  };
}

export async function savePolicy(
  owner: string,
  patch: Partial<{
    perTransactionMinor: string;
    perDayMinor: string;
    approveAboveMinor: string;
    newRecipientNeedsApproval: boolean;
    expiryMinutes: number;
  }>,
): Promise<Policy> {
  const current = await policyFor(owner);
  const next = {
    perTransactionMinor:
      patch.perTransactionMinor ?? current.perTransactionMinor.toString(),
    perDayMinor: patch.perDayMinor ?? current.perDayMinor.toString(),
    approveAboveMinor:
      patch.approveAboveMinor ?? current.approveAboveMinor.toString(),
    newRecipientNeedsApproval:
      patch.newRecipientNeedsApproval ?? current.newRecipientNeedsApproval,
    expiryMinutes: patch.expiryMinutes ?? current.expiryMinutes,
  };
  const now = new Date();
  await getDb()
    .insert(guardianPolicies)
    .values({ owner, ...next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: guardianPolicies.owner,
      set: { ...next, updatedAt: now },
    });
  await record(owner, null, "policy.changed", "owner", next);
  return policyFor(owner);
}

/** The hash an approval is bound to. */
export const proposalHash = (
  kind: string,
  payload: Record<string, unknown>,
): string =>
  createHash("sha256").update(canonical({ kind, payload })).digest("hex");

const startOfToday = () => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
};

/** The facts the Guardian needs about a payout, read fresh every time. */
async function payoutContext(
  owner: string,
  destination: string,
): Promise<Context> {
  const db = getDb();
  const settled = ["paid", "simulated"] as const;
  const [[spent], [known], available] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${payouts.amountMinor}), 0)` })
      .from(payouts)
      .where(
        and(
          eq(payouts.owner, owner),
          inArray(payouts.status, [...settled]),
          gte(payouts.createdAt, startOfToday()),
        ),
      ),
    db
      .select({ id: payouts.id })
      .from(payouts)
      .where(
        and(
          eq(payouts.owner, owner),
          inArray(payouts.status, [...settled]),
          sql`lower(${payouts.destination}) = ${destination.toLowerCase()}`,
        ),
      )
      .limit(1),
    payableMinor(owner),
  ]);
  return {
    spentTodayMinor: BigInt(spent?.total ?? "0"),
    knownRecipient: Boolean(known),
    availableMinor: available,
  };
}

async function record(
  owner: string,
  proposalId: string | null,
  action: string,
  actor: string,
  detail: Record<string, unknown>,
) {
  await getDb()
    .insert(auditLog)
    .values({ id: newId(), owner, proposalId, action, actor, detail });
}

export type PayoutPayload = {
  amountMinor: string;
  currency: string;
  destination: string;
  /**
   * What makes this one attempt: a nonce the release form holds while it is
   * open, or an agent's own run id. It is part of the hash, so submitting
   * the same attempt twice finds the first proposal instead of writing a
   * second one.
   */
  intentKey: string;
};

export type ProposeInput = {
  owner: string;
  payload: PayoutPayload;
  /** "owner" today; an agent's name once agents write these. */
  proposedBy?: string;
  /** Model and prompt version, when one was involved. */
  model?: string | null;
};

/**
 * Writes a payout proposal and has the Guardian decide it. An allowed
 * proposal is carried out at once; one the Guardian wants the owner to see
 * waits, with a deadline; a refused one is kept, with its reasons, because a
 * refusal is a record and not an error to swallow.
 */
export async function proposePayout(
  input: ProposeInput,
): Promise<ProposalView> {
  const { owner } = input;
  const proposal: PayoutProposal = {
    kind: "payout",
    amountMinor: BigInt(input.payload.amountMinor),
    currency: input.payload.currency,
    destination: input.payload.destination,
  };
  const [policy, context] = await Promise.all([
    policyFor(owner),
    payoutContext(owner, proposal.destination),
  ]);
  const decision: Decision = decide(proposal, policy, context);

  const payload: Record<string, unknown> = { ...input.payload };
  const hash = proposalHash("payout", payload);

  // The same attempt, submitted twice: the first proposal is the answer.
  const open = await byHash(owner, hash);
  if (open)
    return open.status === "approved" ? execute(open.row) : toView(open.row);
  const status =
    decision.verdict === "refuse"
      ? "refused"
      : decision.verdict === "ask"
        ? "awaiting"
        : "approved";

  const [row] = await getDb()
    .insert(proposals)
    .values({
      id: newId(),
      owner,
      kind: "payout",
      payload,
      hash,
      status,
      verdict: decision.verdict,
      reason: decision.reason,
      findings: decision.findings,
      proposedBy: input.proposedBy ?? "owner",
      model: input.model ?? null,
      expiresAt:
        decision.verdict === "ask"
          ? new Date(Date.now() + policy.expiryMinutes * 60_000)
          : null,
    })
    .returning();

  await record(owner, row.id, "proposed", row.proposedBy, {
    payload,
    model: row.model,
  });
  await record(owner, row.id, "decided", "guardian", {
    verdict: decision.verdict,
    reason: decision.reason,
    findings: decision.findings,
    policy: {
      perTransactionMinor: policy.perTransactionMinor.toString(),
      perDayMinor: policy.perDayMinor.toString(),
      approveAboveMinor: policy.approveAboveMinor.toString(),
    },
    context: {
      spentTodayMinor: context.spentTodayMinor.toString(),
      availableMinor: context.availableMinor.toString(),
      knownRecipient: context.knownRecipient,
    },
  });

  if (decision.verdict === "refuse")
    throw new ProposalRefusedError(decision.reason, decision.findings);
  if (decision.verdict === "allow") return execute(row);
  return toView(row);
}

/** Records the owner's consent against this exact proposal, then runs it. */
export async function approveProposal(
  owner: string,
  id: string,
  via: "app" | "telegram" = "app",
): Promise<ProposalView> {
  const row = await proposalRow(owner, id);
  if (row.status === "executed")
    throw new ProposalClosedError("This one has already been carried out.");
  if (row.status !== "awaiting")
    throw new ProposalClosedError(`This proposal is ${row.status}.`);
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    await close(row.id, "expired");
    await record(owner, row.id, "expired", "guardian", {});
    throw new ProposalClosedError(
      "This proposal expired before it was approved.",
    );
  }

  // A new row each time: consent is a log, so approving an amended
  // proposal is a fresh act rather than an echo of the earlier one.
  await getDb().insert(approvals).values({
    id: newId(),
    proposalId: row.id,
    hash: row.hash, // the hash as it stood when consent was given
    approvedBy: owner,
    via,
  });
  await record(owner, row.id, "approved", owner, { via, hash: row.hash });

  const [approved] = await getDb()
    .update(proposals)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(proposals.id, row.id))
    .returning();
  return execute(approved);
}

export async function refuseProposal(
  owner: string,
  id: string,
): Promise<ProposalView> {
  const row = await proposalRow(owner, id);
  if (row.status !== "awaiting")
    throw new ProposalClosedError(`This proposal is ${row.status}.`);
  const [closed] = await getDb()
    .update(proposals)
    .set({ status: "withdrawn", updatedAt: new Date() })
    .where(eq(proposals.id, row.id))
    .returning();
  await record(owner, row.id, "withdrawn", owner, {});
  return toView(closed);
}

/**
 * Changes what a proposal asks for. The hash moves with it, so an approval
 * given for the old wording stops covering it — which is the whole reason
 * the hash is stored on the approval.
 */
export async function amendProposal(
  owner: string,
  id: string,
  payload: PayoutPayload,
): Promise<ProposalView> {
  const row = await proposalRow(owner, id);
  if (row.status === "executed")
    throw new ProposalClosedError("This one has already been carried out.");
  const next: Record<string, unknown> = { ...payload };
  const [amended] = await getDb()
    .update(proposals)
    .set({
      payload: next,
      hash: proposalHash(row.kind, next),
      status: "awaiting",
      updatedAt: new Date(),
    })
    .where(eq(proposals.id, row.id))
    .returning();
  await record(owner, row.id, "amended", "owner", { payload: next });
  return toView(amended);
}

/**
 * Runs a proposal that is already approved. This is the door an executor
 * knocks on — including the agents' executor, once there are agents — and
 * it is where the hash check earns its keep: an amendment between the
 * approval and the run is caught here.
 */
export async function executeApproved(
  owner: string,
  id: string,
): Promise<ProposalView> {
  const row = await proposalRow(owner, id);
  if (row.status !== "approved")
    throw new ProposalClosedError(`This proposal is ${row.status}.`);
  return execute(row);
}

/** Carries out a decided proposal, checking the consent still fits it. */
async function execute(row: ProposalRow): Promise<ProposalView> {
  const [approval] = await getDb()
    .select()
    .from(approvals)
    .where(eq(approvals.proposalId, row.id))
    .orderBy(desc(approvals.createdAt), desc(approvals.id))
    .limit(1);

  if (row.verdict === "ask" && !approval)
    throw new ProposalClosedError("This proposal is still waiting for you.");
  if (approval && approval.hash !== row.hash) {
    await record(row.owner, row.id, "approval.void", "guardian", {
      approvedHash: approval.hash,
      currentHash: row.hash,
    });
    throw new ApprovalVoidError();
  }

  const payload = row.payload as {
    amountMinor: string;
    destination: string;
  };
  const payout = await releasePayout(row.owner, {
    amountMinor: BigInt(payload.amountMinor),
    destination: payload.destination,
    // The proposal is the intent: asking twice cannot pay twice.
    intentKey: row.id,
  });

  const [executed] = await getDb()
    .update(proposals)
    .set({ status: "executed", updatedAt: new Date() })
    .where(eq(proposals.id, row.id))
    .returning();
  await record(row.owner, row.id, "executed", "executor", {
    payoutId: payout.id,
    senderBatchId: payout.senderBatchId,
    status: payout.status,
  });
  return { ...toView(executed), payoutStatus: payout.status };
}

/** An attempt already on the record, unless it was refused. */
async function byHash(
  owner: string,
  hash: string,
): Promise<{ row: ProposalRow; status: ProposalRow["status"] } | null> {
  const [row] = await getDb()
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.owner, owner),
        eq(proposals.hash, hash),
        inArray(proposals.status, ["awaiting", "approved", "executed"]),
      ),
    )
    .orderBy(desc(proposals.createdAt))
    .limit(1);
  return row ? { row, status: row.status } : null;
}

async function proposalRow(owner: string, id: string): Promise<ProposalRow> {
  const [row] = await getDb()
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.owner, owner)))
    .limit(1);
  if (!row) throw new ProposalNotFoundError();
  return row;
}

/** Proposals still waiting for this owner, newest first. */
export async function waiting(owner: string): Promise<ProposalView[]> {
  const rows = await getDb()
    .select()
    .from(proposals)
    .where(and(eq(proposals.owner, owner), eq(proposals.status, "awaiting")))
    .orderBy(desc(proposals.createdAt));
  return rows.map(toView);
}

export async function recentProposals(
  owner: string,
  limit = 20,
): Promise<ProposalView[]> {
  const rows = await getDb()
    .select()
    .from(proposals)
    .where(eq(proposals.owner, owner))
    .orderBy(desc(proposals.createdAt))
    .limit(limit);
  return rows.map(toView);
}

const close = (id: string, status: ProposalRow["status"]) =>
  getDb()
    .update(proposals)
    .set({ status, updatedAt: new Date() })
    .where(eq(proposals.id, id));

/** Closes proposals nobody answered in time. Run by the outbox cron. */
export async function expireStaleProposals(now = new Date()): Promise<number> {
  const stale = await getDb()
    .update(proposals)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(proposals.status, "awaiting"), lt(proposals.expiresAt, now)))
    .returning({ id: proposals.id, owner: proposals.owner });
  for (const row of stale)
    await record(row.owner, row.id, "expired", "guardian", {});
  return stale.length;
}

/** The record, for the audit screen. */
export async function auditTrail(owner: string, limit = 50) {
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(eq(auditLog.owner, owner))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    proposalId: row.proposalId,
    action: row.action,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }));
}
