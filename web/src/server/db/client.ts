import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnv } from "../../env.server";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var _appPgPool: Pool | undefined;
}

let db: Db | undefined;
let pool: Pool | undefined;

function connectionString(): string {
  const env = getServerEnv();
  if (env.NODE_ENV === "production" && !env.DATABASE_URL)
    throw new Error("DATABASE_URL must be configured in production.");
  return env.DATABASE_URL || "postgres://localhost:5432/payus";
}

function newPool(): Pool {
  const created = new Pool({ connectionString: connectionString() });
  // An idle client can be dropped from the other side (a restart, a failover,
  // a dropped test database). Without this listener that becomes an uncaught
  // exception and takes the process down.
  created.on("error", () => {});
  return created;
}

/** The pool is reused across HMR reloads in dev, and per process otherwise. */
export function getDb(): Db {
  if (db) return db;
  if (getServerEnv().NODE_ENV === "development") {
    if (!global._appPgPool) global._appPgPool = newPool();
    pool = global._appPgPool;
  } else {
    pool = newPool();
  }
  db = drizzle(pool, { schema });
  return db;
}

/** Closes the pool. Tests call it before dropping their database. */
export async function closeDb(): Promise<void> {
  const open = pool;
  db = undefined;
  pool = undefined;
  global._appPgPool = undefined;
  await open?.end().catch(() => {});
}

/**
 * Unique-constraint violation, for "already taken" paths. Drizzle wraps a
 * driver error in its own, so the pg error code is looked for down the
 * `cause` chain rather than only on the error it was handed.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 5; depth += 1) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// Re-exported for tests that need to set up a row the services cannot.
export { eq } from "drizzle-orm";
export * from "./schema";
