import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { newId } from "../../../lib/ids";
import {
  getDb,
  isUniqueViolation,
  type PaymentLinkRow,
  paymentLinks,
} from "../../db/client";
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

const toOutput = (row: PaymentLinkRow): LinkOutput => ({
  id: row.id,
  owner: row.owner,
  slug: row.slug,
  title: row.title,
  description: row.description,
  amountMinor: row.amountMinor,
  currency: row.currency,
  state: row.state,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function createLink(
  owner: string,
  input: CreateLinkInput,
): Promise<LinkOutput> {
  try {
    const [row] = await getDb()
      .insert(paymentLinks)
      .values({
        id: newId(),
        owner,
        slug: input.slug,
        title: input.title,
        description: input.description,
        amountMinor: input.amount,
        currency: DEFAULT_CURRENCY,
        state: "active",
      })
      .returning();
    return toOutput(row);
  } catch (e) {
    if (isUniqueViolation(e)) throw new PaymentLinkSlugUnavailableError();
    throw e;
  }
}

export async function listMyLinks(owner: string): Promise<LinkOutput[]> {
  const rows = await getDb()
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.owner, owner))
    .orderBy(desc(paymentLinks.createdAt));
  return rows.map(toOutput);
}

export async function updateLink(
  owner: string,
  input: UpdateLinkInput,
): Promise<LinkOutput> {
  const [row] = await getDb()
    .update(paymentLinks)
    .set({
      title: input.title,
      description: input.description,
      amountMinor: input.amount,
      updatedAt: new Date(),
    })
    .where(and(eq(paymentLinks.id, input.id), eq(paymentLinks.owner, owner)))
    .returning();
  if (!row) throw new PaymentLinkNotFoundError();
  return toOutput(row);
}

export async function setLinkArchived(
  owner: string,
  input: ArchiveLinkInput,
): Promise<LinkOutput> {
  const [row] = await getDb()
    .update(paymentLinks)
    .set({
      state: input.archived ? "archived" : "active",
      updatedAt: new Date(),
    })
    .where(and(eq(paymentLinks.id, input.id), eq(paymentLinks.owner, owner)))
    .returning();
  if (!row) throw new PaymentLinkNotFoundError();
  return toOutput(row);
}

/** Public: an active link by owner and slug, for /pay/<owner>/<slug>. */
export async function resolveLink(
  input: ResolveLinkInput,
): Promise<LinkOutput | null> {
  const [row] = await getDb()
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.owner, input.owner),
        eq(paymentLinks.slug, input.slug),
        eq(paymentLinks.state, "active"),
      ),
    )
    .limit(1);
  return row ? toOutput(row) : null;
}
