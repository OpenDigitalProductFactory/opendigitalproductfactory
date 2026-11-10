#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectUnresolvedMigrations, verifyExactMigrationRolledBack } from "./lib/failed-migration-ledger.mjs";
import {
  classifyWorkroomActivityMigrationRecovery, inspectWorkroomActivityRecoveryCandidate,
  functionBodyFromMigration, recoveryProbeSql,
  WORKROOM_ACTIVITY_MIGRATION, WORKROOM_ACTIVITY_PREPARATION, WORKROOM_ACTIVITY_SHA256,
  WORKROOM_ACTIVITY_PREDECESSOR_SHA256, INITIATIVE_READINESS_SHA256,
} from "./lib/workroom-activity-migration-recovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
const migrationSql = name => readFileSync(resolve(here, "../prisma/migrations", name, "migration.sql"), "utf8");

export function readRecoverySources() {
  const migration = migrationSql(WORKROOM_ACTIVITY_MIGRATION);
  const preparation = migrationSql(WORKROOM_ACTIVITY_PREPARATION);
  const predecessor = migrationSql("20261013180000_workroom_activity_sequence");
  const readiness = migrationSql("20260808235000_initiative_readiness_receipts");
  if (digest(predecessor) !== WORKROOM_ACTIVITY_PREDECESSOR_SHA256 || digest(readiness) !== INITIATIVE_READINESS_SHA256) {
    throw new Error("immutable predecessor migration checksum does not match");
  }
  return {
    migration, migrationChecksum: digest(migration), preparationChecksum: digest(preparation),
    assignmentBody: functionBodyFromMigration(predecessor, "workcapsule_activity_assign_sequence"),
    refusalBody: functionBodyFromMigration(readiness, "refuse_initiative_governance_activity_mutation"),
  };
}

export async function inspectPredecessorSchema(client, sources) {
  const { rows: [row] } = await client.query(`SELECT
    (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('workcapsule_activity_assign_sequence()')) AS assignment,
    (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('refuse_initiative_governance_activity_mutation()')) AS refusal,
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (
      to_regprocedure('workcapsule_activity_assign_sequence()'),
      to_regprocedure('refuse_initiative_governance_activity_mutation()'))
      AND (prosecdef OR proisstrict OR proleakproof OR proconfig IS NOT NULL
        OR provolatile <> 'v' OR proparallel <> 'u' OR prokind <> 'f'
        OR prorettype <> 'trigger'::regtype
        OR prolang <> (SELECT oid FROM pg_language WHERE lanname = 'plpgsql'))) AS "functionAttributesMatch",
    to_regprocedure('preserve_workroom_activity_sequence()') IS NULL AS "preservationFunctionAbsent",
    NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = '"WorkCapsuleActivity"'::regclass
      AND tgname = 'WorkCapsuleActivity_preserve_sequence') AS "preservationTriggerAbsent",
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = '"WorkCapsuleActivity"'::regclass
      AND tgname = 'workcapsule_activity_assign_sequence' AND tgenabled = 'O' AND tgtype = 7
      AND tgnargs = 0
      AND tgfoid = to_regprocedure('workcapsule_activity_assign_sequence()')
      AND tgqual IS NULL) AS "assignmentTriggerMatches",
    (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = '"WorkCapsuleActivity"'::regclass
      AND tgname = 'initiative_work_intent_immutable' AND tgenabled = 'O' AND tgtype = 27
      AND tgnargs = 0 AND tgfoid = to_regprocedure('refuse_initiative_governance_activity_mutation()')) AS "guardDefinition"`);
  // pg_get_expr drops the OLD/NEW qualifier from trigger expressions; the
  // trigger definition retains it, so a NEW.kind guard cannot impersonate OLD.
  const guardCondition = row?.guardDefinition?.match(/ FOR EACH ROW WHEN \((.+)\) EXECUTE FUNCTION /)?.[1];
  return row?.assignment === sources.assignmentBody && row?.refusal === sources.refusalBody
    && row.functionAttributesMatch && row.preservationFunctionAbsent
    && row.preservationTriggerAbsent && row.assignmentTriggerMatches
    && guardCondition?.replace(/[\s()]/g, "") === "old.kind='work-intent-declared'::text";
}

export async function countCompetingTransactions(client) {
  const { rows: [row] } = await client.query(`SELECT count(*)::int AS count FROM pg_stat_activity activity
    WHERE activity.datname = current_database() AND activity.pid <> pg_backend_pid()
      AND activity.backend_type = 'client backend' AND activity.xact_start IS NOT NULL
      AND (activity.state IN ('idle in transaction', 'idle in transaction (aborted)')
        OR activity.query ~* '(_prisma_migrations|prisma|migrat|(^|[;[:space:]])(CREATE|ALTER|DROP)[[:space:]])'
        OR EXISTS (SELECT 1 FROM pg_locks lock WHERE lock.pid = activity.pid AND lock.granted
          AND lock.relation IN (to_regclass('"_prisma_migrations"'), to_regclass('"WorkCapsule"'),
            to_regclass('"WorkCapsuleActivity"'))))`);
  return Number(row?.count ?? -1);
}

/** All attempted SQL effects, including a successful replay, are rolled back. */
export async function probeEffectFreeFailure(client, sources, originalHistory) {
  const result = { rolledBack: false, historyUnchanged: false, predecessorMatches: false,
    activeMigrationCount: -1, code: null, message: null };
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '10s'; SET LOCAL idle_in_transaction_session_timeout = '15s'");
    result.activeMigrationCount = await countCompetingTransactions(client);
    if (result.activeMigrationCount !== 0) return result;
    await client.query('LOCK TABLE "_prisma_migrations" IN ACCESS EXCLUSIVE MODE; LOCK TABLE "WorkCapsule" IN ACCESS EXCLUSIVE MODE; LOCK TABLE "WorkCapsuleActivity" IN ACCESS EXCLUSIVE MODE');
    result.activeMigrationCount = await countCompetingTransactions(client);
    if (result.activeMigrationCount !== 0) return result;
    result.predecessorMatches = await inspectPredecessorSchema(client, sources);
    if (!result.predecessorMatches) return result;
    const lockedHistory = await inspectUnresolvedMigrations(client);
    if (JSON.stringify(lockedHistory) !== JSON.stringify(originalHistory)) return result;
    await client.query("SAVEPOINT workroom_activity_recovery_probe");
    try {
      await client.query(recoveryProbeSql(sources.migration));
    } catch (error) {
      result.code = error.code ?? null;
      result.message = error.message ?? null;
    }
    await client.query("ROLLBACK TO SAVEPOINT workroom_activity_recovery_probe");
    result.historyUnchanged = JSON.stringify(await inspectUnresolvedMigrations(client)) === JSON.stringify(originalHistory)
      && await inspectPredecessorSchema(client, sources);
    return result;
  } finally {
    await client.query("ROLLBACK");
    result.rolledBack = true;
  }
}

export async function inspectRecoveryState(client, sources = readRecoverySources()) {
  const unresolvedMigrations = await inspectUnresolvedMigrations(client);
  if (!unresolvedMigrations.some(row => row.migrationName === WORKROOM_ACTIVITY_MIGRATION)) {
    return { unresolvedMigrations, ...sources };
  }
  const preliminary = inspectWorkroomActivityRecoveryCandidate({ unresolvedMigrations, ...sources });
  if (preliminary.action !== "probe") {
    return { unresolvedMigrations, ...sources };
  }
  const probe = await probeEffectFreeFailure(client, sources, unresolvedMigrations);
  return { unresolvedMigrations, ...sources, activeMigrationCount: probe.activeMigrationCount,
    predecessorMatches: probe.predecessorMatches, probe };
}

export async function verifyRolledBackMigration(client, migrationId) {
  if (!(await verifyExactMigrationRolledBack(client, migrationId, WORKROOM_ACTIVITY_MIGRATION))) return false;
  const { rows: [row] } = await client.query('SELECT checksum, applied_steps_count AS "appliedStepsCount" FROM "_prisma_migrations" WHERE id = $1', [migrationId]);
  return row?.checksum === WORKROOM_ACTIVITY_SHA256 && row?.appliedStepsCount === 0;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const index = process.argv.indexOf("--verify-rolled-back");
    if (index >= 0) {
      const id = process.argv[index + 1];
      if (!id || !await verifyRolledBackMigration(client, id)) throw new Error("post-resolution verification did not match the authorized row");
      process.stdout.write("verified\n");
      return;
    }
    const decision = classifyWorkroomActivityMigrationRecovery(await inspectRecoveryState(client));
    if (decision.action === "blocked") throw new Error(decision.reason);
    process.stdout.write(decision.action === "recover" ? `recover:${decision.migrationId}\n` : `${decision.action}\n`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`workroom-activity-recovery: ${error.message ?? String(error)}\n`); process.exitCode = 1; });
}
