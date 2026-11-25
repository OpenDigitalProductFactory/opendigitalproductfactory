import {
  readPairedRecoveryReceipt,
  type PairedRecoveryReceipt,
} from "@dpf/integration-shared/paired-recovery-contract";

import { readUploadsCustody } from "./uploads-custody";

/** Build a locator pair from exact successful runs, never the latest rows. */
export async function readCapturedBackupPair(input: {
  backupsRoot: string;
  postgresRunId: string;
  uploadsRunId: string;
}): Promise<PairedRecoveryReceipt> {
  const { prisma } = await import("@dpf/db");
  const rows = await prisma.backupRun.findMany({
    where: { id: { in: [input.postgresRunId, input.uploadsRunId] } },
    select: { id: true, target: true, status: true, prunedAt: true, storagePath: true, sha256: true },
  });
  const postgres = rows.find(row => row.id === input.postgresRunId && row.target === "postgres");
  const uploads = rows.find(row => row.id === input.uploadsRunId && row.target === "uploads");
  if (postgres?.status !== "ok" || postgres.prunedAt !== null || !postgres.sha256
    || uploads?.status !== "ok" || uploads.prunedAt !== null || !uploads.sha256) {
    throw new Error("The exact Postgres and uploads runs must both be successful and retained.");
  }

  const custody = await readUploadsCustody(input.backupsRoot, uploads.id);
  if (custody.runId !== uploads.id || custody.storagePath !== uploads.storagePath
    || custody.archiveSha256 !== uploads.sha256) {
    throw new Error("The host upload custody does not match the captured uploads run.");
  }
  const pair = readPairedRecoveryReceipt({
    schemaVersion: 2,
    postgres: { runId: postgres.id, storagePath: postgres.storagePath, sha256: postgres.sha256 },
    uploads: {
      runId: uploads.id,
      storagePath: uploads.storagePath,
      sha256: uploads.sha256,
      manifestSha256: custody.manifestSha256,
      pairedPostgresRunId: custody.pairedPostgresRunId,
      pairedPostgresSha256: custody.pairedPostgresSha256,
    },
  });
  if (!pair) throw new Error("The host upload custody does not bind this exact Postgres and uploads pair.");
  return pair;
}
