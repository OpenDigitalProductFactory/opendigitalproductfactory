import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error - production helper is intentionally runtime-native ESM.
import {
  classifyInventorySnapshotRecovery,
  INDEX_QUARANTINE_SHA256,
  INVENTORY_SNAPSHOT_SHA256,
  INVENTORY_SNAPSHOT_MIGRATION,
} from "../scripts/lib/inventory-snapshot-migration-recovery.mjs";
import {
  inspectRecoveryState,
  verifyRolledBackMigration,
} from "../scripts/recover-inventory-snapshot-migration.mjs";

const exactFailure = {
  id: "11111111-1111-4111-8111-111111111111",
  migrationName: INVENTORY_SNAPSHOT_MIGRATION,
  checksum: INVENTORY_SNAPSHOT_SHA256,
  finishedAt: null,
  rolledBackAt: null,
  appliedStepsCount: 0,
  logs: [
    "Database error code: 23505",
    'duplicate key value violates unique constraint "InventoryEntity_entityKey_key"',
  ].join("\n"),
};

describe("inventory snapshot migration recovery policy", () => {
  it("recovers only the exact effect-free failed snapshot attempt", () => {
    expect(classifyInventorySnapshotRecovery({
      unresolvedMigrations: [exactFailure],
      snapshotEffectCount: 0,
      indexQuarantineChecksum: INDEX_QUARANTINE_SHA256,
    })).toEqual({ action: "recover", migrationId: exactFailure.id });
  });

  it("does nothing when the snapshot migration has never failed", () => {
    expect(classifyInventorySnapshotRecovery({
      unresolvedMigrations: [],
      snapshotEffectCount: 0,
      indexQuarantineChecksum: INDEX_QUARANTINE_SHA256,
    })).toEqual({ action: "not-needed" });
  });

  it.each([
    ["different SQLSTATE", [{ ...exactFailure, logs: "Database error code: 23503" }], 0, INDEX_QUARANTINE_SHA256],
    ["different constraint", [{ ...exactFailure, logs: "23505 Other_unique_key" }], 0, INDEX_QUARANTINE_SHA256],
    ["wrong snapshot checksum", [{ ...exactFailure, checksum: "0".repeat(64) }], 0, INDEX_QUARANTINE_SHA256],
    ["partially applied history", [{ ...exactFailure, appliedStepsCount: 1 }], 0, INDEX_QUARANTINE_SHA256],
    ["multiple unresolved migrations", [exactFailure, { ...exactFailure, id: "22222222-2222-4222-8222-222222222222" }], 0, INDEX_QUARANTINE_SHA256],
    ["durable snapshot effects", [exactFailure], 1, INDEX_QUARANTINE_SHA256],
    ["wrong quarantine bytes", [exactFailure], 0, "0".repeat(64)],
  ])("blocks %s", (_label, unresolvedMigrations, snapshotEffectCount, indexQuarantineChecksum) => {
    expect(classifyInventorySnapshotRecovery({
      unresolvedMigrations,
      snapshotEffectCount,
      indexQuarantineChecksum,
    })).toMatchObject({ action: "blocked" });
  });

  it("blocks a malformed migration id before it reaches the shell", () => {
    expect(classifyInventorySnapshotRecovery({
      unresolvedMigrations: [{ ...exactFailure, id: "not-a-uuid" }],
      snapshotEffectCount: 0,
      indexQuarantineChecksum: INDEX_QUARANTINE_SHA256,
    })).toMatchObject({ action: "blocked" });
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schemas: string[] = [];

async function recoveryFixture({
  attempts = 0,
  effects = 0,
}: { attempts?: number; effects?: number } = {}) {
  const schema = `inventory_snapshot_recovery_${randomUUID().replaceAll("-", "")}`;
  schemas.push(schema);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
  await client.query(`
    CREATE TABLE "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE "InventoryEntity" (
      id TEXT PRIMARY KEY,
      properties JSONB NOT NULL DEFAULT '{}'
    );
  `);
  for (let index = 0; index < attempts; index += 1) {
    await client.query(
      `INSERT INTO "_prisma_migrations" (
         id, checksum, migration_name, logs, applied_steps_count
       ) VALUES ($1, $2, $3, $4, 0)`,
      [
        index === 0
          ? exactFailure.id
          : "22222222-2222-4222-8222-222222222222",
        INVENTORY_SNAPSHOT_SHA256,
        INVENTORY_SNAPSHOT_MIGRATION,
        exactFailure.logs,
      ],
    );
  }
  for (let index = 0; index < effects; index += 1) {
    await client.query(
      `INSERT INTO "InventoryEntity" (id, properties)
       VALUES ($1, '{"_dpfObservationSnapshot":{"version":1}}')`,
      [`entity-${index}`],
    );
  }
  return client;
}

describeDatabase("inventory snapshot recovery SQL inspection", () => {
  afterAll(async () => {
    if (!databaseUrl || schemas.length === 0) return;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      for (const schema of schemas) {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await client.end();
    }
  });

  it("treats an absent Prisma ledger as a clean install", async () => {
    const schema = `inventory_snapshot_recovery_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
      await expect(inspectRecoveryState(client)).resolves.toEqual({
        unresolvedMigrations: [],
        snapshotEffectCount: 0,
      });
    } finally {
      await client.end();
    }
  });

  it("returns no unresolved attempts for a clean migration ledger", async () => {
    const client = await recoveryFixture();
    try {
      await expect(inspectRecoveryState(client)).resolves.toEqual({
        unresolvedMigrations: [],
        snapshotEffectCount: 0,
      });
    } finally {
      await client.end();
    }
  });

  it("returns every unresolved attempt and durable effect count", async () => {
    const client = await recoveryFixture({ attempts: 2, effects: 1 });
    try {
      const state = await inspectRecoveryState(client);
      expect(state.unresolvedMigrations).toHaveLength(2);
      expect(state.snapshotEffectCount).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("returns unrelated unresolved migrations so recovery fails closed", async () => {
    const client = await recoveryFixture({ attempts: 1 });
    try {
      await client.query(
        `INSERT INTO "_prisma_migrations" (
           id, checksum, migration_name, logs, applied_steps_count
         ) VALUES ($1, $2, $3, $4, 0)`,
        [
          "33333333-3333-4333-8333-333333333333",
          "0".repeat(64),
          "20260728123000_unrelated_failed_migration",
          "unrelated failure",
        ],
      );
      const state = await inspectRecoveryState(client);
      expect(state.unresolvedMigrations).toHaveLength(2);
      expect(classifyInventorySnapshotRecovery({
        ...state,
        indexQuarantineChecksum: INDEX_QUARANTINE_SHA256,
      })).toMatchObject({ action: "blocked" });
    } finally {
      await client.end();
    }
  });

  it("verifies the exact row after it is marked rolled back", async () => {
    const client = await recoveryFixture({ attempts: 1 });
    try {
      await client.query(
        `UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = $1`,
        [exactFailure.id],
      );
      await expect(
        verifyRolledBackMigration(client, exactFailure.id),
      ).resolves.toBe(true);
    } finally {
      await client.end();
    }
  });

  it("rejects post-resolution verification while any other migration is unresolved", async () => {
    const client = await recoveryFixture({ attempts: 1 });
    try {
      await client.query(
        `UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = $1`,
        [exactFailure.id],
      );
      await client.query(
        `INSERT INTO "_prisma_migrations" (
           id, checksum, migration_name, logs, applied_steps_count
         ) VALUES ($1, $2, $3, $4, 0)`,
        [
          "33333333-3333-4333-8333-333333333333",
          "0".repeat(64),
          "20260728123000_unrelated_failed_migration",
          "unrelated failure",
        ],
      );
      await expect(
        verifyRolledBackMigration(client, exactFailure.id),
      ).resolves.toBe(false);
    } finally {
      await client.end();
    }
  });
});
