import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `geo_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("geographic reference-data index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Country" (id TEXT PRIMARY KEY);
      CREATE TABLE "Region" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        "countryId" TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        "mergedIntoId" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE "City" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        "nameNormalized" TEXT NOT NULL,
        "regionId" TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        "mergedIntoId" TEXT,
        disambiguator TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE "Address" (id TEXT PRIMARY KEY, "cityId" TEXT NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE "Region" ADD CONSTRAINT "Region_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Region"(id);
      ALTER TABLE "City" ADD CONSTRAINT "City_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"(id);
      ALTER TABLE "City" ADD CONSTRAINT "City_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "City"(id);
      ALTER TABLE "Address" ADD CONSTRAINT "Address_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"(id);
      CREATE INDEX "Region_countryId_name_ci" ON "Region" (lower(name), "countryId");
      CREATE INDEX "City_regionId_name_ci" ON "City" (lower(name), "regionId");
      CREATE INDEX "City_regionId_nameNormalized_unique_pending" ON "City" ("regionId", "nameNormalized") WHERE disambiguator IS NULL;
      CREATE INDEX "City_regionId_nameNormalized_disambiguator_unique" ON "City" ("regionId", "nameNormalized", disambiguator) WHERE disambiguator IS NOT NULL;
      CREATE INDEX "Region_countryId_name_idx" ON "Region" ("countryId", name);
      CREATE INDEX "City_regionId_name_idx" ON "City" ("regionId", name);
      CREATE INDEX "City_regionId_nameNormalized_idx" ON "City" ("regionId", "nameNormalized");

      INSERT INTO "Country" VALUES ('country-1');
      INSERT INTO "Region" (id, name, "countryId", "createdAt") VALUES
        ('region-old', 'North', 'country-1', '2026-01-01'),
        ('region-new', 'NORTH', 'country-1', '2026-02-01'),
        ('region-south', 'South', 'country-1', '2026-01-01');
      INSERT INTO "City" (id, name, "nameNormalized", "regionId", "createdAt") VALUES
        ('city-old', 'Metro', 'metro', 'region-old', '2026-01-01'),
        ('city-referenced', 'METRO', 'metro', 'region-new', '2026-02-01'),
        ('city-harbor', 'Harbor', 'harbor', 'region-new', '2026-02-01'),
        ('city-cafe-accent', 'Café', 'cafe', 'region-old', '2026-01-01'),
        ('city-cafe-plain', 'Cafe', 'cafe', 'region-old', '2026-02-01'),
        ('city-south-old', 'Bay', 'bay', 'region-south', '2026-01-01'),
        ('city-south-referenced', 'BAY', 'bay', 'region-south', '2026-02-01'),
        ('city-labelled-old', 'Springfield East', 'springfield', 'region-south', '2026-01-01'),
        ('city-labelled-new', 'Springfield-East', 'springfield', 'region-south', '2026-02-01');
      UPDATE "City" SET disambiguator='county-a' WHERE id IN ('city-labelled-old','city-labelled-new');
      INSERT INTO "Address" VALUES
        ('address-metro', 'city-referenced'),
        ('address-bay', 'city-south-referenced');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("preserves references and lineage while rebuilding trustworthy unique indexes", async () => {
    const migration = await readFile(
      new URL("../prisma/migrations/20260720123000_repair_geographic_index_integrity/migration.sql", import.meta.url),
      "utf8",
    );

    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text AS value FROM "Region"`)).toBe(3);
    expect(await scalar(`SELECT count(*)::text AS value FROM "City"`)).toBe(9);
    expect(await scalar(`SELECT count(*)::text AS value FROM "Address"`)).toBe(2);
    expect((await client.query(`SELECT "cityId" FROM "Address" WHERE id='address-metro'`)).rows[0]?.cityId).toBe("city-referenced");
    expect((await client.query(`SELECT "cityId" FROM "Address" WHERE id='address-bay'`)).rows[0]?.cityId).toBe("city-south-referenced");
    expect((await client.query(`SELECT status, "mergedIntoId", name FROM "Region" WHERE id='region-new'`)).rows[0]).toMatchObject({ status: "superseded", mergedIntoId: "region-old" });
    expect((await client.query(`SELECT "regionId" FROM "City" WHERE id='city-harbor'`)).rows[0]?.regionId).toBe("region-old");
    expect((await client.query(`SELECT status, "mergedIntoId" FROM "City" WHERE id='city-old'`)).rows[0]).toEqual({ status: "superseded", mergedIntoId: "city-referenced" });
    expect((await client.query(`SELECT status, "mergedIntoId" FROM "City" WHERE id='city-south-old'`)).rows[0]).toEqual({ status: "superseded", mergedIntoId: "city-south-referenced" });
    expect(await scalar(`SELECT count(*)::text AS value FROM (SELECT lower(name), "countryId" FROM "Region" GROUP BY 1,2 HAVING count(*)>1) d`)).toBe(0);
    expect(await scalar(`SELECT count(*)::text AS value FROM (SELECT lower(name), "regionId" FROM "City" GROUP BY 1,2 HAVING count(*)>1) d`)).toBe(0);
    expect(await scalar(`SELECT count(*)::text AS value FROM (SELECT "regionId", "nameNormalized" FROM "City" WHERE disambiguator IS NULL GROUP BY 1,2 HAVING count(*)>1) d`)).toBe(0);
    expect(await scalar(`SELECT count(*)::text AS value FROM (SELECT "regionId", "nameNormalized", disambiguator FROM "City" WHERE disambiguator IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1) d`)).toBe(0);
    expect(await scalar(`SELECT count(*)::text AS value FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('Region_countryId_name_ci','City_regionId_name_ci','City_regionId_nameNormalized_unique_pending','City_regionId_nameNormalized_disambiguator_unique') AND i.indisunique AND i.indisvalid AND i.indisready`)).toBe(4);

    const beforeSecondPass = JSON.stringify((await client.query(`SELECT * FROM "Region" ORDER BY id`)).rows) + JSON.stringify((await client.query(`SELECT * FROM "City" ORDER BY id`)).rows) + JSON.stringify((await client.query(`SELECT * FROM "Address" ORDER BY id`)).rows);
    await client.query(migration);
    const afterSecondPass = JSON.stringify((await client.query(`SELECT * FROM "Region" ORDER BY id`)).rows) + JSON.stringify((await client.query(`SELECT * FROM "City" ORDER BY id`)).rows) + JSON.stringify((await client.query(`SELECT * FROM "Address" ORDER BY id`)).rows);
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
