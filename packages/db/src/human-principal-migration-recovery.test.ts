import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error - production helper is intentionally runtime-native ESM.
import * as recovery from "../scripts/lib/human-principal-migration-recovery.mjs";
// @ts-expect-error - production helper is intentionally runtime-native ESM.
import * as runner from "../scripts/recover-human-principal-backfill-migration.mjs";

const {
  classifyHumanPrincipalMigrationRecovery,
  HUMAN_PRINCIPAL_BACKFILL_MIGRATION,
  HUMAN_PRINCIPAL_BACKFILL_SHA256,
  HUMAN_PRINCIPAL_PREPARATION_SHA256,
} = recovery;
const { inspectRecoveryState, verifyRolledBackMigration } = runner;

const exactFailure = {
  id: "11111111-1111-4111-8111-111111111111",
  migrationName: HUMAN_PRINCIPAL_BACKFILL_MIGRATION,
  checksum: HUMAN_PRINCIPAL_BACKFILL_SHA256,
  appliedStepsCount: 0,
  logs: [
    "Database error code: 23505",
    'duplicate key value violates unique constraint "PrincipalAlias_aliasType_aliasValue_issuer_key"',
  ].join("\n"),
};

describe("human-principal migration recovery policy", () => {
  it("recovers only the exact zero-step alias-collision failure with the corrective bytes present", () => {
    expect(classifyHumanPrincipalMigrationRecovery({
      unresolvedMigrations: [exactFailure],
      preparationChecksum: HUMAN_PRINCIPAL_PREPARATION_SHA256,
    })).toEqual({ action: "recover", migrationId: exactFailure.id });
  });

  it("does nothing when no migration is unresolved", () => {
    expect(classifyHumanPrincipalMigrationRecovery({
      unresolvedMigrations: [],
      preparationChecksum: HUMAN_PRINCIPAL_PREPARATION_SHA256,
    })).toEqual({ action: "not-needed" });
  });

  it.each([
    ["different migration", [{ ...exactFailure, migrationName: "20260812120000_other" }], HUMAN_PRINCIPAL_PREPARATION_SHA256],
    ["different SQLSTATE", [{ ...exactFailure, logs: "Database error code: 23503" }], HUMAN_PRINCIPAL_PREPARATION_SHA256],
    ["different constraint", [{ ...exactFailure, logs: "23505 Other_unique_key" }], HUMAN_PRINCIPAL_PREPARATION_SHA256],
    ["wrong migration checksum", [{ ...exactFailure, checksum: "0".repeat(64) }], HUMAN_PRINCIPAL_PREPARATION_SHA256],
    ["partially applied history", [{ ...exactFailure, appliedStepsCount: 1 }], HUMAN_PRINCIPAL_PREPARATION_SHA256],
    ["multiple unresolved migrations", [exactFailure, { ...exactFailure, id: "22222222-2222-4222-8222-222222222222" }], HUMAN_PRINCIPAL_PREPARATION_SHA256],
    ["wrong corrective bytes", [exactFailure], "0".repeat(64)],
  ])("blocks %s", (_label, unresolvedMigrations, preparationChecksum) => {
    expect(classifyHumanPrincipalMigrationRecovery({
      unresolvedMigrations,
      preparationChecksum,
    })).toMatchObject({ action: "blocked" });
  });

  it("blocks a malformed migration id before it reaches the shell", () => {
    expect(classifyHumanPrincipalMigrationRecovery({
      unresolvedMigrations: [{ ...exactFailure, id: "not-a-uuid" }],
      preparationChecksum: HUMAN_PRINCIPAL_PREPARATION_SHA256,
    })).toMatchObject({ action: "blocked" });
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schemas: string[] = [];

async function recoveryFixture({ attempts = 0 }: { attempts?: number } = {}) {
  const schema = `human_principal_recovery_${randomUUID().replaceAll("-", "")}`;
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
  `);
  for (let index = 0; index < attempts; index += 1) {
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, logs, applied_steps_count)
       VALUES ($1, $2, $3, $4, 0)`,
      [
        index === 0 ? exactFailure.id : "22222222-2222-4222-8222-222222222222",
        HUMAN_PRINCIPAL_BACKFILL_SHA256,
        HUMAN_PRINCIPAL_BACKFILL_MIGRATION,
        exactFailure.logs,
      ],
    );
  }
  return client;
}

describeDatabase("human-principal recovery SQL inspection", () => {
  afterAll(async () => {
    if (!databaseUrl || schemas.length === 0) return;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      for (const schema of schemas) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  });

  it("treats an absent Prisma ledger as a clean install", async () => {
    const schema = `human_principal_recovery_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
      await expect(inspectRecoveryState(client)).resolves.toEqual({ unresolvedMigrations: [] });
    } finally {
      await client.end();
    }
  });

  it("returns all unresolved rows so policy can fail closed", async () => {
    const client = await recoveryFixture({ attempts: 2 });
    try {
      const state = await inspectRecoveryState(client);
      expect(state.unresolvedMigrations).toHaveLength(2);
      expect(state.unresolvedMigrations[0]).toMatchObject({ migrationName: HUMAN_PRINCIPAL_BACKFILL_MIGRATION });
    } finally {
      await client.end();
    }
  });

  it("verifies only the authorized row was rolled back and no unresolved row remains", async () => {
    const client = await recoveryFixture({ attempts: 1 });
    try {
      await client.query(`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = $1`, [exactFailure.id]);
      await expect(verifyRolledBackMigration(client, exactFailure.id)).resolves.toBe(true);
    } finally {
      await client.end();
    }
  });
});
