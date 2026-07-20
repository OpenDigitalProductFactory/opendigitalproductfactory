import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `platform_config_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("PlatformConfig unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "PlatformConfig" (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value JSONB NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL
      );
      CREATE INDEX "PlatformConfig_key_key" ON "PlatformConfig" (key);
      INSERT INTO "PlatformConfig" (id, key, value, "updatedAt") VALUES
        ('config-old', 'build-studio-dispatch', '{"provider":"claude"}', '2026-07-01'),
        ('config-new', 'build-studio-dispatch', '{"provider":"codex"}', '2026-07-20'),
        ('collision', '__dpf_quarantined__config-old__build-studio-dispatch', '{"provider":"local"}', '2026-07-01');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("keeps the newest configuration active, preserves losers, and rebuilds the unique index", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260720160000_repair_platform_config_index_integrity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text AS value FROM "PlatformConfig"`)).toBe(3);
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM (SELECT key FROM "PlatformConfig" GROUP BY key HAVING count(*) > 1) duplicate_groups
      `),
    ).toBe(0);
    expect(
      (await client.query(`SELECT key, value FROM "PlatformConfig" WHERE id='config-new'`)).rows[0],
    ).toEqual({ key: "build-studio-dispatch", value: { provider: "codex" } });
    expect(
      (await client.query(`SELECT key, value FROM "PlatformConfig" WHERE id='config-old'`)).rows[0],
    ).toEqual({
      key: "__dpf_quarantined__config-old__build-studio-dispatch_",
      value: { provider: "claude" },
    });
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM pg_index i
        JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema()
          AND c.relname='PlatformConfig_key_key'
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      `),
    ).toBe(1);

    const beforeSecondPass = JSON.stringify((await client.query(`SELECT * FROM "PlatformConfig" ORDER BY id`)).rows);
    await client.query(migration);
    const afterSecondPass = JSON.stringify((await client.query(`SELECT * FROM "PlatformConfig" ORDER BY id`)).rows);
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
