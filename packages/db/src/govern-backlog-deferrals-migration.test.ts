import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `govern_deferrals_${randomUUID().replaceAll("-", "")}`;
let client: Client;

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations/20260815181000_govern_backlog_deferrals/migration.sql",
);

describeDatabase("govern backlog deferrals migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Principal" (id TEXT PRIMARY KEY);
      CREATE TABLE "BacklogItem" (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        "triageOutcome" TEXT
      );
      INSERT INTO "BacklogItem" (id, status, "triageOutcome") VALUES
        ('duplicate', 'deferred', 'duplicate'),
        ('discard', 'deferred', 'discard'),
        ('wanted', 'deferred', 'defer'),
        ('open', 'open', 'build');
    `);
    await client.query(await readFile(migrationPath, "utf8"));
  });

  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });

  it("moves only terminal duplicate and discard outcomes to retired", async () => {
    const rows = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM "BacklogItem" ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: "discard", status: "retired" },
      { id: "duplicate", status: "retired" },
      { id: "open", status: "open" },
      { id: "wanted", status: "deferred" },
    ]);
  });

  it("adds the active deferral projection and its owner foreign key", async () => {
    await client.query(`INSERT INTO "Principal" (id) VALUES ('principal-1')`);
    await expect(client.query(`
      UPDATE "BacklogItem"
      SET "deferReason"='why', "deferTrigger"='when',
          "deferReviewAt"='2026-11-15T12:00:00Z',
          "deferOwnerPrincipalId"='principal-1', "deferredAt"=now()
      WHERE id='wanted'
    `)).resolves.toBeDefined();
    await expect(client.query(`
      UPDATE "BacklogItem" SET "deferOwnerPrincipalId"='missing' WHERE id='wanted'
    `)).rejects.toThrow();
  });
});
