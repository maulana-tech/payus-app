import "server-only";
import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import {
  getDb,
  isUniqueViolation,
  type PaymentRequestRow,
  paymentRequests,
} from "../../db/client";
import { profileExists } from "../profiles/profiles.service";
import {
  RequestClosedError,
  RequestNotFoundError,
  RequestRecipientError,
} from "./requests.errors";
import type {
  CreateRequestInput,
  MarkPaidInput,
  RequestOutput,
} from "./requests.schema";

const view = (row: PaymentRequestRow, me: string): RequestOutput => ({
  id: row.id,
  from: row.fromUsername,
  to: row.toUsername,
  sealed: row.fromUsername === me ? row.forRequester : row.forPayer,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function createRequest(
  me: string,
  input: CreateRequestInput,
): Promise<RequestOutput> {
  if (input.to === me)
    throw new RequestRecipientError("You can't request from yourself.");
  if (!(await profileExists(input.to)))
    throw new RequestRecipientError(`@${input.to} doesn't exist.`);
  try {
    const [row] = await getDb()
      .insert(paymentRequests)
      .values({
        id: input.id,
        fromUsername: me,
        toUsername: input.to,
        forPayer: input.forPayer,
        forRequester: input.forRequester,
        status: "pending",
      })
      .returning();
    return view(row, me);
  } catch (e) {
    if (isUniqueViolation(e)) throw new RequestRecipientError("Try again.");
    throw e;
  }
}

export async function listRequests(
  me: string,
  direction: "incoming" | "outgoing",
): Promise<RequestOutput[]> {
  const rows = await getDb()
    .select()
    .from(paymentRequests)
    .where(
      direction === "incoming"
        ? eq(paymentRequests.toUsername, me)
        : eq(paymentRequests.fromUsername, me),
    )
    .orderBy(desc(paymentRequests.createdAt))
    .limit(100);
  return rows.map((row) => view(row, me));
}

export async function pendingIncomingCount(me: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.toUsername, me),
        eq(paymentRequests.status, "pending"),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Either party reports the payment (payer after sending, requester later). */
export async function markRequestPaid(
  me: string,
  input: MarkPaidInput,
): Promise<RequestOutput> {
  const [row] = await getDb()
    .update(paymentRequests)
    .set({ status: "paid", updatedAt: new Date() })
    .where(
      and(
        eq(paymentRequests.id, input.id),
        or(
          eq(paymentRequests.fromUsername, me),
          eq(paymentRequests.toUsername, me),
        ),
        inArray(paymentRequests.status, ["pending", "paid"]),
      ),
    )
    .returning();
  if (!row) throw new RequestNotFoundError();
  return view(row, me);
}

async function close(
  me: string,
  id: string,
  role: "from" | "to",
  status: "declined" | "cancelled",
): Promise<RequestOutput> {
  const [row] = await getDb()
    .update(paymentRequests)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(paymentRequests.id, id),
        eq(
          role === "from"
            ? paymentRequests.fromUsername
            : paymentRequests.toUsername,
          me,
        ),
        eq(paymentRequests.status, "pending"),
      ),
    )
    .returning();
  if (!row) throw new RequestClosedError();
  return view(row, me);
}

export const declineRequest = (me: string, id: string) =>
  close(me, id, "to", "declined");
export const cancelRequest = (me: string, id: string) =>
  close(me, id, "from", "cancelled");
