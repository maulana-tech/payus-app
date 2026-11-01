import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Real-Postgres tests run against a uniquely named, disposable database on
// the local server (never the configured application database). Dispose drops
// only a database this helper created.
const PREFIX = "payus_test_";
const ADMIN_URL =
  process.env.PAYUS_TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres";

export type IsolatedDb = {
  /** Connection string of the temporary database, for the app under test. */
  url: string;
  name: string;
  dispose(): Promise<void>;
};

export async function postgresAvailable(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const urlFor = (name: string) => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
};

/** Creates a fresh database with every migration applied. */
export async function createTestDb(): Promise<IsolatedDb> {
  const name = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end().catch(() => {});
  }

  const url = urlFor(name);
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end().catch(() => {});
  }

  return {
    url,
    name,
    async dispose() {
      if (!name.startsWith(PREFIX)) return;
      const client = new pg.Client({ connectionString: ADMIN_URL });
      await client.connect();
      try {
        await client.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await client.end().catch(() => {});
      }
    },
  };
}
