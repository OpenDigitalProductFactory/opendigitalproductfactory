#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

import {
  inspectUnresolvedMigrations,
  verifyExactMigrationRolledBack,
} from "./lib/failed-migration-ledger.mjs";
import {
  classifyHumanPrincipalMigrationRecovery,
  HUMAN_PRINCIPAL_BACKFILL_MIGRATION,
} from "./lib/human-principal-migration-recovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const preparationPath = resolve(
  here,
  "../prisma/migrations/20260812105900_prepare_human_principal_backfill/migration.sql",
);

function fail(message) {
  process.stderr.write(`human-principal-recovery: ${message}\n`);
  process.exit(1);
}

export async function inspectRecoveryState(client) {
  return { unresolvedMigrations: await inspectUnresolvedMigrations(client) };
}

export async function verifyRolledBackMigration(client, migrationId) {
  return verifyExactMigrationRolledBack(
    client,
    migrationId,
    HUMAN_PRINCIPAL_BACKFILL_MIGRATION,
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
    const preparationChecksum = createHash("sha256")
      .update(readFileSync(preparationPath))
      .digest("hex");
    const decision = classifyHumanPrincipalMigrationRecovery({
      ...state,
      preparationChecksum,
    });
    if (decision.action === "blocked") fail(decision.reason);
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
if (invokedDirectly) main().catch((error) => fail(error.message ?? String(error)));
