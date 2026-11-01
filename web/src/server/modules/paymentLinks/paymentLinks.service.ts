import "server-only";
import type { MongoServerError } from "mongodb";
import { newId } from "../../../lib/ids";
import { getPaymentLinks, type PaymentLinkDoc } from "../../db/mongo";
import {
  PaymentLinkNotFoundError,
  PaymentLinkSlugUnavailableError,
} from "./paymentLinks.errors";
import type {
  ArchiveLinkInput,
  CreateLinkInput,
  LinkOutput,
  ResolveLinkInput,
  UpdateLinkInput,
} from "./paymentLinks.schema";

/** Single currency for now; PayPal-era money is priced per account. */
const DEFAULT_CURRENCY = "USD";

const toOutput = (doc: PaymentLinkDoc): LinkOutput => ({
  id: doc._id,
  owner: doc.owner,
  slug: doc.slug,
  title: doc.title,
  description: doc.description,
  amountMinor: doc.amountMinor,
  currency: doc.currency,
  state: doc.state,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export async function createLink(
  owner: string,
  input: CreateLinkInput,
): Promise<LinkOutput> {
  const now = new Date();
  const doc: PaymentLinkDoc = {
    _id: newId(),
    owner,
    slug: input.slug,
    title: input.title,
    description: input.description,
    amountMinor: input.amount,
    currency: DEFAULT_CURRENCY,
    state: "active",
    createdAt: now,
    updatedAt: now,
  };
  try {
    await (await getPaymentLinks()).insertOne(doc);
  } catch (e) {
    if ((e as MongoServerError).code === 11000)
      throw new PaymentLinkSlugUnavailableError();
    throw e;
  }
  return toOutput(doc);
}

export async function listMyLinks(owner: string): Promise<LinkOutput[]> {
  const docs = await (await getPaymentLinks())
    .find({ owner })
    .sort({ createdAt: -1 })
    .toArray();
  return docs.map(toOutput);
}

export async function updateLink(
  owner: string,
  input: UpdateLinkInput,
): Promise<LinkOutput> {
  const doc = await (await getPaymentLinks()).findOneAndUpdate(
    { _id: input.id, owner },
    {
      $set: {
        title: input.title,
        description: input.description,
        amountMinor: input.amount,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!doc) throw new PaymentLinkNotFoundError();
  return toOutput(doc);
}

export async function setLinkArchived(
  owner: string,
  input: ArchiveLinkInput,
): Promise<LinkOutput> {
  const doc = await (await getPaymentLinks()).findOneAndUpdate(
    { _id: input.id, owner },
    {
      $set: {
        state: input.archived ? "archived" : "active",
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!doc) throw new PaymentLinkNotFoundError();
  return toOutput(doc);
}

/** Public: an active link by owner and slug, for /pay/<owner>/<slug>. */
export async function resolveLink(
  input: ResolveLinkInput,
): Promise<LinkOutput | null> {
  const doc = await (await getPaymentLinks()).findOne({
    owner: input.owner,
    slug: input.slug,
    state: "active",
  });
  return doc ? toOutput(doc) : null;
}
