// Applies every SQL migration in drizzle/ to DATABASE_URL, in order.
//
// It uses `pg` and nothing else on purpose. The container that serves this
// app carries only what Next's tracing put there, and drizzle-orm's
// migrator is not part of that — so a script that needed it would work on
// a laptop and fail on a deploy, which is the worst place to find out.
//
// The bookkeeping is drizzle's own, exactly: `drizzle.__drizzle_migrations`,
// one row per file, keyed by the sha256 of the file's contents, with the
// journal's timestamp. Either tool can take over from the other — there is
// a test that holds this to it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Where the migrations are, relative to this file. In the repo they sit
 * one level up; in the image they sit beside it. */
export function migrationsFolder(
  from = path.dirname(fileURLToPath(import.meta.url)),
) {
  const found = [
    path.join(from, "..", "drizzle"),
    path.join(from, "drizzle"),
  ].find((candidate) => {
    try {
      return fs
        .statSync(path.join(candidate, "meta", "_journal.json"))
        .isFile();
    } catch {
      return false;
    }
  });
  if (!found)
    throw new Error("No drizzle/ folder with a journal next to this script.");
  return found;
}

/** The files to apply, in the journal's order, each with drizzle's hash. */
export function plan(folder) {
  const journal = JSON.parse(
    fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"),
  );
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const sql = fs.readFileSync(
        path.join(folder, `${entry.tag}.sql`),
        "utf8",
      );
      return {
        tag: entry.tag,
        when: entry.when,
        sql,
        hash: crypto.createHash("sha256").update(sql).digest("hex"),
        // drizzle-kit writes this marker between statements.
        statements: sql
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter(Boolean),
      };
    });
}

export async function applyMigrations(client, folder) {
  await client.query("create schema if not exists drizzle");
  await client.query(`create table if not exists drizzle.__drizzle_migrations (
    id serial primary key,
    hash text not null,
    created_at bigint
  )`);
  const { rows } = await client.query(
    "select hash from drizzle.__drizzle_migrations",
  );
  const applied = new Set(rows.map((row) => row.hash));

  const done = [];
  for (const migration of plan(folder)) {
    if (applied.has(migration.hash)) continue;
    // One transaction per file, so a migration that fails half way leaves
    // nothing behind and the next run starts it again.
    await client.query("begin");
    try {
      for (const statement of migration.statements)
        await client.query(statement);
      await client.query(
        "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
        [migration.hash, migration.when],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration ${migration.tag} failed: ${error.message}`, {
        cause: error,
      });
    }
    done.push(migration.tag);
  }
  return done;
}

// Running the file applies them; importing it does not.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (web/.env.local).");
  const folder = migrationsFolder();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const done = await applyMigrations(client, folder);
    console.log(
      done.length === 0
        ? `migrations: nothing to do (${folder})`
        : `migrations applied: ${done.join(", ")}`,
    );
  } finally {
    await client.end();
  }
}
