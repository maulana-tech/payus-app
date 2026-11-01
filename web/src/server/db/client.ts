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

function connectionString(): string {
  const env = getServerEnv();
  if (env.NODE_ENV === "production" && !env.DATABASE_URL)
    throw new Error("DATABASE_URL must be configured in production.");
  return env.DATABASE_URL || "postgres://localhost:5432/payus";
}

/** The pool is reused across HMR reloads in dev, and per process otherwise. */
export function getDb(): Db {
  if (db) return db;
  let pool: Pool;
  if (getServerEnv().NODE_ENV === "development") {
    if (!global._appPgPool)
      global._appPgPool = new Pool({ connectionString: connectionString() });
    pool = global._appPgPool;
  } else {
    pool = new Pool({ connectionString: connectionString() });
  }
  db = drizzle(pool, { schema });
  return db;
}

/** Unique-constraint violation, for "already taken" paths. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

export * from "./schema";
