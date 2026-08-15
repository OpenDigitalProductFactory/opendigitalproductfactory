export const HUMAN_PRINCIPAL_BACKFILL_MIGRATION =
  "20260812110000_backfill_missing_human_principals";
export const HUMAN_PRINCIPAL_BACKFILL_SHA256 =
  "d4451208128e3c56b011f47125b0f08664f6ba4cadd3a9ee1c877c34ce03f1ee";
export const HUMAN_PRINCIPAL_PREPARATION_SHA256 =
  "28c6ad778bb41dda1a87b1f90d9e06d907c56cd683c17c1bc6a847f0d0fc7faf";

const MIGRATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function blocked(reason) {
  return { action: "blocked", reason };
}

export function classifyHumanPrincipalMigrationRecovery({
  unresolvedMigrations,
  preparationChecksum,
}) {
  if (preparationChecksum !== HUMAN_PRINCIPAL_PREPARATION_SHA256) {
    return blocked("candidate collision-preparation checksum does not match");
  }
  if (unresolvedMigrations.length === 0) return { action: "not-needed" };
  if (unresolvedMigrations.length !== 1) {
    return blocked("expected exactly one unresolved migration");
  }

  const migration = unresolvedMigrations[0];
  if (migration.migrationName !== HUMAN_PRINCIPAL_BACKFILL_MIGRATION) {
    return blocked("migration identity does not match the allowlist");
  }
  if (!MIGRATION_ID.test(String(migration.id ?? ""))) {
    return blocked("migration row id is not a UUID");
  }
  if (migration.checksum !== HUMAN_PRINCIPAL_BACKFILL_SHA256) {
    return blocked("failed migration checksum does not match");
  }
  if (migration.appliedStepsCount !== 0) {
    return blocked("failed migration has applied steps");
  }

  const logs = String(migration.logs ?? "");
  if (!logs.includes("23505")) {
    return blocked("failed migration does not report SQLSTATE 23505");
  }
  if (!logs.includes("PrincipalAlias_aliasType_aliasValue_issuer_key")) {
    return blocked("failed migration does not name the allowlisted constraint");
  }

  return { action: "recover", migrationId: migration.id };
}
