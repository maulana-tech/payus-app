import "server-only";
import { and, asc, eq, isNotNull, lt } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { builderTurns, getDb } from "@/server/db/client";

// What the Builder was asked about one shop, and what it answered.
//
// The agent still has no write path of its own: this is the router that
// *ran* it recording what it ran, the same shape as the webhook route
// storing the delivery rather than the sender storing it.
//
// Two rules, both the Advisor's:
//   every read and every write is scoped by owner as well as by shop, so a
//   shop id guessed or kept from another account finds nothing rather than
//   someone else's conversation; and
//   the thread is kept next to the thing it is about, because an answer you
//   cannot see the question for is back to being a claim.

/** What one answer needs to be shown and, for the newest, applied. */
export type StoredProposal = {
  after: { id: string; kind: string }[];
  html: string;
  links: { href: string; text: string }[];
  skipped: string[];
};

export type ShopTurn = {
  id: string;
  asked: string;
  failed: string | null;
  summary: string | null;
  model: string | null;
  /** Only ever set on the newest turn of a thread. */
  proposal: StoredProposal | null;
  at: string;
};

/**
 * How many turns a shop's thread keeps.
 *
 * Not a technical bound — a thread is a working conversation about one
 * page, and the twentieth thing you asked three weeks ago is not something
 * anyone scrolls back to. Older ones are deleted rather than hidden, so
 * what the database holds is what the screen would show.
 */
const KEEP = 20;

export async function recordShopTurn(
  owner: string,
  shopId: string,
  turn: {
    asked: string;
    failed?: string | null;
    summary?: string | null;
    model?: string | null;
    proposal?: StoredProposal | null;
  },
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // The page comes off every earlier turn in the same breath as the new
    // one arrives. Only the newest answer can be applied, so only the
    // newest needs its page — and a page is up to MAX_HTML.
    await tx
      .update(builderTurns)
      .set({ proposal: null })
      .where(
        and(
          eq(builderTurns.owner, owner),
          eq(builderTurns.shopId, shopId),
          isNotNull(builderTurns.proposal),
        ),
      );

    await tx.insert(builderTurns).values({
      id: newId(),
      owner,
      shopId,
      asked: turn.asked,
      failed: turn.failed ?? null,
      summary: turn.summary ?? null,
      model: turn.model ?? null,
      proposal: turn.proposal ?? null,
    });

    // Trim to the newest KEEP, by the date of the KEEP-th one back.
    const kept = await tx
      .select({ at: builderTurns.createdAt })
      .from(builderTurns)
      .where(
        and(eq(builderTurns.owner, owner), eq(builderTurns.shopId, shopId)),
      )
      .orderBy(asc(builderTurns.createdAt));
    const cut = kept[kept.length - KEEP]?.at;
    if (cut)
      await tx
        .delete(builderTurns)
        .where(
          and(
            eq(builderTurns.owner, owner),
            eq(builderTurns.shopId, shopId),
            lt(builderTurns.createdAt, cut),
          ),
        );
  });
}

/** The thread for one shop, oldest first, as the screen reads it. */
export async function shopThread(
  owner: string,
  shopId: string,
): Promise<ShopTurn[]> {
  const rows = await getDb()
    .select()
    .from(builderTurns)
    .where(and(eq(builderTurns.owner, owner), eq(builderTurns.shopId, shopId)))
    .orderBy(asc(builderTurns.createdAt));

  return rows.map((row) => ({
    id: row.id,
    asked: row.asked,
    failed: row.failed,
    summary: row.summary,
    model: row.model,
    proposal: (row.proposal as StoredProposal | null) ?? null,
    at: row.createdAt.toISOString(),
  }));
}

/** Forgets one shop's thread. The owner's own, and only theirs. */
export async function forgetShopThread(
  owner: string,
  shopId: string,
): Promise<void> {
  await getDb()
    .delete(builderTurns)
    .where(and(eq(builderTurns.owner, owner), eq(builderTurns.shopId, shopId)));
}
