// BI-9D43CBEF (S4 of BI-815D40C6): DocumentRendition.renditionKind becomes the
// DocumentRenditionKind enum. The migration must apply against ANY data state
// (AGENTS.md §2): an empty table, canonical rows, the legacy spellings from the
// 2026-05-12 document-management spec, and values nothing can map.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const migrationPath = new URL(
  "../prisma/migrations/20260925060000_document_rendition_kind_enum/migration.sql",
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
  CREATE INDEX "DocumentRendition_renditionKind_idx" ON "DocumentRendition"("renditionKind");
  CREATE UNIQUE INDEX "DocumentRendition_documentVersionId_renditionKind_key"
    ON "DocumentRendition"("documentVersionId", "renditionKind");
`;

describe("DocumentRenditionKind migration shape", () => {
  it("removes unmappable rows before the USING cast and indexes rendition text", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain(`CREATE TYPE "DocumentRenditionKind" AS ENUM ('pdf', 'plain_text')`);
    const deleteAt = sql.indexOf(`NOT IN ('pdf', 'plain_text')`);
    const castAt = sql.indexOf(`USING ("renditionKind"::"DocumentRenditionKind")`);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(castAt).toBeGreaterThan(deleteAt);
    expect(sql).toMatch(/"searchVector" tsvector GENERATED ALWAYS AS/);
    expect(sql).toMatch(/USING GIN \("searchVector"\)/);
  });
});

async function withSchema(client: Client, prefix: string): Promise<string> {
  const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(FIXTURE_TABLES);
  return schema;
}

describeDatabase("DocumentRenditionKind migration against live Postgres", () => {
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

  it("applies to an empty table", async () => {
    schemas.push(await withSchema(client, "rendition_kind_empty"));
    await client.query(await readFile(migrationPath, "utf8"));
    const type = await client.query<{ data_type: string; udt_name: string }>(
      `SELECT data_type, udt_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'DocumentRendition' AND column_name = 'renditionKind'`,
    );
    expect(type.rows[0]).toEqual({ data_type: "USER-DEFINED", udt_name: "DocumentRenditionKind" });
    await expect(client.query(
      `INSERT INTO "DocumentVersion" (id) VALUES ('v');
       INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind") VALUES ('bad', 'v', 'thumbnail')`,
    )).rejects.toThrow(/invalid input value for enum/);
  });

  it("maps legacy spellings, keeps canonical rows, and removes what cannot be mapped", async () => {
    schemas.push(await withSchema(client, "rendition_kind_rows"));
    await client.query(`
      INSERT INTO "DocumentVersion" (id) VALUES ('v1'), ('v2'), ('v3');
      INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind", "contentText") VALUES
        ('canonical-pdf', 'v1', 'pdf', NULL),
        ('canonical-text', 'v1', 'plain_text', 'quarterly adoption figures'),
        ('legacy-text', 'v2', 'extracted-text', 'legacy extracted body'),
        ('legacy-pdf', 'v2', 'preview-pdf', NULL),
        ('shadowed-legacy-pdf', 'v1', 'preview-pdf', NULL),
        ('thumbnail', 'v3', 'thumbnail', NULL),
        ('html', 'v3', 'html-preview', NULL);
    `);
    await client.query(await readFile(migrationPath, "utf8"));

    const rows = await client.query<{ id: string; documentVersionId: string; renditionKind: string }>(
      `SELECT id, "documentVersionId", "renditionKind"::text AS "renditionKind" FROM "DocumentRendition" ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: "canonical-pdf", documentVersionId: "v1", renditionKind: "pdf" },
      { id: "canonical-text", documentVersionId: "v1", renditionKind: "plain_text" },
      { id: "legacy-pdf", documentVersionId: "v2", renditionKind: "pdf" },
      { id: "legacy-text", documentVersionId: "v2", renditionKind: "plain_text" },
    ]);

    const hits = await client.query<{ id: string }>(
      `SELECT id FROM "DocumentRendition" WHERE "searchVector" @@ websearch_to_tsquery('english', 'adoption figures')`,
    );
    expect(hits.rows).toEqual([{ id: "canonical-text" }]);
  });
});
