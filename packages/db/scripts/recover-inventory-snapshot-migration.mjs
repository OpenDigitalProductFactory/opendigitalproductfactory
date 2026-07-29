#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

import {
  classifyInventorySnapshotRecovery,
  INVENTORY_SNAPSHOT_MIGRATION,
} from "./lib/inventory-snapshot-migration-recovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const indexQuarantinePath = resolve(
  here,
  "../prisma/migrations/20260728115800_quarantine_damaged_inventory_unique_index/migration.sql",
);

function fail(message) {
  process.stderr.write(`inventory-snapshot-recovery: ${message}\n`);
  process.exit(1);
}

export async function inspectRecoveryState(client) {
  let unresolvedMigrations;
  try {
    const result = await client.query(
      `SELECT
         id,
         migration_name AS "migrationName",
         checksum,
         applied_steps_count AS "appliedStepsCount",
         logs
       FROM "_prisma_migrations"
       WHERE finished_at IS NULL
         AND rolled_back_at IS NULL
       ORDER BY started_at, id`,
    );
    unresolvedMigrations = result.rows;
  } catch (error) {
    if (error?.code === "42P01") {
      return { unresolvedMigrations: [], snapshotEffectCount: 0 };
    }
    throw error;
  }

  if (unresolvedMigrations.length === 0) {
    return { unresolvedMigrations, snapshotEffectCount: 0 };
  }

  const effects = await client.query(
    `SELECT count(*)::int AS count
       FROM "InventoryEntity"
      WHERE properties ? '_dpfObservationSnapshot'`,
  );
  return {
    unresolvedMigrations,
    snapshotEffectCount: Number(effects.rows[0]?.count ?? 0),
  };
}

export async function verifyRolledBackMigration(client, migrationId) {
  const result = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE id = $1
           AND migration_name = $2
           AND rolled_back_at IS NOT NULL
           AND finished_at IS NULL
       )::int AS "verifiedRows",
       count(*) FILTER (
         WHERE finished_at IS NULL
           AND rolled_back_at IS NULL
       )::int AS "unresolvedRows"
     FROM "_prisma_migrations"`,
    [migrationId, INVENTORY_SNAPSHOT_MIGRATION],
  );
  return (
    Number(result.rows[0]?.verifiedRows ?? 0) === 1
    && Number(result.rows[0]?.unresolvedRows ?? 0) === 0
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail("DATABASE_URL is not set");

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const verifyIndex = process.argv.indexOf("--verify-rolled-back");
    if (verifyIndex >= 0) {
      const migrationId = process.argv[verifyIndex + 1];
      if (!migrationId) fail("--verify-rolled-back requires a migration row id");
      if (!(await verifyRolledBackMigration(client, migrationId))) {
        fail("post-resolution verification did not match the authorized row");
      }
      process.stdout.write("verified\n");
      return;
    }

    const state = await inspectRecoveryState(client);
    const indexQuarantineChecksum = createHash("sha256")
      .update(readFileSync(indexQuarantinePath))
      .digest("hex");
    const decision = classifyInventorySnapshotRecovery({
      ...state,
      indexQuarantineChecksum,
    });
    if (decision.action === "blocked") {
      fail(decision.reason);
    }
    process.stdout.write(
      decision.action === "recover"
        ? `recover:${decision.migrationId}\n`
        : `${decision.action}\n`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

const invokedDirectly =
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error) => fail(error.message ?? String(error)));
}
