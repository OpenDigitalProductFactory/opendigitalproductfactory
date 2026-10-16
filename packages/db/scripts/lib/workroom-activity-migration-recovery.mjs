export const WORKROOM_ACTIVITY_MIGRATION =
  "20261014012000_workroom_activity_ingestion_hardening";
export const WORKROOM_ACTIVITY_SHA256 =
  "422a3ac83fddebc0f24e5eef12394bf6986a2bf457826237b0d91797fe588c45";
export const WORKROOM_ACTIVITY_PREPARATION =
  "20261014011900_prepare_workroom_activity_ingestion";
export const WORKROOM_ACTIVITY_PREPARATION_SHA256 =
  "d052943436703ab7a5a5edf6f61672f89e7ed3540032b9ab682fc9ff6df0b4da";
export const WORKROOM_ACTIVITY_PREDECESSOR_SHA256 =
  "2d5966db8739be6fc6e2bb0662ea89eb87008fe330aa25f31896e010d769450c";
export const INITIATIVE_READINESS_SHA256 =
  "dcb2692a3c730bbe2ac214a901db4da9932a1bcdd8f2aea68475754b2a2325c3";

export const APPEND_ONLY_MESSAGE = "initiative governance activities are append-only";
const MIGRATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blocked = reason => ({ action: "blocked", reason });

/** Bound the candidate before executing any rollback probe. */
export function inspectWorkroomActivityRecoveryCandidate(input) {
  const { unresolvedMigrations } = input;
  if (!unresolvedMigrations.some(row => row.migrationName === WORKROOM_ACTIVITY_MIGRATION)) {
    return { action: "not-needed" };
  }
  if (unresolvedMigrations.length !== 1) return blocked("expected exactly one unresolved migration");
  const row = unresolvedMigrations[0];
  if (!MIGRATION_ID.test(String(row.id ?? ""))) return blocked("migration row id is not a UUID");
  if (row.checksum !== WORKROOM_ACTIVITY_SHA256 || input.migrationChecksum !== WORKROOM_ACTIVITY_SHA256) {
    return blocked("published hardening migration checksum does not match");
  }
  if (input.preparationChecksum !== WORKROOM_ACTIVITY_PREPARATION_SHA256) {
    return blocked("candidate preparation checksum does not match");
  }
  if (row.appliedStepsCount !== 0) return blocked("failed migration has applied steps");
  if (row.logs && !String(row.logs).includes(APPEND_ONLY_MESSAGE)) {
    return blocked("failed migration logs do not match the append-only failure");
  }
  return { action: "probe", migrationId: row.id };
}

/** Never infer an effect-free migration from a zero-step or missing-log row. */
export function classifyWorkroomActivityMigrationRecovery(input) {
  const candidate = inspectWorkroomActivityRecoveryCandidate(input);
  if (candidate.action !== "probe") return candidate;
  if (input.activeMigrationCount !== 0) return blocked("another migration or transaction is active");
  if (!input.predecessorMatches) return blocked("schema does not match the effect-free predecessor");
  if (!input.probe?.rolledBack || !input.probe?.historyUnchanged
    || input.probe.code !== "P0001" || input.probe.message !== APPEND_ONLY_MESSAGE) {
    return blocked("rollback probe did not reproduce the exact append-only failure without durable effects");
  }
  return { action: "recover", migrationId: candidate.migrationId };
}

/** The checksum-bound migration must remain one explicit atomic transaction. */
export function recoveryProbeSql(sql) {
  const begin = sql.indexOf("BEGIN;");
  const tail = /COMMIT;\s*$/.exec(sql);
  if (begin < 0 || !tail || /\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(sql.slice(begin + 6, tail.index))) {
    throw new Error("hardening migration is not the expected single transaction");
  }
  return sql.slice(begin + 6, tail.index);
}

export function functionBodyFromMigration(sql, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`CREATE OR REPLACE FUNCTION "?${escaped}"?\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$`, "i").exec(sql);
  if (!match) throw new Error(`missing immutable predecessor function ${name}`);
  return match[1];
}
