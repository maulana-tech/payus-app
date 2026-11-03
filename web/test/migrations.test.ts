import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain JS, because the container runs it with bare node.
import {
  applyMigrations,
  migrationsFolder,
  plan,
} from "../scripts/migrate.mjs";
import { createTestDb, postgresAvailable } from "./helpers/pgTestDb";

// The container applies migrations with `pg` alone, because drizzle-orm's
// migrator is not in the traced bundle it ships with. That is only safe
// while the two agree about what has been applied — so this test migrates a
// database with drizzle's migrator and then asks ours what is left to do.
// The answer has to be "nothing".

const folder = migrationsFolder(`${process.cwd()}/scripts`);
const available = await postgresAvailable();

describe("migrations", () => {
  it("has a journal that matches the files on disk", () => {
    const steps = plan(folder) as {
      tag: string;
      hash: string;
      sql: string;
      statements: string[];
    }[];
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.statements.length).toBeGreaterThan(0);
      // Drizzle keys its bookkeeping on the sha256 of the whole file; if
      // that ever changed, every deploy would replay every migration.
      expect(step.hash).toBe(
        createHash("sha256")
          .update(readFileSync(`${folder}/${step.tag}.sql`, "utf8"))
          .digest("hex"),
      );
    }
    // Ordered, and no gaps: the journal is the order they run in.
    const tags = steps.map((step) => step.tag);
    expect([...tags].sort()).toEqual(tags);
  });

  it.skipIf(!available)(
    "agrees with drizzle's own migrator about what is applied",
    async () => {
      const temp = await createTestDb(); // drizzle's migrator ran here
      const client = new pg.Client({ connectionString: temp.url });
      await client.connect();
      try {
        expect(await applyMigrations(client, folder)).toEqual([]);
        // And ours is idempotent in its own right.
        expect(await applyMigrations(client, folder)).toEqual([]);
      } finally {
        await client.end();
        await temp.dispose();
      }
    },
  );
});
