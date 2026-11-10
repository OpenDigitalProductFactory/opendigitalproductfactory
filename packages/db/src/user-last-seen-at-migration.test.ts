// BI-61DE8177: User gains a nullable lastSeenAt. The migration must apply
// against ANY data state (AGENTS.md §2): an empty table, existing users, and a
// database where the column already exists.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const migrationPath = new URL("../prisma/migrations/20260926030000_user_last_seen_at/migration.sql", import.meta.url);

describe("User.lastSeenAt migration shape", () => {
  it("only adds a nullable column: no backfill, no row touched", async () => {
    const sql = (await readFile(migrationPath, "utf8")).replace(/^--.*$/gm, "").trim();
    expect(sql).toBe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);`);
  });
});

describeDatabase("User.lastSeenAt migration against live Postgres", () => {
  let client: Client;
  const schemas: string[] = [];

  async function freshSchema(prefix: string): Promise<void> {
    const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)`);
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (!client) return;
    for (const schema of schemas) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("leaves existing users unseen (NULL) and is harmless to re-run", async () => {
    await freshSchema("user_last_seen_rows");
    await client.query(`INSERT INTO "User" (id, email) VALUES ('a', 'admin@dpf.local'), ('b', 'owner@example.com')`);
    await client.query(await readFile(migrationPath, "utf8"));
    await client.query(await readFile(migrationPath, "utf8"));
    const rows = await client.query<{ id: string; lastSeenAt: Date | null }>(
      `SELECT id, "lastSeenAt" FROM "User" ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: "a", lastSeenAt: null },
      { id: "b", lastSeenAt: null },
    ]);
  });

  it("applies to an empty table and accepts a stamp", async () => {
    await freshSchema("user_last_seen_empty");
    await client.query(await readFile(migrationPath, "utf8"));
    await client.query(`INSERT INTO "User" (id, email, "lastSeenAt") VALUES ('c', 'c@example.com', '2026-09-26T12:00:00Z')`);
    const rows = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "User" WHERE "lastSeenAt" IS NOT NULL`);
    expect(rows.rows).toEqual([{ n: "1" }]);
  });
});
