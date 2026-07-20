import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `ea_artifact_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("EaReferenceModelArtifact unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "EaReferenceModel" (id TEXT PRIMARY KEY);
      CREATE TABLE "EaReferenceModelArtifact" (
        id TEXT PRIMARY KEY,
        "modelId" TEXT NOT NULL REFERENCES "EaReferenceModel"(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        checksum TEXT,
        authority TEXT NOT NULL,
        "importedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE "EaReferenceProposal" (
        id TEXT PRIMARY KEY,
        "sourceArtifactId" TEXT REFERENCES "EaReferenceModelArtifact"(id)
      );
      CREATE INDEX "EaReferenceModelArtifact_modelId_path_key"
        ON "EaReferenceModelArtifact" ("modelId", path);

      INSERT INTO "EaReferenceModel" VALUES ('model-1');
      INSERT INTO "EaReferenceModelArtifact"
        (id, "modelId", kind, path, checksum, authority, "createdAt") VALUES
        ('artifact-old', 'model-1', 'xlsx', 'docs/reference.xlsx', 'old-sum', 'authoritative', '2026-01-01'),
        ('artifact-new', 'model-1', 'xlsx', 'docs/reference.xlsx', 'new-sum', 'authoritative', '2026-02-01'),
        ('collision', 'model-1', 'txt', '__dpf_quarantined__artifact-new__docs/reference.xlsx', null, 'supporting', '2026-01-01');
      INSERT INTO "EaReferenceProposal" VALUES ('proposal-1', 'artifact-new');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("quarantines losers without losing proposal history and rebuilds a trustworthy unique index", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260720143000_repair_ea_reference_artifact_index_integrity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text AS value FROM "EaReferenceModelArtifact"`)).toBe(3);
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM (
          SELECT "modelId", path
          FROM "EaReferenceModelArtifact"
          GROUP BY 1, 2
          HAVING count(*) > 1
        ) duplicate_groups
      `),
    ).toBe(0);
    expect(
      (await client.query(`SELECT path, checksum FROM "EaReferenceModelArtifact" WHERE id='artifact-old'`)).rows[0],
    ).toEqual({ path: "docs/reference.xlsx", checksum: "old-sum" });
    expect(
      (await client.query(`SELECT path, checksum FROM "EaReferenceModelArtifact" WHERE id='artifact-new'`)).rows[0],
    ).toEqual({
      path: "__dpf_quarantined__artifact-new__docs/reference.xlsx_",
      checksum: "new-sum",
    });
    expect(
      (await client.query(`SELECT "sourceArtifactId" FROM "EaReferenceProposal" WHERE id='proposal-1'`)).rows[0]
        ?.sourceArtifactId,
    ).toBe("artifact-new");
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM pg_index i
        JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema()
          AND c.relname='EaReferenceModelArtifact_modelId_path_key'
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      `),
    ).toBe(1);

    const beforeSecondPass = JSON.stringify(
      (await client.query(`SELECT * FROM "EaReferenceModelArtifact" ORDER BY id`)).rows,
    );
    await client.query(migration);
    const afterSecondPass = JSON.stringify(
      (await client.query(`SELECT * FROM "EaReferenceModelArtifact" ORDER BY id`)).rows,
    );
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
