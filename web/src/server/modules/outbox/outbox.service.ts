import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { newId } from "../../../lib/ids";
import { type Db, getDb, outbox } from "../../db/client";
import { handlers } from "./handlers";

// Work is written in the same transaction as the fact that caused it, then
// run by this worker. A row is claimed with `for update skip locked`, so two
// workers (the cron and a dashboard visit) never run the same job twice.

const MAX_ATTEMPTS = 8;
/** 10s, 30s, 1m 30s, … capped — long enough for a provider to recover. */
const backoffMs = (attempts: number) =>
  Math.min(10_000 * 3 ** (attempts - 1), 30 * 60_000);

/** Queues a job. Pass the surrounding transaction to keep it atomic. */
export async function enqueue(
  topic: string,
  payload: Record<string, unknown>,
  tx?: Pick<Db, "insert">,
): Promise<string> {
  const id = newId();
  await (tx ?? getDb())
    .insert(outbox)
    .values({ id, topic, payload, status: "pending" });
  return id;
}

type Claimed = {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
};

async function claim(limit: number, now?: Date): Promise<Claimed[]> {
  // Due-ness is judged by the database clock unless a caller names a time.
  // `available_at` is stored with microsecond precision, so comparing it
  // against a millisecond JS `Date` would hide a job queued in the very
  // millisecond this worker started.
  const isDue = now
    ? lte(outbox.availableAt, now)
    : sql`${outbox.availableAt} <= now()`;
  return getDb().transaction(async (tx) => {
    const due = await tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(and(eq(outbox.status, "pending"), isDue))
      .orderBy(asc(outbox.availableAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(outbox)
      .set({ status: "working", attempts: sql`${outbox.attempts} + 1` })
      .where(
        inArray(
          outbox.id,
          due.map((r) => r.id),
        ),
      )
      .returning({
        id: outbox.id,
        topic: outbox.topic,
        payload: outbox.payload,
        attempts: outbox.attempts,
      });
  });
}

export type DrainResult = { done: number; failed: number; retried: number };

/**
 * Runs the jobs that are due. A job that throws goes back to `pending` with
 * a growing delay, and is parked as `failed` after `MAX_ATTEMPTS` so it can
 * be inspected instead of looping forever.
 */
export async function drainOutbox(
  limit = 25,
  now?: Date,
): Promise<DrainResult> {
  const jobs = await claim(limit, now);
  const result: DrainResult = { done: 0, failed: 0, retried: 0 };
  for (const job of jobs) {
    const handler = handlers[job.topic];
    try {
      if (!handler) throw new Error(`No handler for outbox topic ${job.topic}`);
      await handler(job.payload);
      await getDb()
        .update(outbox)
        .set({ status: "done", processedAt: new Date(), lastError: null })
        .where(eq(outbox.id, job.id));
      result.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const giveUp = job.attempts >= MAX_ATTEMPTS;
      await getDb()
        .update(outbox)
        .set({
          status: giveUp ? "failed" : "pending",
          availableAt: new Date(Date.now() + backoffMs(job.attempts)),
          lastError: message.slice(0, 1000),
          processedAt: giveUp ? new Date() : null,
        })
        .where(eq(outbox.id, job.id));
      if (giveUp) result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}

/** Jobs parked after too many attempts, for the dashboard and reports. */
export async function failedJobs(limit = 50) {
  return getDb()
    .select()
    .from(outbox)
    .where(eq(outbox.status, "failed"))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
}
