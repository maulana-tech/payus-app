import "server-only";
import type { MongoServerError } from "mongodb";
import {
  getPaymentRequests,
  getProfiles,
  type PaymentRequestDoc,
} from "../../db/mongo";
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

const view = (doc: PaymentRequestDoc, me: string): RequestOutput => ({
  id: doc._id,
  from: doc.from,
  to: doc.to,
  sealed: doc.from === me ? doc.forRequester : doc.forPayer,
  status: doc.status,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export async function createRequest(
  me: string,
  input: CreateRequestInput,
): Promise<RequestOutput> {
  if (input.to === me)
    throw new RequestRecipientError("You can't request from yourself.");
  if (!(await (await getProfiles()).findOne({ _id: input.to })))
    throw new RequestRecipientError(`@${input.to} doesn't exist.`);
  const now = new Date();
  const doc: PaymentRequestDoc = {
    _id: input.id,
    from: me,
    to: input.to,
    forPayer: input.forPayer,
    forRequester: input.forRequester,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  try {
    await (await getPaymentRequests()).insertOne(doc);
  } catch (e) {
    if ((e as MongoServerError).code === 11000)
      throw new RequestRecipientError("Try again.");
    throw e;
  }
  return view(doc, me);
}

export async function listRequests(
  me: string,
  direction: "incoming" | "outgoing",
): Promise<RequestOutput[]> {
  const docs = await (await getPaymentRequests())
    .find(direction === "incoming" ? { to: me } : { from: me })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  return docs.map((d) => view(d, me));
}

export async function pendingIncomingCount(me: string): Promise<number> {
  return (await getPaymentRequests()).countDocuments({
    to: me,
    status: "pending",
  });
}

/** Either party reports the payment (payer after sending, requester on sync). */
export async function markRequestPaid(
  me: string,
  input: MarkPaidInput,
): Promise<RequestOutput> {
  const doc = await (await getPaymentRequests()).findOneAndUpdate(
    {
      _id: input.id,
      $or: [{ from: me }, { to: me }],
      status: { $in: ["pending", "paid"] },
    },
    {
      $set: { status: "paid", updatedAt: new Date() },
    },
    { returnDocument: "after" },
  );
  if (!doc) throw new RequestNotFoundError();
  return view(doc, me);
}

async function close(
  me: string,
  id: string,
  role: "from" | "to",
  status: "declined" | "cancelled",
): Promise<RequestOutput> {
  const doc = await (await getPaymentRequests()).findOneAndUpdate(
    { _id: id, [role]: me, status: "pending" },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!doc) throw new RequestClosedError();
  return view(doc, me);
}

export const declineRequest = (me: string, id: string) =>
  close(me, id, "to", "declined");
export const cancelRequest = (me: string, id: string) =>
  close(me, id, "from", "cancelled");
