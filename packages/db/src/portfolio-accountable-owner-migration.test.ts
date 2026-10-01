// BI-67B27832: Portfolio gains one accountable person. The migration must apply
// against ANY data state (AGENTS.md §2): existing portfolios, and a re-run.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const migrationPath = new URL("../prisma/migrations/20260929200000_portfolio_accountable_owner/migration.sql", import.meta.url);

describe("Portfolio accountable owner migration shape", () => {
  it("adds nullable columns only and backfills nothing", async () => {
    const sql = (await readFile(migrationPath, "utf8")).replace(/^--.*$/gm, "");
    // No statement writes rows (an FK's ON UPDATE clause is not a write).
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/im);
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "accountablePrincipalId" TEXT');
  });
});

describeDatabase("Portfolio accountable owner migration against live Postgres", () => {
  let client: Client;
  const schemas: string[] = [];

  async function freshSchema(): Promise<void> {
    const schema = `portfolio_owner_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Principal" (id TEXT PRIMARY KEY);
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "Portfolio" (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
    `);
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

  it("leaves existing portfolios unset, is harmless to re-run, and nulls the owner when the person is removed", async () => {
    await freshSchema();
    await client.query(`INSERT INTO "Portfolio" (id, slug, name) VALUES ('f', 'foundational', 'Foundational'), ('w', 'for_employees', 'Workforce')`);
    await client.query(await readFile(migrationPath, "utf8"));
    await client.query(await readFile(migrationPath, "utf8"));
    const unset = await client.query(`SELECT count(*)::int AS n FROM "Portfolio" WHERE "accountablePrincipalId" IS NULL`);
    expect(unset.rows[0].n).toBe(2);

    await client.query(`INSERT INTO "Principal" (id) VALUES ('p-mark'); INSERT INTO "User" (id) VALUES ('u-mark')`);
    await client.query(`UPDATE "Portfolio" SET "accountablePrincipalId" = 'p-mark', "accountableSetById" = 'u-mark' WHERE id = 'f'`);
    await client.query(`DELETE FROM "Principal" WHERE id = 'p-mark'`);
    const after = await client.query(`SELECT "accountablePrincipalId" FROM "Portfolio" WHERE id = 'f'`);
    expect(after.rows[0].accountablePrincipalId).toBeNull();
  });
});
