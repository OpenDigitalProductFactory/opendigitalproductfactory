// BI-543819B1 (S7 of BI-815D40C6): DocumentRenditionKind gains `preview`. The
// migration must apply against ANY data state (AGENTS.md §2): a table with no
// renditions and one with the S4 kinds already written.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const s4Migration = new URL("../prisma/migrations/20260925060000_document_rendition_kind_enum/migration.sql", import.meta.url);
const migrationPath = new URL("../prisma/migrations/20260925140000_document_rendition_preview_kind/migration.sql", import.meta.url);

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

describe("DocumentRenditionKind preview migration shape", () => {
  it("only adds the enum member: no row is touched", async () => {
    const sql = (await readFile(migrationPath, "utf8")).replace(/^--.*$/gm, "").trim();
    expect(sql).toBe(`ALTER TYPE "DocumentRenditionKind" ADD VALUE IF NOT EXISTS 'preview';`);
  });
});

describeDatabase("DocumentRenditionKind preview migration against live Postgres", () => {
  let client: Client;
  const schemas: string[] = [];

  async function freshSchema(prefix: string): Promise<void> {
    const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(FIXTURE_TABLES);
    await client.query(await readFile(s4Migration, "utf8"));
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

  it("applies to an empty table and then accepts a preview rendition", async () => {
    await freshSchema("rendition_preview_empty");
    await client.query(await readFile(migrationPath, "utf8"));
    await client.query(`
      INSERT INTO "DocumentVersion" (id) VALUES ('v');
      INSERT INTO "DocumentBlob" (id) VALUES ('manifest');
      INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind", "blobId") VALUES ('p', 'v', 'preview', 'manifest');
    `);
    const rows = await client.query<{ renditionKind: string }>(`SELECT "renditionKind"::text AS "renditionKind" FROM "DocumentRendition"`);
    expect(rows.rows).toEqual([{ renditionKind: "preview" }]);
  });

  it("keeps existing pdf and plain_text renditions unchanged and is harmless to re-run", async () => {
    await freshSchema("rendition_preview_rows");
    await client.query(`
      INSERT INTO "DocumentVersion" (id) VALUES ('v1');
      INSERT INTO "DocumentRendition" (id, "documentVersionId", "renditionKind", "contentText") VALUES
        ('pdf', 'v1', 'pdf', NULL),
        ('text', 'v1', 'plain_text', 'spring adoption drive');
    `);
    await client.query(await readFile(migrationPath, "utf8"));
    await client.query(await readFile(migrationPath, "utf8"));
    const rows = await client.query<{ id: string; renditionKind: string }>(
      `SELECT id, "renditionKind"::text AS "renditionKind" FROM "DocumentRendition" ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: "pdf", renditionKind: "pdf" },
      { id: "text", renditionKind: "plain_text" },
    ]);
  });
});
