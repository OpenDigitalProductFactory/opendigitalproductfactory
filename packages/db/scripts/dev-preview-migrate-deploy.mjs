#!/usr/bin/env node
// scripts/dev-preview-migrate-deploy.mjs
//
// BI-4DB4B415 — governed migrate deploy for the disposable contributor-preview DB.
// Used by docker-compose dev-init instead of bare `prisma migrate deploy`.
//
// Safety:
// - Only runs when DPF_ENVIRONMENT=dev (or --allow-dev-preview).
// - Never targets the live portal; DATABASE_URL must point at dev-postgres.
// - Marks a failed migration applied only when every structural effect is present.
// - Unrecoverable drift → exit 3 (blocked_sandbox_drift) with one next action.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  BLOCKED_SANDBOX_DRIFT_EXIT,
  MAX_REPAIR_ROUNDS,
  decideMigrationRepair,
  formatBlockedMessage,
  parseFailedMigrationFromStatus,
  parseMigrationEffects,
  probeEffectsPresent,
  readMigrationSql,
} from "../../../scripts/lib/dev-preview-migrate-converge.mjs";

const { Client } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DB_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PKG_DB_ROOT, "../..");

function log(msg) {
  process.stderr.write(`[dev-preview-migrate] ${msg}\n`);
}

function prismaInvocation() {
  // Prefer the package-local / workspace prisma binary so Prisma 7 loads
  // packages/db/prisma.config.ts (cwd = packages/db).
  const nodePrisma = [
    resolve(REPO_ROOT, "node_modules/prisma/build/index.js"),
    resolve(PKG_DB_ROOT, "node_modules/prisma/build/index.js"),
  ].find((p) => existsSync(p));
  if (nodePrisma) {
    return { command: process.execPath, argsPrefix: [nodePrisma], cwd: PKG_DB_ROOT };
  }
  return {
    command: "pnpm",
    argsPrefix: ["exec", "prisma"],
    cwd: PKG_DB_ROOT,
  };
}

function runPrisma(args, { env = process.env, allowFail = false } = {}) {
  const inv = prismaInvocation();
  try {
    const out = execFileSync(inv.command, [...inv.argsPrefix, ...args], {
      encoding: "utf8",
      env,
      cwd: inv.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, stdout: out, stderr: "", code: 0, combined: out };
  } catch (error) {
    const stdout = String(error.stdout ?? "");
    const stderr = String(error.stderr ?? "");
    const code = Number(error.status ?? 1);
    return {
      ok: false,
      stdout,
      stderr,
      code,
      combined: `${stdout}\n${stderr}`,
    };
  }
}

function assertDevPreviewContext() {
  const envName = String(process.env.DPF_ENVIRONMENT ?? "").toLowerCase();
  const allow = process.argv.includes("--allow-dev-preview");
  if (envName !== "dev" && !allow) {
    log("refusing to run: DPF_ENVIRONMENT must be 'dev' (or pass --allow-dev-preview for tests)");
    process.exit(2);
  }
  const url = String(process.env.DATABASE_URL ?? "");
  if (!url) {
    log("DATABASE_URL is required");
    process.exit(2);
  }
  // Soft guard: prefer hostnames that look like the contributor preview DB.
  const looksLive =
    /@postgres:|@dpf-postgres|PRODUCTION_DATABASE_URL/i.test(url)
    && !/dev-postgres|localhost:5433|127\.0\.0\.1:5433/i.test(url);
  if (looksLive && !allow) {
    log("refusing DATABASE_URL that looks like the live portal database");
    process.exit(2);
  }
}

async function loadFailedMigrationState(client) {
  const { rows } = await client.query(
    `SELECT migration_name, logs, finished_at, rolled_back_at
       FROM _prisma_migrations
      WHERE finished_at IS NULL
      ORDER BY started_at DESC
      LIMIT 5`,
  );
  return rows;
}

async function main() {
  assertDevPreviewContext();
  const databaseUrl = process.env.DATABASE_URL;

  log("running prisma migrate deploy (contributor-preview)");
  let deploy = runPrisma(["migrate", "deploy"], { allowFail: true });
  if (deploy.ok) {
    log("migrate deploy succeeded with no repair");
    process.stdout.write(deploy.stdout);
    return;
  }

  log("migrate deploy failed; evaluating disposable repair path");
  process.stderr.write(deploy.combined.slice(0, 4000));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (let round = 1; round <= MAX_REPAIR_ROUNDS; round += 1) {
      const failedRows = await loadFailedMigrationState(client);
      let migrationName =
        failedRows[0]?.migration_name
        ?? parseFailedMigrationFromStatus(deploy.combined);

      if (!migrationName) {
        const status = runPrisma(["migrate", "status"], { allowFail: true });
        migrationName = parseFailedMigrationFromStatus(
          `${status.combined ?? ""}\n${deploy.combined}`,
        );
      }

      if (!migrationName) {
        const decision = {
          action: "blocked_sandbox_drift",
          reason: "unparseable-migrate-failure",
          nextAction:
            "Inspect dev-init logs. For disposable contributor preview only, recreate volume dpf_dev_pgdata and re-run the dev profile. Never delete live portal volumes.",
        };
        process.stderr.write(`${formatBlockedMessage(decision)}\n`);
        process.exit(BLOCKED_SANDBOX_DRIFT_EXIT);
      }

      const failureLog = failedRows.find((r) => r.migration_name === migrationName)?.logs
        ?? deploy.combined;

      let effects;
      try {
        effects = parseMigrationEffects(readMigrationSql(migrationName));
      } catch (error) {
        const decision = {
          action: "blocked_sandbox_drift",
          reason: "missing-migration-sql",
          migrationName,
          nextAction: String(error.message),
        };
        process.stderr.write(`${formatBlockedMessage(decision)}\n`);
        process.exit(BLOCKED_SANDBOX_DRIFT_EXIT);
      }

      const present = await probeEffectsPresent(
        async (sql) => (await client.query(sql)).rows,
        effects,
      );

      const decision = decideMigrationRepair({
        migrationName,
        failureLog,
        effects,
        present,
      });

      log(`round=${round} decision=${decision.action} migration=${migrationName} reason=${decision.reason}`);

      if (decision.action === "mark-applied") {
        log(`marking ${migrationName} applied (schema effects already present)`);
        const resolved = runPrisma(
          ["migrate", "resolve", "--applied", migrationName],
          { allowFail: true },
        );
        if (!resolved.ok) {
          process.stderr.write(resolved.combined);
          process.stderr.write(
            `${formatBlockedMessage({
              action: "blocked_sandbox_drift",
              reason: "resolve-applied-failed",
              migrationName,
              nextAction:
                "prisma migrate resolve --applied failed. Recreate disposable dpf_dev_pgdata only, then re-run dev-init.",
            })}\n`,
          );
          process.exit(BLOCKED_SANDBOX_DRIFT_EXIT);
        }
        deploy = runPrisma(["migrate", "deploy"], { allowFail: true });
        if (deploy.ok) {
          log("migrate deploy succeeded after repair");
          process.stdout.write(deploy.stdout);
          return;
        }
        process.stderr.write(deploy.combined.slice(0, 4000));
        continue;
      }

      if (decision.action === "blocked_sandbox_drift") {
        process.stderr.write(`${formatBlockedMessage(decision)}\n`);
        process.exit(BLOCKED_SANDBOX_DRIFT_EXIT);
      }

      // migrate-deploy with no failed migration name — surface original failure
      process.stderr.write(deploy.combined);
      process.exit(deploy.code || 1);
    }

    process.stderr.write(
      `${formatBlockedMessage({
        action: "blocked_sandbox_drift",
        reason: "repair-round-limit",
        nextAction:
          "Exceeded disposable repair rounds. Recreate dpf_dev_pgdata only and re-run dev-init.",
      })}\n`,
    );
    process.exit(BLOCKED_SANDBOX_DRIFT_EXIT);
  } finally {
    await client.end().catch(() => {});
  }
}

const isDirect =
  process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`[dev-preview-migrate] ${error.stack || error.message}\n`);
    process.exit(1);
  });
}
