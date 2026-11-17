// BI-0AD6196F: exact-source recovery for one disposable-preview failure.
import { createHash } from "node:crypto";

export const REGISTRY_MIGRATION = "20261028060000_graph_relation_type";
export const RELATION_DRIFT_MIGRATION = "20261114130000_relation_drift_repair";
const REGISTRY_SHA = "b0b76a1bfceaa4909e00c3e820d9c103b5098d7f122054ff52c2b116f0a703b8";
const DRIFT_SHA = "2606adc435559392f8a9804ce6afbfb2e71708cfeeed5e08a782be2766b5edfa";
const digest = sql => createHash("sha256").update(sql).digest("hex");
const knownFailure = row => /23503/.test(String(row.logs ?? ""))
  && /graph_edge_rel_type_fkey/.test(String(row.logs ?? ""))
  && /Key \(rel_type\)=\((PART_OF|DEPENDS_ON)\) is not present in table "graph_relation_type"/.test(String(row.logs ?? ""));
export function isDisposablePreviewDatabaseUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;
    if (url.username !== "dpf" || url.pathname !== "/dpf") return false;
    if (url.hostname === "dev-postgres") return url.port === "" || url.port === "5432";
    return ["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "5433";
  } catch {
    return false;
  }
}
const blocked = reason => ({
  action: "blocked_sandbox_drift", reason, migrationName: RELATION_DRIFT_MIGRATION,
  nextAction: "Preserve preview data and migration history; inspect the source-bound registry recovery evidence through the governed preview path.",
});

const COLUMNS = {
  key: ["text", "text"], relation_class: ["USER-DEFINED", "GraphRelationClass"],
  label: ["text", "text"], inverse_label: ["text", "text"],
  status: ["USER-DEFINED", "GraphRelationStatus"],
};

/** Pure decision; callers supply SQL bytes read from committed migration files,
 * not hashes. Both byte digests and live ledger checksums are checked here. */
export function decideGraphRegistryRecovery(proof) {
  if (!proof || proof.alreadyAttempted) return blocked("registry-recovery-not-admitted");
  const recoveryMode = proof.recoveryMode ?? "failed";
  if (!["failed", "completed"].includes(recoveryMode)) return blocked("registry-recovery-mode-unrecognized");
  if (typeof proof.registrySql !== "string" || typeof proof.failedSql !== "string"
    || digest(proof.registrySql) !== REGISTRY_SHA || digest(proof.failedSql) !== DRIFT_SHA) {
    return blocked("registry-source-checksum-mismatch");
  }
  const prior = proof.registryHistory;
  if (!Array.isArray(prior) || prior.length !== 1
    || prior[0].migration_name !== REGISTRY_MIGRATION || prior[0].checksum !== REGISTRY_SHA
    || !prior[0].finished_at || prior[0].rolled_back_at != null || prior[0].applied_steps_count !== 1) {
    return blocked("registry-history-not-completed");
  }
  const schema = proof.schema;
  if (schema?.registrySchema !== "public" || schema?.historySchema !== "public"
    || schema?.columns?.length !== Object.keys(COLUMNS).length
    || !Object.entries(COLUMNS).every(([name, [type, udt]]) => {
      const matches = schema.columns.filter(c => c.column_name === name);
      return matches.length === 1 && matches[0].data_type === type
        && matches[0].udt_name === udt && matches[0].is_nullable === "NO";
    }) || schema.primaryKeyColumns?.length !== 1 || schema.primaryKeyColumns[0] !== "key") {
    return blocked("registry-schema-mismatch");
  }
  if (!Array.isArray(proof.existingKeys)
    || proof.existingKeys.some(key => typeof key !== "string")
    || new Set(proof.existingKeys).size !== proof.existingKeys.length) return blocked("registry-keys-unverified");

  // Parse only the INSERT from the checksum-bound original migration. Its
  // existing ON CONFLICT DO NOTHING preserves installed labels/status/custom rows.
  const inserts = proof.registrySql.match(/INSERT INTO "graph_relation_type"[^;]*;/g);
  if (inserts?.length !== 1 || !inserts[0].endsWith('ON CONFLICT ("key") DO NOTHING;')) {
    return blocked("registry-source-insert-unverified");
  }
  const restoreSql = inserts[0];
  const expectedKeys = [...restoreSql.matchAll(/^\s*\('([A-Z_]+)',/gm)].map(m => m[1]);
  if (!expectedKeys.includes("PART_OF") || !expectedKeys.includes("DEPENDS_ON")
    || new Set(expectedKeys).size !== expectedKeys.length) return blocked("registry-source-keys-unverified");
  const missingKeys = expectedKeys.filter(key => !proof.existingKeys.includes(key));
  const failed = proof.failedRows;
  if (recoveryMode === "completed") {
    if (!Array.isArray(failed) || failed.length !== 0) return blocked("registry-active-failure-present");
    const history = proof.driftHistory;
    if (!Array.isArray(history) || history.some(row => row.migration_name !== RELATION_DRIFT_MIGRATION || row.checksum !== DRIFT_SHA)) {
      return blocked("registry-completed-history-mismatch");
    }
    const completed = history.filter(row => row.finished_at && row.rolled_back_at == null && row.applied_steps_count === 1);
    const rolledBack = history.filter(row => row.finished_at == null && row.rolled_back_at && row.applied_steps_count === 0 && knownFailure(row));
    if (completed.length !== 1 || !((history.length === 2 && rolledBack.length === 1)
      // A healthy fresh installation needs no historical failure or repair.
      || (history.length === 1 && missingKeys.length === 0))) return blocked("registry-completed-history-mismatch");
    if (missingKeys.length === 0) return { action: "registry-current", reason: "verified-registry-current", expectedKeys };
  } else {
    if (!Array.isArray(failed) || failed.length !== 1
      || failed[0].migration_name !== RELATION_DRIFT_MIGRATION || failed[0].checksum !== DRIFT_SHA
      || failed[0].finished_at != null || failed[0].rolled_back_at != null
      || failed[0].applied_steps_count !== 0) return blocked("registry-failure-history-mismatch");
    if (!knownFailure(failed[0])) return blocked("registry-unrelated-failure");
  }
  return {
    action: recoveryMode === "completed" ? "restore-registry" : "restore-registry-and-retry",
    reason: recoveryMode === "completed" ? "verified-completed-registry-history-drift" : "verified-registry-history-drift",
    migrationName: RELATION_DRIFT_MIGRATION, restoreSql, expectedKeys,
    missingKeys,
  };
}

/** query(sql, values) returns rows. SQL files come from the existing source reader. */
export async function probeGraphRegistryRecovery(query, readSql, alreadyAttempted = false, recoveryMode = "failed") {
  const registryHistory = await query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
       FROM public._prisma_migrations WHERE migration_name = $1`, [REGISTRY_MIGRATION]);
  const failedRows = await query(
    `SELECT migration_name, checksum, logs, finished_at, rolled_back_at, applied_steps_count
       FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
  const driftHistory = recoveryMode === "completed" ? await query(
    `SELECT migration_name, checksum, logs, finished_at, rolled_back_at, applied_steps_count
       FROM public._prisma_migrations WHERE migration_name = $1`, [RELATION_DRIFT_MIGRATION]) : undefined;
  const columns = await query(
    `SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'graph_relation_type' ORDER BY ordinal_position`);
  const primary = await query(
    `SELECT a.attname AS column_name FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public.graph_relation_type'::regclass AND i.indisprimary ORDER BY a.attnum`);
  const binding = await query(
    `SELECT c.relname, n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid IN (to_regclass('graph_relation_type'), to_regclass('_prisma_migrations'))`);
  const keys = await query('SELECT "key" FROM public.graph_relation_type ORDER BY "key"');
  return decideGraphRegistryRecovery({
    registrySql: readSql(REGISTRY_MIGRATION), failedSql: readSql(RELATION_DRIFT_MIGRATION),
    registryHistory, failedRows, driftHistory, recoveryMode, existingKeys: keys.map(r => r.key), alreadyAttempted,
    schema: { columns, primaryKeyColumns: primary.map(r => r.column_name),
      registrySchema: binding.find(r => r.relname === "graph_relation_type")?.nspname,
      historySchema: binding.find(r => r.relname === "_prisma_migrations")?.nspname },
  });
}

/** Restore in one locked transaction, re-probing inside it. Never execute a
 * caller-supplied decision/SQL. Prisma remains the only migration-history writer. */
export async function recoverGraphRegistry({ query, readSql, runPrisma, context, alreadyAttempted = false, recoveryMode = "failed" }) {
  if (context?.environment !== "dev" || !isDisposablePreviewDatabaseUrl(context?.databaseUrl)) {
    return blocked("registry-destination-not-disposable-dev");
  }
  if (!["failed", "completed"].includes(recoveryMode)) return blocked("registry-recovery-mode-unrecognized");
  await query("BEGIN");
  let decision;
  try {
    await query("SET LOCAL lock_timeout = '5s'");
    await query("SET LOCAL statement_timeout = '30s'");
    // Explicit search path makes the original unqualified INSERT target public.
    await query("SET LOCAL search_path TO public, pg_catalog");
    await query("LOCK TABLE public._prisma_migrations, public.graph_relation_type IN SHARE ROW EXCLUSIVE MODE");
    decision = await probeGraphRegistryRecovery(query, readSql, alreadyAttempted, recoveryMode);
    if (!["restore-registry-and-retry", "restore-registry"].includes(decision.action)) {
      await query("ROLLBACK");
      return decision;
    }
    await query(decision.restoreSql);
    const rows = await query('SELECT "key" FROM public.graph_relation_type WHERE "key" = ANY($1::text[])', [decision.expectedKeys]);
    if (new Set(rows.map(r => r.key)).size !== decision.expectedKeys.length) throw new Error("registry-restoration-incomplete");
    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    return { ...blocked("registry-restoration-refused"), detail: String(error.message) };
  }
  if (recoveryMode === "completed") return { ...decision, action: "restored" };
  const resolved = runPrisma(["migrate", "resolve", "--rolled-back", RELATION_DRIFT_MIGRATION]);
  if (!resolved.ok) return { ...blocked("registry-resolve-rolled-back-failed"), output: resolved.combined };
  const deploy = runPrisma(["migrate", "deploy"]);
  return deploy.ok
    ? { ...decision, action: "recovered", output: deploy.stdout }
    : { ...blocked("registry-retry-failed"), output: deploy.combined };
}
