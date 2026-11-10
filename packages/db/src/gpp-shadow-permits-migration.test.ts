// GPP Phase 2 PR-C (BI-69415B68): the shadow-permit migration must apply
// against ANY data state (AGENTS.md §2) — an empty schema, live ToolExecution
// rows, and a partially applied install — and must only add: new enums, new
// tables, nullable columns, indexes and SET NULL foreign keys.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const migrationPath = new URL("../prisma/migrations/20261001180000_gpp_shadow_permits/migration.sql", import.meta.url);

describe("GPP shadow-permit migration shape", () => {
  it("only adds: no row is written and nothing existing is altered, renamed or dropped", async () => {
    const sql = (await readFile(migrationPath, "utf8")).replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/im);
    expect(sql).not.toMatch(/\b(DROP|RENAME|ALTER COLUMN|SET NOT NULL|TRUNCATE)\b/i);
    const toolExecutionChanges = sql.match(/ALTER TABLE "ToolExecution"[^;]*;/g) ?? [];
    expect(toolExecutionChanges).toEqual([
      `ALTER TABLE "ToolExecution" ADD COLUMN IF NOT EXISTS "gppPermitRef" TEXT;`,
      `ALTER TABLE "ToolExecution" ADD COLUMN IF NOT EXISTS "gppPermitVerdict" "GppPermitVerdict";`,
    ]);
    expect(sql).not.toMatch(/ALTER TABLE "(?!ToolExecution"|GppPermit"|GppPermitObservation")\w+"/);
  });

  it("creates every foreign key ON DELETE SET NULL", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const fks = sql.match(/FOREIGN KEY[^;]*;/g) ?? [];
    expect(fks).toHaveLength(4);
    for (const fk of fks) expect(fk).toContain("ON DELETE SET NULL");
  });
});

describeDatabase("GPP shadow-permit migration against live Postgres", () => {
  let client: Client;
  const schemas: string[] = [];

  async function freshSchema(prefix: string): Promise<void> {
    const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TYPE "DecisionScope" AS ENUM ('wwmd', 'wwwd', 'wsid')`);
    await client.query(`CREATE TABLE "CoworkerActionEnvelope" (id TEXT PRIMARY KEY)`);
    await client.query(`CREATE TABLE "ToolExecution" (id TEXT PRIMARY KEY, "toolName" TEXT NOT NULL)`);
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

  it("leaves existing ToolExecution rows untouched (NULL verdict) and is harmless to re-run", async () => {
    await freshSchema("gpp_permit_rows");
    await client.query(`INSERT INTO "ToolExecution" (id, "toolName") VALUES ('a', 'create_portal_pr'), ('b', 'query_backlog')`);
    const sql = await readFile(migrationPath, "utf8");
    await client.query(sql);
    await client.query(sql);
    const rows = await client.query(`SELECT id, "gppPermitRef", "gppPermitVerdict" FROM "ToolExecution" ORDER BY id`);
    expect(rows.rows).toEqual([
      { id: "a", gppPermitRef: null, gppPermitVerdict: null },
      { id: "b", gppPermitRef: null, gppPermitVerdict: null },
    ]);
  });

  it("applies to an empty schema, and a deleted envelope nulls the permit link", async () => {
    await freshSchema("gpp_permit_empty");
    await client.query(await readFile(migrationPath, "utf8"));
    await client.query(`INSERT INTO "CoworkerActionEnvelope" (id) VALUES ('env-1')`);
    await client.query(
      `INSERT INTO "GppPermit" (id, "gppPermitId", "bindingKey", "bindingVersion", "gateKey", authority, "envelopeId",
         "actorUserRef", capabilities, "expiresAt", nonce)
       VALUES ('p1', 'GPM-1', 'human-checkpoint-admit', 1, 'coworker-authority-escalation', 'wwwd', 'env-1',
         'u1', '[{"tool":"create_portal_pr"}]', now() + interval '15 minutes', 'n')`,
    );
    await client.query(
      `INSERT INTO "GppPermitObservation" (id, "permitRowId", "toolName", verdict, path)
       VALUES ('o1', 'p1', 'create_portal_pr', 'valid', 'monitor')`,
    );
    await client.query(`DELETE FROM "CoworkerActionEnvelope" WHERE id = 'env-1'`);
    await client.query(`DELETE FROM "GppPermit" WHERE id = 'p1'`);
    const obs = await client.query(`SELECT "permitRowId", enforcement::text, detail FROM "GppPermitObservation"`);
    expect(obs.rows).toEqual([{ permitRowId: null, enforcement: "shadow", detail: {} }]);
  });
});
