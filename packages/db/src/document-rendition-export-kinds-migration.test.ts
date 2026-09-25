// BI-4865EB4D (S5 of BI-815D40C6): DocumentRenditionKind gains the export
// kinds docx and odt. The migration must apply against ANY data state
// (AGENTS.md §2): an empty table and a table that already holds renditions.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const priorMigration = new URL(
  "../prisma/migrations/20260925060000_document_rendition_kind_enum/migration.sql",
  import.meta.url,
);
const migrationPath = new URL(
  "../prisma/migrations/20260925120000_document_rendition_export_kinds/migration.sql",
  import.meta.url,
);

const FIXTURE_TABLES = `
  CREATE TABLE "DocumentVersion" (id TEXT PRIMARY KEY);
  CREATE TABLE "DocumentBlob" (id TEXT PRIMARY KEY);
  CREATE TABLE "DocumentRendition" (
    id TEXT PRIMARY KEY,
    "documentVersionId" TEXT NOT NULL REFERENCES "DocumentVersion"(id) ON DELETE CASCADE,
    "renditionKind" TEXT NOT NULL,
    "contentText" TEXT,
    "blobId" TEXT REFERENCES "DocumentBlob"(id) ON DELETE SET NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX "DocumentRendition_documentVersionId_renditionKind_key"
    ON "DocumentRendition"("documentVersionId", "renditionKind");
`;

describe("DocumentRenditionKind export-kinds migration shape", () => {
  it("only adds enum members, idempotently", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const statements = sql
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("--"));
    expect(statements).toEqual([
      `ALTER TYPE "DocumentRenditionKind" ADD VALUE IF NOT EXISTS 'docx';`,
      `ALTER TYPE "DocumentRenditionKind" ADD VALUE IF NOT EXISTS 'odt';`,
    ]);
  });
});

describeDatabase("DocumentRenditionKind export-kinds migration against live Postgres", () => {
  let client: Client;
  const schemas: string[] = [];

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (!client) return;
    for (const schema of schemas) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  async function atPriorMigration(prefix: string, rows: string | null): Promise<void> {
    const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(FIXTURE_TABLES);
    if (rows) await client.query(rows);
    await client.query(await readFile(priorMigration, "utf8"));
  }

  async function kinds(): Promise<string[]> {
    const result = await client.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typname = 'DocumentRenditionKind' AND n.nspname = current_schema() ORDER BY e.enumsortorder`,
    );
    return result.rows.map((row) => row.label);
  }

  it("applies to an empty table, twice", async () => {
    await atPriorMigration("rendition_export_empty", null);
    const sql = await readFile(migrationPath, "utf8");
    await client.query(sql);
    await client.query(sql);
    expect(await kinds()).toEqual(["pdf", "plain_text", "docx", "odt"]);
    await client.query(`
      INSERT INTO "DocumentVersion" (id) VALUES ('v');
      INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind") VALUES ('x', 'v', 'docx'), ('y', 'v', 'odt');
    `);
    await expect(
      client.query(`INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind") VALUES ('z', 'v', 'pptx')`),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("applies to a table that already holds renditions and leaves them untouched", async () => {
    await atPriorMigration(
      "rendition_export_rows",
      `INSERT INTO "DocumentVersion" (id) VALUES ('v1'), ('v2');
       INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind", "contentText") VALUES
         ('pdf-1', 'v1', 'pdf', NULL),
         ('text-1', 'v1', 'plain_text', 'regional adoption figures'),
         ('pdf-2', 'v2', 'pdf', NULL);`,
    );
    await client.query(await readFile(migrationPath, "utf8"));
    const rows = await client.query<{ id: string; kind: string }>(
      `SELECT id, "renditionKind"::text AS kind FROM "DocumentRendition" ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: "pdf-1", kind: "pdf" },
      { id: "pdf-2", kind: "pdf" },
      { id: "text-1", kind: "plain_text" },
    ]);
    await client.query(
      `INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind") VALUES ('docx-1', 'v1', 'docx'), ('odt-2', 'v2', 'odt')`,
    );
    const hits = await client.query<{ id: string }>(
      `SELECT id FROM "DocumentRendition" WHERE "searchVector" @@ websearch_to_tsquery('english', 'adoption figures')`,
    );
    expect(hits.rows).toEqual([{ id: "text-1" }]);
  });
});
