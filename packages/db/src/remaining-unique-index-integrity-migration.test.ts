import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `remaining_index_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("remaining unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Agent" (
        id TEXT PRIMARY KEY, "agentId" TEXT NOT NULL, "createdAt" TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "Agent_agentId_key" ON "Agent" ("agentId");
      CREATE TABLE "CoworkerCapabilityNeed" (id TEXT PRIMARY KEY, "agentId" TEXT NOT NULL);
      CREATE TABLE "CoworkerEngagement" (id TEXT PRIMARY KEY, "providerAgentId" TEXT NOT NULL);
      CREATE TABLE "CoworkerSelfAssessment" (id TEXT PRIMARY KEY, "agentId" TEXT NOT NULL);
      CREATE TABLE "CoworkerService" (id TEXT PRIMARY KEY, "providerAgentId" TEXT NOT NULL);

      CREATE TABLE "DiscoveredModel" (
        id TEXT PRIMARY KEY, "providerId" TEXT NOT NULL, "modelId" TEXT NOT NULL,
        "lastSeenAt" TIMESTAMP NOT NULL, "discoveredAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "DiscoveredModel_providerId_modelId_key" ON "DiscoveredModel" ("providerId", "modelId");

      CREATE TABLE "ImprovementSignal" (
        id TEXT PRIMARY KEY, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
        "lastSeenAt" TIMESTAMP NOT NULL, "recurrenceCount" INTEGER NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "ImprovementSignal_sourceType_sourceId_key" ON "ImprovementSignal" ("sourceType", "sourceId");

      CREATE TABLE "ModelProfile" (
        id TEXT PRIMARY KEY, "providerId" TEXT NOT NULL, "modelId" TEXT NOT NULL,
        "lastEvalAt" TIMESTAMP, "evalCount" INTEGER NOT NULL,
        "generatedAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "ModelProfile_providerId_modelId_key" ON "ModelProfile" ("providerId", "modelId");

      CREATE TABLE "RawSource" (
        id TEXT PRIMARY KEY, "sourceKey" TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "RawSource_sourceKey_key" ON "RawSource" ("sourceKey");

      CREATE TABLE "SkillDefinition" (
        id TEXT PRIMARY KEY, "skillId" TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "SkillDefinition_skillId_key" ON "SkillDefinition" ("skillId");
      CREATE TABLE "SkillAssignment" (
        id TEXT PRIMARY KEY, "skillId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
        enabled BOOLEAN NOT NULL, priority INTEGER NOT NULL, "assignedAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "SkillAssignment_skillId_agentId_key" ON "SkillAssignment" ("skillId", "agentId");
      CREATE TABLE "SkillMetric" (id TEXT PRIMARY KEY, "skillId" TEXT NOT NULL);
      CREATE TABLE "SkillRevision" (id TEXT PRIMARY KEY, "skillId" TEXT NOT NULL);
      CREATE TABLE "SkillUsageEvent" (id TEXT PRIMARY KEY, "skillId" TEXT NOT NULL);

      CREATE TABLE "StorefrontArchetype" (
        id TEXT PRIMARY KEY, "archetypeId" TEXT NOT NULL,
        "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL
      );
      CREATE INDEX "StorefrontArchetype_archetypeId_key" ON "StorefrontArchetype" ("archetypeId");

      CREATE TABLE "TaxonomyNode" (id TEXT PRIMARY KEY, "nodeId" TEXT NOT NULL);
      CREATE INDEX "TaxonomyNode_nodeId_key" ON "TaxonomyNode" ("nodeId");

      INSERT INTO "Agent" VALUES
        ('agent-old', 'AGT-1', '2026-01-01', '2026-01-01'),
        ('agent-new', 'AGT-1', '2026-02-01', '2026-03-01'),
        ('agent-collision', '__dpf_quarantined__agent-new__AGT-1', '2026-01-01', '2026-01-01');
      INSERT INTO "CoworkerCapabilityNeed" VALUES ('need-1', 'AGT-1');
      INSERT INTO "CoworkerEngagement" VALUES ('engagement-1', 'AGT-1');
      INSERT INTO "CoworkerSelfAssessment" VALUES ('assessment-1', 'AGT-1');
      INSERT INTO "CoworkerService" VALUES ('service-1', 'AGT-1');

      INSERT INTO "DiscoveredModel" VALUES
        ('discovered-old', 'provider', 'model', '2026-01-01', '2026-01-01'),
        ('discovered-new', 'provider', 'model', '2026-03-01', '2026-02-01');
      INSERT INTO "ImprovementSignal" VALUES
        ('signal-current', 'curator', 'finding', '2026-03-01', 9, '2026-03-01'),
        ('signal-stale', 'curator', 'finding', '2026-02-01', 2, '2026-02-01');
      INSERT INTO "ModelProfile" VALUES
        ('profile-evaluated', 'provider', 'model', '2026-03-01', 3, '2026-02-01'),
        ('profile-seed', 'provider', 'model', NULL, 0, '2026-03-01');
      INSERT INTO "RawSource" VALUES
        ('source-old', 'standard/key', '2026-01-01', '2026-01-01'),
        ('source-new', 'standard/key', '2026-02-01', '2026-03-01');

      INSERT INTO "SkillDefinition" VALUES
        ('skill-old', 'governed-skill', '2026-01-01', '2026-01-01'),
        ('skill-new', 'governed-skill', '2026-02-01', '2026-03-01');
      INSERT INTO "SkillAssignment" VALUES
        ('assignment-old', 'governed-skill', 'worker', true, 5, '2026-01-01'),
        ('assignment-new', 'governed-skill', 'worker', true, 10, '2026-02-01');
      INSERT INTO "SkillMetric" VALUES ('metric-1', 'governed-skill');
      INSERT INTO "SkillRevision" VALUES ('revision-1', 'governed-skill');
      INSERT INTO "SkillUsageEvent" VALUES ('usage-1', 'governed-skill');

      INSERT INTO "StorefrontArchetype" VALUES
        ('archetype-old', 'landscaping', '2026-01-01', '2026-01-01'),
        ('archetype-new', 'landscaping', '2026-02-01', '2026-03-01');
      INSERT INTO "TaxonomyNode" VALUES
        ('taxonomy-a', 'portfolio/database'),
        ('taxonomy-b', 'portfolio/database');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("keeps canonical rows active, preserves every loser, and rebuilds all indexes", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260720190000_repair_remaining_unique_index_integrity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await client.query(migration);

    const expectedSurvivors: Array<[string, string, string, string]> = [
      ["Agent", "id", "agentId", "agent-old"],
      ["DiscoveredModel", "id", "modelId", "discovered-new"],
      ["ImprovementSignal", "id", "sourceId", "signal-current"],
      ["ModelProfile", "id", "modelId", "profile-evaluated"],
      ["RawSource", "id", "sourceKey", "source-new"],
      ["SkillAssignment", "id", "agentId", "assignment-new"],
      ["SkillDefinition", "id", "skillId", "skill-new"],
      ["StorefrontArchetype", "id", "archetypeId", "archetype-new"],
      ["TaxonomyNode", "id", "nodeId", "taxonomy-a"],
    ];
    for (const [table, idColumn, keyColumn, expectedId] of expectedSurvivors) {
      const result = await client.query(
        `SELECT "${idColumn}" AS id FROM "${table}" WHERE "${keyColumn}" NOT LIKE '__dpf_quarantined__%' ORDER BY "${idColumn}"`,
      );
      expect(result.rows.some((row) => row.id === expectedId), `${table} survivor`).toBe(true);
    }

    expect(await scalar(`SELECT count(*)::text value FROM "Agent"`)).toBe(3);
    expect(await scalar(`SELECT count(*)::text value FROM "SkillDefinition"`)).toBe(2);
    expect(await scalar(`SELECT count(*)::text value FROM "SkillAssignment"`)).toBe(2);
    expect(
      await scalar(`
        SELECT count(*)::text value FROM pg_index i
        JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND i.indisunique
          AND i.indisvalid AND i.indisready AND i.indislive
          AND c.relname IN (
            'Agent_agentId_key', 'DiscoveredModel_providerId_modelId_key',
            'ImprovementSignal_sourceType_sourceId_key', 'ModelProfile_providerId_modelId_key',
            'RawSource_sourceKey_key', 'SkillAssignment_skillId_agentId_key',
            'SkillDefinition_skillId_key', 'StorefrontArchetype_archetypeId_key',
            'TaxonomyNode_nodeId_key'
          )
      `),
    ).toBe(9);

    for (const [table, column] of [
      ["CoworkerCapabilityNeed", "agentId"],
      ["CoworkerEngagement", "providerAgentId"],
      ["CoworkerSelfAssessment", "agentId"],
      ["CoworkerService", "providerAgentId"],
    ]) {
      expect((await client.query(`SELECT "${column}" value FROM "${table}"`)).rows[0]?.value).toBe("AGT-1");
    }
    for (const table of ["SkillMetric", "SkillRevision", "SkillUsageEvent"]) {
      expect((await client.query(`SELECT "skillId" value FROM "${table}"`)).rows[0]?.value).toBe("governed-skill");
    }

    const beforeSecondPass = JSON.stringify(
      (await client.query(`
        SELECT 'Agent' table_name, id, "agentId" key FROM "Agent"
        UNION ALL SELECT 'SkillDefinition', id, "skillId" FROM "SkillDefinition"
        UNION ALL SELECT 'TaxonomyNode', id, "nodeId" FROM "TaxonomyNode"
        ORDER BY table_name, id
      `)).rows,
    );
    await client.query(migration);
    const afterSecondPass = JSON.stringify(
      (await client.query(`
        SELECT 'Agent' table_name, id, "agentId" key FROM "Agent"
        UNION ALL SELECT 'SkillDefinition', id, "skillId" FROM "SkillDefinition"
        UNION ALL SELECT 'TaxonomyNode', id, "nodeId" FROM "TaxonomyNode"
        ORDER BY table_name, id
      `)).rows,
    );
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
