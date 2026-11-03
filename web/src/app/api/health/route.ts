import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

// What a load balancer asks before sending traffic. It checks the one
// dependency this process cannot work without — the database — because a
// server that answers 200 while its pool is dead is worse than one that
// does not answer at all.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: "up" });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        db: "down",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
