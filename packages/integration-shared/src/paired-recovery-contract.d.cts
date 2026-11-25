export interface RecoveryMemberLocator {
  runId: string;
  storagePath: string;
  sha256: string;
}

export interface PairedRecoveryReceipt {
  schemaVersion: 2;
  postgres: RecoveryMemberLocator;
  uploads: RecoveryMemberLocator & {
    manifestSha256: string;
    pairedPostgresRunId: string;
    pairedPostgresSha256: string;
  };
}

export interface PairedRecoveryTrial {
  status: "ok";
  restoreId: string;
  postgresRunId: string;
  postgresSha256: string;
  uploadsRunId: string;
  uploadsSha256: string;
  uploadsManifestSha256: string;
}

export function readPairedRecoveryReceipt(value: unknown): PairedRecoveryReceipt | null;
export function pairedRecoveryTrialMatches(receipt: unknown, trial: unknown): trial is PairedRecoveryTrial;
