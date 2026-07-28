import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `inventory_entity_repair_${randomUUID().replaceAll("-", "")}`;
const conflictSchema = `inventory_entity_conflict_${randomUUID().replaceAll("-", "")}`;
let client: Client;

const migrationUrl = new URL(
  "../prisma/migrations/20260728120000_repair_inventory_entity_index_integrity/migration.sql",
  import.meta.url,
);
const observationSnapshotMigrationUrl = new URL(
  "../prisma/migrations/20260728115900_snapshot_inventory_observation_facts/migration.sql",
  import.meta.url,
);
const identityTupleMigrationUrl = new URL(
  "../prisma/migrations/20260728154500_preserve_inventory_identity_tuple/migration.sql",
  import.meta.url,
);
const observationRestoreMigrationUrl = new URL(
  "../prisma/migrations/20260728170000_restore_inventory_observation_facts/migration.sql",
  import.meta.url,
);

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

async function createFixture(targetSchema: string, crossScope = false): Promise<void> {
  await client.query(`CREATE SCHEMA "${targetSchema}"`);
  await client.query(`SET search_path TO "${targetSchema}"`);
  await client.query(`
    CREATE TABLE "InventoryEntity" (
      id TEXT PRIMARY KEY,
      "entityKey" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      name TEXT NOT NULL,
      "technicalClass" TEXT,
      "iconKey" TEXT,
      manufacturer TEXT,
      "productModel" TEXT,
      "observedVersion" TEXT,
      "normalizedVersion" TEXT,
      "supportStatus" TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'active',
      "attributionStatus" TEXT NOT NULL DEFAULT 'needs_review',
      confidence DOUBLE PRECISION,
      "providerView" TEXT NOT NULL DEFAULT 'foundational',
      properties JSONB NOT NULL DEFAULT '{}',
      "firstSeenAt" TIMESTAMPTZ NOT NULL,
      "lastSeenAt" TIMESTAMPTZ NOT NULL,
      "lastConfirmedRunId" TEXT,
      "portfolioId" TEXT,
      "taxonomyNodeId" TEXT,
      "digitalProductId" TEXT,
      "attributionMethod" TEXT,
      "attributionConfidence" DOUBLE PRECISION,
      "attributionEvidence" JSONB,
      "candidateTaxonomy" JSONB,
      "catalogIdentityId" TEXT,
      "identityStatus" TEXT,
      "identityConfidence" DOUBLE PRECISION,
      "updatePosture" TEXT NOT NULL DEFAULT 'unknown',
      "updatePostureSource" TEXT,
      "updatePostureConfidence" DOUBLE PRECISION,
      "latestKnownVersion" TEXT,
      "supportLifecycleSource" TEXT,
      "supportLifecycleConfidence" DOUBLE PRECISION,
      "discoveredViaConnectionId" TEXT,
      "scopeKey" TEXT NOT NULL DEFAULT 'organization:internal',
      "customerAccountId" TEXT,
      "customerSiteId" TEXT
    );
    CREATE INDEX "InventoryEntity_entityKey_key" ON "InventoryEntity" ("entityKey");

    CREATE TABLE "InventoryRelationship" (
      id TEXT PRIMARY KEY,
      "relationshipKey" TEXT NOT NULL,
      "relationshipType" TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      confidence DOUBLE PRECISION,
      properties JSONB,
      "firstSeenAt" TIMESTAMPTZ NOT NULL,
      "lastSeenAt" TIMESTAMPTZ NOT NULL,
      "lastConfirmedRunId" TEXT,
      "fromEntityId" TEXT NOT NULL,
      "toEntityId" TEXT NOT NULL,
      "scopeKey" TEXT NOT NULL DEFAULT 'organization:internal',
      "customerAccountId" TEXT,
      "customerSiteId" TEXT
    );
    CREATE UNIQUE INDEX "InventoryRelationship_fromEntityId_toEntityId_relationshipT_key"
      ON "InventoryRelationship" ("fromEntityId", "toEntityId", "relationshipType");
    ALTER TABLE "InventoryRelationship"
      ADD CONSTRAINT "InventoryRelationship_fromEntityId_fkey"
      FOREIGN KEY ("fromEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "InventoryRelationship"
      ADD CONSTRAINT "InventoryRelationship_toEntityId_fkey"
      FOREIGN KEY ("toEntityId") REFERENCES "InventoryEntity"(id);

    CREATE TABLE "ChangeItem" (id TEXT PRIMARY KEY, "inventoryEntityId" TEXT);
    CREATE TABLE "DiscoveredItem" (id TEXT PRIMARY KEY, "inventoryEntityId" TEXT);
    CREATE TABLE "DiscoveredSoftwareEvidence" (id TEXT PRIMARY KEY, "inventoryEntityId" TEXT NOT NULL);
    CREATE TABLE "DiscoveryConnection" (id TEXT PRIMARY KEY, "gatewayEntityId" TEXT);
    CREATE TABLE "DiscoveryFingerprintObservation" (id TEXT PRIMARY KEY, "inventoryEntityId" TEXT);
    CREATE TABLE "DiscoveryTriageDecision" (id TEXT PRIMARY KEY, "inventoryEntityId" TEXT);
    CREATE TABLE "IdentityResolutionLog" (id TEXT PRIMARY KEY, "inventoryEntityId" TEXT);
    CREATE TABLE "PortfolioQualityIssue" (
      id TEXT PRIMARY KEY,
      "issueKey" TEXT NOT NULL UNIQUE,
      "inventoryEntityId" TEXT,
      "inventoryRelationshipId" TEXT
    );
    CREATE TABLE "DiscoveredRelationship" (
      id TEXT PRIMARY KEY,
      "inventoryRelationshipId" TEXT
    );
    CREATE TABLE "RemoteAction" (id TEXT PRIMARY KEY, "inventoryEntityId" TEXT);

    ALTER TABLE "ChangeItem" ADD FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "DiscoveredItem" ADD FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "DiscoveredSoftwareEvidence" ADD FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "DiscoveryConnection" ADD FOREIGN KEY ("gatewayEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "DiscoveryFingerprintObservation" ADD FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "DiscoveryTriageDecision" ADD FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "IdentityResolutionLog" ADD FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "PortfolioQualityIssue" ADD FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"(id);
    ALTER TABLE "PortfolioQualityIssue" ADD FOREIGN KEY ("inventoryRelationshipId") REFERENCES "InventoryRelationship"(id);
    ALTER TABLE "DiscoveredRelationship" ADD FOREIGN KEY ("inventoryRelationshipId") REFERENCES "InventoryRelationship"(id);

    INSERT INTO "InventoryEntity" (
      id, "entityKey", "entityType", name, manufacturer, "supportStatus",
      status, "attributionStatus", confidence, properties,
      "firstSeenAt", "lastSeenAt", "lastConfirmedRunId",
      "portfolioId", "taxonomyNodeId", "scopeKey", "customerAccountId"
    ) VALUES
      (
        'entity-a-old', 'network:duplicate-a', 'network_interface', 'Interface A',
        NULL, 'confirmed-current', 'active', 'attributed', 0.80, '{"old":true,"shared":"old"}',
        '2026-01-01', '2026-01-02', 'run-a-old',
        'portfolio-1', 'taxonomy-1', 'customer:account-1', 'account-1'
      ),
      (
        'entity-a-mid', 'network:duplicate-a', 'network_interface', 'Interface A',
        'Acme', 'unknown', 'active', 'attributed', 0.90, '{"mid":true,"shared":"mid"}',
        '2026-02-01', '2026-02-02', 'run-a-mid',
        'portfolio-1', 'taxonomy-1', 'customer:account-1', 'account-1'
      ),
      (
        'entity-a-new', 'network:duplicate-a', 'network_interface', 'Interface A',
        'Acme', 'unknown', 'active', 'attributed', 0.95, '{"new":true,"shared":"new"}',
        '2026-03-01', '2026-03-02', 'run-a-new',
        'portfolio-1', 'taxonomy-1', 'customer:account-1', 'account-1'
      ),
      (
        'entity-b-old', 'network:duplicate-b', 'network_interface', 'Interface B',
        NULL, 'unknown', 'active', 'attributed', 0.70, '{"old":true}',
        '2026-01-05', '2026-01-06', 'run-b-old',
        'portfolio-1', 'taxonomy-1', 'customer:account-1', 'account-1'
      ),
      (
        'entity-b-new', 'network:duplicate-b', 'network_interface', 'Interface B',
        'Contoso', 'unknown', 'active', 'attributed', 0.90, '{"new":true}',
        '2026-04-01', '2026-04-02', 'run-b-new',
        'portfolio-1', 'taxonomy-1', 'customer:account-1', 'account-1'
      ),
      (
        'entity-target', 'network:target', 'subnet', 'Target',
        NULL, 'unknown', 'active', 'attributed', 1.0, '{}',
        '2026-01-01', '2026-04-02', 'run-target',
        'portfolio-1', 'taxonomy-1', 'customer:account-1', 'account-1'
      ),
      (
        'entity-quarantine-collision',
        '__dpf_quarantined__entity-a-mid__network:duplicate-a',
        'network_interface', 'Reserved collision', NULL, 'unknown',
        'superseded', 'dismissed', 0.1, '{}',
        '2025-01-01', '2025-01-01', NULL,
        'portfolio-1', 'taxonomy-1', 'customer:account-1', 'account-1'
      );

    INSERT INTO "InventoryRelationship" (
      id, "relationshipKey", "relationshipType", status, confidence, properties,
      "firstSeenAt", "lastSeenAt", "lastConfirmedRunId",
      "fromEntityId", "toEntityId", "scopeKey", "customerAccountId"
    ) VALUES
      ('rel-a-old-out', 'rel:a-old:out', 'MEMBER_OF', 'active', 0.7, '{"old":true}', '2026-01-01', '2026-01-02', 'run-a-old', 'entity-a-old', 'entity-target', 'customer:account-1', 'account-1'),
      ('rel-a-mid-out', 'rel:a-mid:out', 'MEMBER_OF', 'active', 0.8, '{"mid":true}', '2026-02-01', '2026-02-02', 'run-a-mid', 'entity-a-mid', 'entity-target', 'customer:account-1', 'account-1'),
      ('rel-a-new-out', 'rel:a-new:out', 'MEMBER_OF', 'active', 0.9, '{"new":true}', '2026-03-01', '2026-03-02', 'run-a-new', 'entity-a-new', 'entity-target', 'customer:account-1', 'account-1'),
      ('rel-a-old-in', 'rel:a-old:in', 'HOSTS', 'active', 0.7, '{}', '2026-01-01', '2026-01-02', 'run-a-old', 'entity-target', 'entity-a-old', 'customer:account-1', 'account-1'),
      ('rel-a-new-in', 'rel:a-new:in', 'HOSTS', 'active', 0.9, '{}', '2026-03-01', '2026-03-02', 'run-a-new', 'entity-target', 'entity-a-new', 'customer:account-1', 'account-1'),
      ('rel-b-old-out', 'rel:b-old:out', 'CONNECTS', 'active', 0.6, '{}', '2026-01-05', '2026-01-06', 'run-b-old', 'entity-b-old', 'entity-target', 'customer:account-1', 'account-1'),
      ('rel-b-new-out', 'rel:b-new:out', 'CONNECTS', 'active', 0.9, '{}', '2026-04-01', '2026-04-02', 'run-b-new', 'entity-b-new', 'entity-target', 'customer:account-1', 'account-1'),
      ('rel-b-to-a', 'rel:b-new:a-new', 'PEERS', 'active', 0.9, '{}', '2026-04-01', '2026-04-02', 'run-b-new', 'entity-b-new', 'entity-a-new', 'customer:account-1', 'account-1'),
      ('rel-self-after-merge', 'rel:a-mid:a-new', 'PEERS', 'active', 0.5, '{}', '2026-03-01', '2026-03-02', 'run-a-new', 'entity-a-mid', 'entity-a-new', 'customer:account-1', 'account-1');

    INSERT INTO "ChangeItem" VALUES ('change-a', 'entity-a-mid');
    INSERT INTO "DiscoveredItem" VALUES ('item-a', 'entity-a-mid'), ('item-b', 'entity-b-new');
    INSERT INTO "DiscoveredSoftwareEvidence" VALUES ('software-a', 'entity-a-new');
    INSERT INTO "DiscoveryConnection" VALUES ('connection-a', 'entity-a-new');
    INSERT INTO "DiscoveryFingerprintObservation" VALUES ('fingerprint-a', 'entity-a-mid');
    INSERT INTO "DiscoveryTriageDecision" VALUES ('triage-a', 'entity-a-new');
    INSERT INTO "IdentityResolutionLog" VALUES ('identity-a', 'entity-a-mid');
    INSERT INTO "PortfolioQualityIssue" VALUES
      ('issue-entity', 'issue:entity', 'entity-a-new', NULL),
      ('issue-relationship', 'issue:relationship', NULL, 'rel-a-new-out');
    INSERT INTO "DiscoveredRelationship" VALUES ('discovered-rel-a', 'rel-a-mid-out');
    INSERT INTO "RemoteAction" VALUES ('remote-a', 'entity-a-new');

    UPDATE "InventoryEntity"
    SET
      "catalogIdentityId" = 'identity-human',
      "identityStatus" = 'human_confirmed',
      "identityConfidence" = 0.99
    WHERE id = 'entity-a-mid';

    UPDATE "InventoryEntity"
    SET
      "catalogIdentityId" = 'identity-ai-newer',
      "identityStatus" = 'ai_resolved',
      "identityConfidence" = 0.74
    WHERE id = 'entity-a-new';

    UPDATE "InventoryEntity"
    SET
      name = 'Legacy Interface A',
      status = 'stale',
      "providerView" = 'foundational',
      "discoveredViaConnectionId" = 'connection-old'
    WHERE id = 'entity-a-old';

    UPDATE "InventoryEntity"
    SET
      name = 'Current Interface A',
      status = 'active',
      "providerView" = 'manufactureAndDeliver',
      "discoveredViaConnectionId" = 'connection-new'
    WHERE id = 'entity-a-new';
  `);

  if (crossScope) {
    await client.query(`
      UPDATE "InventoryEntity"
      SET "scopeKey" = 'customer:account-2', "customerAccountId" = 'account-2'
      WHERE id = 'entity-a-new'
    `);
  }
}

describeDatabase("InventoryEntity unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await createFixture(schema);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${conflictSchema}" CASCADE`);
    await client.end();
  });

  it("converges canonical entities and relationships without losing evidence", async () => {
    const observationSnapshotMigration = await readFile(
      observationSnapshotMigrationUrl,
      "utf8",
    );
    const migration = await readFile(migrationUrl, "utf8");
    const identityTupleMigration = await readFile(identityTupleMigrationUrl, "utf8");
    const observationRestoreMigration = await readFile(
      observationRestoreMigrationUrl,
      "utf8",
    );
    await client.query(observationSnapshotMigration);
    await client.query(migration);
    await client.query(identityTupleMigration);
    await client.query(observationRestoreMigration);

    expect(await scalar(`SELECT count(*)::text value FROM "InventoryEntity"`)).toBe(7);
    expect(await scalar(`SELECT count(*)::text value FROM "InventoryRelationship"`)).toBe(9);

    const canonicalA = (await client.query(`
      SELECT id, name, status, "providerView", "discoveredViaConnectionId",
             manufacturer, "supportStatus", properties, "firstSeenAt", "lastSeenAt",
             "lastConfirmedRunId", "mergedIntoId", "catalogIdentityId",
             "identityStatus", "identityConfidence"
      FROM "InventoryEntity" WHERE "entityKey" = 'network:duplicate-a'
    `)).rows[0];
    expect(canonicalA).toMatchObject({
      id: "entity-a-old",
      name: "Current Interface A",
      status: "active",
      providerView: "manufactureAndDeliver",
      discoveredViaConnectionId: "connection-new",
      manufacturer: "Acme",
      supportStatus: "confirmed-current",
      lastConfirmedRunId: "run-a-new",
      mergedIntoId: null,
      catalogIdentityId: "identity-human",
      identityStatus: "human_confirmed",
      identityConfidence: 0.99,
    });
    expect(canonicalA.properties).toMatchObject({ old: true, new: true, shared: "new" });
    expect(new Date(canonicalA.firstSeenAt).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(new Date(canonicalA.lastSeenAt).toISOString()).toBe("2026-03-02T00:00:00.000Z");

    const entityTombstones = await client.query(`
      SELECT id, status, "mergedIntoId", "entityKey", properties
      FROM "InventoryEntity"
      WHERE id IN ('entity-a-mid', 'entity-a-new', 'entity-b-new')
      ORDER BY id
    `);
    expect(entityTombstones.rows).toHaveLength(3);
    for (const row of entityTombstones.rows) {
      expect(row.status).toBe("superseded");
      expect(row.mergedIntoId).toMatch(/^entity-[ab]-old$/);
      expect(row.entityKey).toMatch(/^__dpf_quarantined__/);
      expect(row.properties._dpfIntegrityRepair).toMatchObject({ backlogItemId: "BI-CF4ADDAC" });
    }
    expect(entityTombstones.rows.find((row) => row.id === "entity-a-mid")?.entityKey)
      .toBe("__dpf_quarantined__entity-a-mid__network:duplicate-a_");

    for (const [table, field, id] of [
      ["ChangeItem", "inventoryEntityId", "change-a"],
      ["DiscoveredItem", "inventoryEntityId", "item-a"],
      ["DiscoveredSoftwareEvidence", "inventoryEntityId", "software-a"],
      ["DiscoveryConnection", "gatewayEntityId", "connection-a"],
      ["DiscoveryFingerprintObservation", "inventoryEntityId", "fingerprint-a"],
      ["DiscoveryTriageDecision", "inventoryEntityId", "triage-a"],
      ["IdentityResolutionLog", "inventoryEntityId", "identity-a"],
      ["PortfolioQualityIssue", "inventoryEntityId", "issue-entity"],
      ["RemoteAction", "inventoryEntityId", "remote-a"],
    ]) {
      const row = (await client.query(
        `SELECT "${field}" value FROM "${table}" WHERE id = $1`,
        [id],
      )).rows[0];
      expect(row?.value, `${table}.${field}`).toBe("entity-a-old");
    }
    expect((await client.query(
      `SELECT "inventoryEntityId" value FROM "DiscoveredItem" WHERE id = 'item-b'`,
    )).rows[0]?.value).toBe("entity-b-old");

    const activeRelationshipCounts = await client.query(`
      SELECT "fromEntityId", "toEntityId", "relationshipType", count(*)::int count
      FROM "InventoryRelationship"
      WHERE "mergedIntoId" IS NULL AND status <> 'superseded'
      GROUP BY 1,2,3 ORDER BY 1,2,3
    `);
    expect(activeRelationshipCounts.rows.every((row) => row.count === 1)).toBe(true);
    expect(activeRelationshipCounts.rows).toContainEqual(expect.objectContaining({
      fromEntityId: "entity-a-old",
      toEntityId: "entity-target",
      relationshipType: "MEMBER_OF",
    }));
    expect(activeRelationshipCounts.rows).toContainEqual(expect.objectContaining({
      fromEntityId: "entity-b-old",
      toEntityId: "entity-a-old",
      relationshipType: "PEERS",
    }));

    const selfLoop = (await client.query(`
      SELECT status, "mergedIntoId", "fromEntityId", "toEntityId"
      FROM "InventoryRelationship" WHERE id = 'rel-self-after-merge'
    `)).rows[0];
    expect(selfLoop).toMatchObject({
      status: "superseded",
      mergedIntoId: null,
      fromEntityId: "entity-a-mid",
      toEntityId: "entity-a-new",
    });

    expect((await client.query(`
      SELECT "inventoryRelationshipId" value
      FROM "DiscoveredRelationship" WHERE id = 'discovered-rel-a'
    `)).rows[0]?.value).toBe("rel-a-old-out");
    expect((await client.query(`
      SELECT "inventoryRelationshipId" value
      FROM "PortfolioQualityIssue" WHERE id = 'issue-relationship'
    `)).rows[0]?.value).toBe("rel-a-old-out");

    expect(await scalar(`
      SELECT count(*)::text value
      FROM (SELECT "entityKey" FROM "InventoryEntity" GROUP BY 1 HAVING count(*) > 1) duplicates
    `)).toBe(0);
    expect(await scalar(`
      SELECT count(*)::text value
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = 'InventoryEntity_entityKey_key'
        AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
    `)).toBe(1);

    await expect(client.query(`
      INSERT INTO "InventoryEntity" (
        id, "entityKey", "entityType", name, properties, "firstSeenAt", "lastSeenAt"
      ) VALUES ('duplicate-rejected', 'network:duplicate-a', 'network_interface', 'Duplicate', '{}', now(), now())
    `)).rejects.toMatchObject({ code: "23505" });

    await expect(client.query(
      `SELECT public.bt_index_parent_check(
        format('%I.%I', current_schema(), 'InventoryEntity_entityKey_key')::regclass,
        true,
        true
      )`,
    )).resolves.toBeDefined();

    const beforeSecondPass =
      JSON.stringify((await client.query(`SELECT * FROM "InventoryEntity" ORDER BY id`)).rows)
      + JSON.stringify((await client.query(`SELECT * FROM "InventoryRelationship" ORDER BY id`)).rows);
    await client.query(observationSnapshotMigration);
    await client.query(migration);
    await client.query(identityTupleMigration);
    await client.query(observationRestoreMigration);
    const afterSecondPass =
      JSON.stringify((await client.query(`SELECT * FROM "InventoryEntity" ORDER BY id`)).rows)
      + JSON.stringify((await client.query(`SELECT * FROM "InventoryRelationship" ORDER BY id`)).rows);
    expect(afterSecondPass).toBe(beforeSecondPass);
  });

  it("rolls back the entire migration when duplicate keys cross ownership scopes", async () => {
    await createFixture(conflictSchema, true);
    const observationSnapshotMigration = await readFile(
      observationSnapshotMigrationUrl,
      "utf8",
    );
    const migration = await readFile(migrationUrl, "utf8");

    await client.query(observationSnapshotMigration);
    await expect(client.query(migration)).rejects.toThrow(/scope|ownership/i);
    await client.query("ROLLBACK");

    expect(await scalar(`
      SELECT count(*)::text value
      FROM "InventoryEntity" WHERE "entityKey" = 'network:duplicate-a'
    `)).toBe(3);
    expect(await scalar(`
      SELECT count(*)::text value
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'InventoryEntity'
        AND column_name = 'mergedIntoId'
    `)).toBe(0);
    expect((await client.query(
      `SELECT "inventoryEntityId" value FROM "RemoteAction" WHERE id = 'remote-a'`,
    )).rows[0]?.value).toBe("entity-a-new");
  });
});
