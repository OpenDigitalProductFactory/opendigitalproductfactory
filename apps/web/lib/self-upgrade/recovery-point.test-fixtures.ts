export function makePairedRecoveryPointFixture(selfUpgradeRunId: string, createdAt: string) {
  const postgres = { runId: "BACKUP-POSTGRES", storagePath: "postgres/fixture", sha256: "1".repeat(64) };
  const uploads = { runId: "BACKUP-UPLOADS", storagePath: "uploads/fixture", sha256: "2".repeat(64),
    manifestSha256: "3".repeat(64), pairedPostgresRunId: postgres.runId, pairedPostgresSha256: postgres.sha256 };
  return {
    schemaVersion: 2 as const, status: "ok", trigger: "pre-upgrade-recovery", selfUpgradeRunId, createdAt,
    members: [{ target: "postgres", runId: postgres.runId, status: "ok" }, { target: "uploads", runId: uploads.runId, status: "ok" }],
    pairedReceipt: { schemaVersion: 2, postgres, uploads },
  };
}
