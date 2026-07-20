import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `ea_element_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("EaReferenceModelElement unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "EaReferenceModel" (id TEXT PRIMARY KEY);
      CREATE TABLE "EaReferenceModelElement" (
        id TEXT PRIMARY KEY,
        "modelId" TEXT NOT NULL REFERENCES "EaReferenceModel"(id) ON DELETE CASCADE,
        "parentId" TEXT REFERENCES "EaReferenceModelElement"(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        properties JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE "EaReferenceAssessment" (
        id TEXT PRIMARY KEY,
        "modelElementId" TEXT NOT NULL REFERENCES "EaReferenceModelElement"(id) ON DELETE CASCADE
      );
      CREATE INDEX "EaReferenceModelElement_modelId_slug_key"
        ON "EaReferenceModelElement" ("modelId", slug);

      INSERT INTO "EaReferenceModel" VALUES ('model-1');
      INSERT INTO "EaReferenceModelElement"
        (id, "modelId", kind, slug, name, properties) VALUES
        ('element-a', 'model-1', 'criterion', 'duplicate-slug', 'Canonical', '{"source":"a"}'),
        ('element-b', 'model-1', 'criterion', 'duplicate-slug', 'Duplicate', '{"source":"b"}'),
        ('collision', 'model-1', 'criterion', '__dpf_quarantined__element-b__duplicate-slug', 'Collision', '{}');
      INSERT INTO "EaReferenceModelElement"
        (id, "modelId", "parentId", kind, slug, name) VALUES
        ('child', 'model-1', 'element-b', 'criterion', 'child-slug', 'Child');
      INSERT INTO "EaReferenceAssessment" VALUES ('assessment-1', 'element-b');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("quarantines losers without breaking ID relationships and rebuilds a trustworthy unique index", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260720150000_repair_ea_reference_element_index_integrity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text AS value FROM "EaReferenceModelElement"`)).toBe(4);
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM (
          SELECT "modelId", slug
          FROM "EaReferenceModelElement"
          GROUP BY 1, 2
          HAVING count(*) > 1
        ) duplicate_groups
      `),
    ).toBe(0);
    expect(
      (await client.query(`SELECT slug, name, properties FROM "EaReferenceModelElement" WHERE id='element-a'`))
        .rows[0],
    ).toEqual({ slug: "duplicate-slug", name: "Canonical", properties: { source: "a" } });
    expect(
      (await client.query(`SELECT slug, name, properties FROM "EaReferenceModelElement" WHERE id='element-b'`))
        .rows[0],
    ).toEqual({
      slug: "__dpf_quarantined__element-b__duplicate-slug_",
      name: "Duplicate",
      properties: { source: "b" },
    });
    expect(
      (await client.query(`SELECT "parentId" FROM "EaReferenceModelElement" WHERE id='child'`)).rows[0]
        ?.parentId,
    ).toBe("element-b");
    expect(
      (await client.query(`SELECT "modelElementId" FROM "EaReferenceAssessment" WHERE id='assessment-1'`))
        .rows[0]?.modelElementId,
    ).toBe("element-b");
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM pg_index i
        JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema()
          AND c.relname='EaReferenceModelElement_modelId_slug_key'
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      `),
    ).toBe(1);

    const beforeSecondPass = JSON.stringify(
      (await client.query(`SELECT * FROM "EaReferenceModelElement" ORDER BY id`)).rows,
    );
    await client.query(migration);
    const afterSecondPass = JSON.stringify(
      (await client.query(`SELECT * FROM "EaReferenceModelElement" ORDER BY id`)).rows,
    );
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
