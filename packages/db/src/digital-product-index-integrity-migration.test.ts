import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `digital_product_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("DigitalProduct unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "DigitalProduct" (
        id TEXT PRIMARY KEY,
        "productId" TEXT NOT NULL,
        name TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "lifecycleStatus" TEXT NOT NULL DEFAULT 'draft',
        "coverageStatus" TEXT
      );
      CREATE TABLE "CoworkerService" (id TEXT PRIMARY KEY, "digitalProductId" TEXT);
      CREATE TABLE "CoworkerOffer" (id TEXT PRIMARY KEY, "digitalProductId" TEXT);
      CREATE TABLE "ProductHistory" (
        id TEXT PRIMARY KEY,
        "digitalProductId" TEXT NOT NULL REFERENCES "DigitalProduct"(id)
      );
      CREATE INDEX "DigitalProduct_productId_key" ON "DigitalProduct" ("productId");

      INSERT INTO "DigitalProduct" (id, "productId", name, "createdAt", "lifecycleStatus", "coverageStatus") VALUES
        ('product-old', 'product-alpha', 'Alpha', '2026-01-01', 'active', 'used'),
        ('product-new', 'product-alpha', 'Alpha duplicate', '2026-02-01', 'active', 'used'),
        ('collision', '__dpf_quarantined__product-new__product-alpha', 'Existing key', '2026-01-01', 'active', 'used');
      INSERT INTO "CoworkerService" VALUES ('service-1', 'product-alpha');
      INSERT INTO "CoworkerOffer" VALUES ('offer-1', 'product-alpha');
      INSERT INTO "ProductHistory" VALUES ('history-1', 'product-new');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("quarantines losers without losing references and rebuilds a trustworthy unique index", async () => {
    const migration = await readFile(
      new URL("../prisma/migrations/20260720133000_repair_digital_product_index_integrity/migration.sql", import.meta.url),
      "utf8",
    );

    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text AS value FROM "DigitalProduct"`)).toBe(3);
    expect(await scalar(`SELECT count(*)::text AS value FROM (SELECT "productId" FROM "DigitalProduct" GROUP BY 1 HAVING count(*) > 1) duplicate_groups`)).toBe(0);
    expect((await client.query(`SELECT "productId", "lifecycleStatus", "coverageStatus" FROM "DigitalProduct" WHERE id='product-old'`)).rows[0]).toEqual({
      productId: "product-alpha",
      lifecycleStatus: "active",
      coverageStatus: "used",
    });
    expect((await client.query(`SELECT "productId", "lifecycleStatus", "coverageStatus" FROM "DigitalProduct" WHERE id='product-new'`)).rows[0]).toEqual({
      productId: "__dpf_quarantined__product-new__product-alpha_",
      lifecycleStatus: "retired",
      coverageStatus: "quarantined",
    });
    expect((await client.query(`SELECT "digitalProductId" FROM "ProductHistory" WHERE id='history-1'`)).rows[0]?.digitalProductId).toBe("product-new");
    expect((await client.query(`SELECT "digitalProductId" FROM "CoworkerService" WHERE id='service-1'`)).rows[0]?.digitalProductId).toBe("product-alpha");
    expect((await client.query(`SELECT "digitalProductId" FROM "CoworkerOffer" WHERE id='offer-1'`)).rows[0]?.digitalProductId).toBe("product-alpha");
    expect(await scalar(`SELECT count(*)::text AS value FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname='DigitalProduct_productId_key' AND i.indisunique AND i.indisvalid AND i.indisready`)).toBe(1);
    expect(await scalar(`SELECT count(*)::text AS value FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=current_schema() AND c.conname IN ('CoworkerService_digitalProductId_fkey','CoworkerOffer_digitalProductId_fkey') AND c.convalidated`)).toBe(2);

    const beforeSecondPass = JSON.stringify((await client.query(`SELECT * FROM "DigitalProduct" ORDER BY id`)).rows);
    await client.query(migration);
    const afterSecondPass = JSON.stringify((await client.query(`SELECT * FROM "DigitalProduct" ORDER BY id`)).rows);
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
