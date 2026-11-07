import { desc, eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { advisorTurns, getDb } from "@/server/db/client";
import type { AdvisorAnswer } from "./advisor.agent";

// What the Advisor was asked, kept.
//
// The agent still has no write path: this is the service that *ran* it
// recording what it ran, the same shape as the webhook route storing the
// delivery rather than the sender storing it. Keeping the rows next to the
// answer is the whole reason to keep anything — an answer whose rows have
// scrolled away is back to being a claim.

export type AdvisorTurn = AdvisorAnswer & {
  id: string;
  seconds: number;
  askedVia: "app" | "telegram";
  at: string;
};

export async function recordAdvisorTurn(
  owner: string,
  answer: AdvisorAnswer,
  tookMs: number,
  askedVia: "app" | "telegram",
): Promise<void> {
  await getDb()
    .insert(advisorTurns)
    .values({
      id: newId(16),
      owner,
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
}

/** Oldest first, because a transcript is read downwards. */
export async function advisorHistory(
  owner: string,
  limit = 30,
): Promise<AdvisorTurn[]> {
  const rows = await getDb()
    .select()
    .from(advisorTurns)
    .where(eq(advisorTurns.owner, owner))
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

/** Starts the transcript again. The rows it read stay in the ledger. */
export async function forgetAdvisorHistory(owner: string): Promise<void> {
  await getDb().delete(advisorTurns).where(eq(advisorTurns.owner, owner));
}
