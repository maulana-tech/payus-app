import { and, count, desc, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { advisorChats, advisorTurns, getDb } from "@/server/db/client";
import type { AdvisorAnswer } from "./advisor.agent";

// What the Advisor was asked, kept, and grouped into conversations.
//
// The agent still has no write path: this is the service that *ran* it
// recording what it ran, the same shape as the webhook route storing the
// delivery rather than the sender storing it. Keeping the rows next to the
// answer is the whole reason to keep anything — an answer whose rows have
// scrolled away is back to being a claim.
//
// Every read and every write is scoped by owner as well as by id, so a chat
// id guessed or kept from another account finds nothing rather than someone
// else's conversation.

export type AdvisorTurn = AdvisorAnswer & {
  id: string;
  seconds: number;
  askedVia: "app" | "telegram";
  at: string;
};

export type AdvisorChat = {
  id: string;
  title: string;
  pinned: boolean;
  turns: number;
  at: string;
};

/** A conversation is named after its first question, not by a model. */
const MAX_TITLE = 80;

export function titleFor(question: string): string {
  const one = question.replace(/\s+/g, " ").trim();
  if (one.length <= MAX_TITLE) return one || "Untitled";
  // Cut at a word if there is one near the end, so a title does not stop
  // mid-word for the sake of two characters.
  const cut = one.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  return `${space > MAX_TITLE - 20 ? cut.slice(0, space) : cut}…`;
}

/**
 * Records a turn, opening a conversation if this is the first one.
 *
 * Returns the chat it landed in, because the caller needs it to keep the
 * next question in the same conversation.
 */
export async function recordAdvisorTurn(
  owner: string,
  chatId: string | null,
  answer: AdvisorAnswer,
  tookMs: number,
  askedVia: "app" | "telegram",
): Promise<string> {
  const db = getDb();
  // A chat id from the browser is a claim; it is honoured only if it is
  // this owner's.
  const existing = chatId
    ? await db
        .select({ id: advisorChats.id })
        .from(advisorChats)
        .where(and(eq(advisorChats.id, chatId), eq(advisorChats.owner, owner)))
        .limit(1)
    : [];

  let id = existing[0]?.id;
  if (!id) {
    id = newId(16);
    await db.insert(advisorChats).values({
      id,
      owner,
      title: titleFor(answer.question),
    });
  }

  await db.insert(advisorTurns).values({
    id: newId(16),
    owner,
    chatId: id,
    question: answer.question,
    query: answer.query,
    source: answer.source,
    why: answer.why,
    caption: answer.caption,
    rows: answer.rows,
    answer: answer.answer,
    model: answer.model,
    pickedBy: answer.pickedBy,
    tookMs,
    askedVia,
  });

  // The list is ordered by when a conversation was last used, so every turn
  // moves its chat to the top.
  await db
    .update(advisorChats)
    .set({ updatedAt: new Date() })
    .where(eq(advisorChats.id, id));

  return id;
}

/** Pinned first, then most recently used. */
export async function listChats(
  owner: string,
  limit = 60,
): Promise<AdvisorChat[]> {
  const rows = await getDb()
    .select({
      id: advisorChats.id,
      title: advisorChats.title,
      pinned: advisorChats.pinned,
      at: advisorChats.updatedAt,
      turns: count(advisorTurns.id),
    })
    .from(advisorChats)
    .leftJoin(advisorTurns, eq(advisorTurns.chatId, advisorChats.id))
    .where(eq(advisorChats.owner, owner))
    .groupBy(advisorChats.id)
    .orderBy(desc(advisorChats.pinned), desc(advisorChats.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    turns: row.turns,
    at: row.at.toISOString(),
  }));
}

/** The most recent conversation, which is the one a visit reopens. */
export async function latestChatId(owner: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: advisorChats.id })
    .from(advisorChats)
    .where(eq(advisorChats.owner, owner))
    .orderBy(desc(advisorChats.updatedAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Oldest first, because a transcript is read downwards. */
export async function chatTurns(
  owner: string,
  chatId: string,
  limit = 200,
): Promise<AdvisorTurn[]> {
  const rows = await getDb()
    .select()
    .from(advisorTurns)
    .where(and(eq(advisorTurns.owner, owner), eq(advisorTurns.chatId, chatId)))
    .orderBy(desc(advisorTurns.createdAt))
    .limit(limit);
  return rows.reverse().map((row) => ({
    id: row.id,
    question: row.question,
    source: row.source,
    query: row.query,
    why: row.why,
    caption: row.caption,
    rows: row.rows,
    answer: row.answer,
    model: row.model,
    pickedBy: row.pickedBy,
    seconds: row.tookMs / 1000,
    askedVia: row.askedVia,
    at: row.createdAt.toISOString(),
  }));
}

export async function setChatPinned(
  owner: string,
  chatId: string,
  pinned: boolean,
): Promise<void> {
  await getDb()
    .update(advisorChats)
    .set({ pinned })
    .where(and(eq(advisorChats.id, chatId), eq(advisorChats.owner, owner)));
}

export async function renameChat(
  owner: string,
  chatId: string,
  title: string,
): Promise<void> {
  await getDb()
    .update(advisorChats)
    .set({ title: titleFor(title), updatedAt: new Date() })
    .where(and(eq(advisorChats.id, chatId), eq(advisorChats.owner, owner)));
}

/** The turns go with it: the foreign key is `on delete cascade`. */
export async function deleteChat(owner: string, chatId: string): Promise<void> {
  await getDb()
    .delete(advisorChats)
    .where(and(eq(advisorChats.id, chatId), eq(advisorChats.owner, owner)));
}

/** Starts again. The rows the answers read stay in the ledger. */
export async function forgetAdvisorHistory(owner: string): Promise<void> {
  await getDb().delete(advisorChats).where(eq(advisorChats.owner, owner));
  // Turns written before the chats table existed would be orphaned by the
  // cascade alone, so clear by owner too.
  await getDb().delete(advisorTurns).where(eq(advisorTurns.owner, owner));
}
