import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Integration test for 20260721190000_retire_quarantined_duplicate_rows.
//
// The prior generic dedupe (20260720193000) renamed each duplicate loser's key
// to a `__dpf_quarantined__…` value but left the row otherwise live, so the
// coworker roster still rendered 17 ghost duplicates. This migration marks every
// quarantined tombstone inactive using each table's own native marker. The test
// proves: quarantined rows are retired, live rows are untouched, and re-running
// changes nothing (idempotent).

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `retire_quarantined_${randomUUID().replaceAll("-", "")}`;
let client: Client;

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations/20260721190000_retire_quarantined_duplicate_rows/migration.sql",
);

async function migrationBody(): Promise<string> {
  // Strip the transaction wrapper; the test drives its own search_path + txn.
  const sql = await readFile(migrationPath, "utf8");
  return sql.replace(/^\s*BEGIN;\s*$/m, "").replace(/^\s*COMMIT;\s*$/m, "");
}

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("retire quarantined duplicate rows migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);

    await client.query(`
      CREATE TABLE "Agent" (
        id TEXT PRIMARY KEY,
        "agentId" TEXT NOT NULL,
        "displayName" TEXT NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'active',
        "lifecycleStage" TEXT NOT NULL DEFAULT 'production'
      );
      INSERT INTO "Agent" (id, "agentId", "displayName", archived, status, "lifecycleStage") VALUES
        ('live',  'AGT-WS-EA', 'EA Architect', false, 'active', 'production'),
        ('ghost', '__dpf_quarantined__ghost__AGT-WS-EA', 'EA Architect', false, 'active', 'production');

      CREATE TABLE "ModelProfile" (
        id TEXT PRIMARY KEY,
        "providerId" TEXT NOT NULL,
        "modelId" TEXT NOT NULL,
        "modelStatus" TEXT NOT NULL DEFAULT 'active',
        "retiredAt" TIMESTAMP(3),
        "retiredReason" TEXT
      );
      INSERT INTO "ModelProfile" (id, "providerId", "modelId", "modelStatus") VALUES
        ('mp-live',  'openai', 'gpt-x', 'active'),
        ('mp-ghost', 'openai', '__dpf_quarantined__mp__gpt-x', 'active');

      CREATE TABLE "TaxonomyNode" (
        id TEXT PRIMARY KEY,
        "nodeId" TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      INSERT INTO "TaxonomyNode" (id, "nodeId", status) VALUES
        ('tn-live',  'foundational/db', 'active'),
        ('tn-ghost', '__dpf_quarantined__tn__foundational/db', 'active');

      CREATE TABLE "SkillDefinition" (
        id TEXT PRIMARY KEY,
        "skillId" TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      INSERT INTO "SkillDefinition" (id, "skillId", status) VALUES
        ('sd-live',  'dpf-pr-with-dco', 'active'),
        ('sd-ghost', '__dpf_quarantined__sd__dpf-pr-with-dco', 'active');
    `);

    const body = await migrationBody();
    await client.query(body);
  });

  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });

  it("retires the quarantined Agent row and hides it from the roster filter", async () => {
    const rosterVisibleGhosts = await scalar(
      `SELECT count(*) AS value FROM "Agent"
         WHERE archived = false AND "lifecycleStage" <> 'retirement'
           AND "agentId" LIKE '\\_\\_dpf\\_quarantined\\_\\_%'`,
    );
    expect(rosterVisibleGhosts).toBe(0);
  });

  it("leaves the live Agent row fully intact", async () => {
    const live = await client.query(
      `SELECT archived, status, "lifecycleStage" FROM "Agent" WHERE id = 'live'`,
    );
    expect(live.rows[0]).toEqual({
      archived: false,
      status: "active",
      lifecycleStage: "production",
    });
  });

  it("retires the quarantined ModelProfile so the active-model catalog skips it", async () => {
    const phantom = await scalar(
      `SELECT count(*) AS value FROM "ModelProfile"
         WHERE "modelStatus" IN ('active','degraded')
           AND "modelId" LIKE '\\_\\_dpf\\_quarantined\\_\\_%'`,
    );
    expect(phantom).toBe(0);
    const ghost = await client.query(
      `SELECT "modelStatus", "retiredAt", "retiredReason" FROM "ModelProfile" WHERE id = 'mp-ghost'`,
    );
    expect(ghost.rows[0]?.modelStatus).toBe("retired");
    expect(ghost.rows[0]?.retiredAt).not.toBeNull();
    expect(ghost.rows[0]?.retiredReason).toContain("BI-8CCF7F13");
  });

  it("retires the quarantined TaxonomyNode and SkillDefinition", async () => {
    const taxGhost = await scalar(
      `SELECT count(*) AS value FROM "TaxonomyNode"
         WHERE status = 'active' AND "nodeId" LIKE '%__dpf_quarantined__%'`,
    );
    expect(taxGhost).toBe(0);
    const skillGhost = await client.query(
      `SELECT status FROM "SkillDefinition" WHERE id = 'sd-ghost'`,
    );
    expect(skillGhost.rows[0]?.status).toBe("quarantined");
  });

  it("is idempotent — a second run changes nothing", async () => {
    const body = await migrationBody();
    await expect(client.query(body)).resolves.toBeDefined();
    const retiredAgents = await scalar(
      `SELECT count(*) AS value FROM "Agent" WHERE "lifecycleStage" = 'retirement'`,
    );
    expect(retiredAgents).toBe(1);
  });
});
