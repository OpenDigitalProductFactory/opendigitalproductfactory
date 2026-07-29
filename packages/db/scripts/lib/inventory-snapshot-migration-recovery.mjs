export const INVENTORY_SNAPSHOT_MIGRATION =
  "20260728115900_snapshot_inventory_observation_facts";
export const INVENTORY_SNAPSHOT_SHA256 =
  "e443357fe93a2f99ada9be0b614663e6d0885b95523a9b4d572353a657b5a77f";
export const INDEX_QUARANTINE_SHA256 =
  "132be99f149869db31d0266f5dfe6cb7f9923f157dbf8f567bf67ebc00f116b7";

const MIGRATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function blocked(reason) {
  return { action: "blocked", reason };
}

export function classifyInventorySnapshotRecovery({
  unresolvedMigrations,
  snapshotEffectCount,
  indexQuarantineChecksum,
}) {
  if (indexQuarantineChecksum !== INDEX_QUARANTINE_SHA256) {
    return blocked("candidate pre-snapshot quarantine checksum does not match");
  }
  if (unresolvedMigrations.length === 0) {
    return { action: "not-needed" };
  }
  if (unresolvedMigrations.length !== 1) {
    return blocked("expected exactly one unresolved migration");
  }

  const migration = unresolvedMigrations[0];
  if (migration.migrationName !== INVENTORY_SNAPSHOT_MIGRATION) {
    return blocked("migration identity does not match the allowlist");
  }
  if (!MIGRATION_ID.test(String(migration.id ?? ""))) {
    return blocked("migration row id is not a UUID");
  }
  if (migration.checksum !== INVENTORY_SNAPSHOT_SHA256) {
    return blocked("failed migration checksum does not match");
  }
  if (migration.appliedStepsCount !== 0) {
    return blocked("failed migration has applied steps");
  }
  if (snapshotEffectCount !== 0) {
    return blocked("failed migration left durable snapshot effects");
  }

  const logs = String(migration.logs ?? "");
  if (!logs.includes("23505")) {
    return blocked("failed migration does not report SQLSTATE 23505");
  }
  if (!logs.includes("InventoryEntity_entityKey_key")) {
    return blocked("failed migration does not name the allowlisted constraint");
  }

  return { action: "recover", migrationId: migration.id };
}
