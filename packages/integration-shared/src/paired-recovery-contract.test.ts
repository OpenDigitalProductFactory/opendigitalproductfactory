import { describe, expect, it } from "vitest";
import { readPairedRecoveryReceipt, pairedRecoveryTrialMatches } from "./paired-recovery-contract.cjs";

const receipt = {
  schemaVersion: 2,
  postgres: { runId: "pg-selected", storagePath: "postgres/selected", sha256: "a".repeat(64) },
  uploads: {
    runId: "uploads-selected", storagePath: "uploads/selected", sha256: "b".repeat(64),
    manifestSha256: "c".repeat(64), pairedPostgresRunId: "pg-selected", pairedPostgresSha256: "a".repeat(64),
  },
};
const trial = {
  status: "ok", restoreId: "restore-selected",
  postgresRunId: receipt.postgres.runId, postgresSha256: receipt.postgres.sha256,
  uploadsRunId: receipt.uploads.runId, uploadsSha256: receipt.uploads.sha256,
  uploadsManifestSha256: receipt.uploads.manifestSha256,
};

describe("paired recovery evidence", () => {
  it("reads the exact member and custody identities", () => {
    expect(readPairedRecoveryReceipt(receipt)).toEqual(receipt);
  });

  it.each([
    { ...receipt, schemaVersion: 1 },
    { ...receipt, uploads: null },
    { ...receipt, uploads: { ...receipt.uploads, manifestSha256: "" } },
    { ...receipt, uploads: { ...receipt.uploads, pairedPostgresRunId: "pg-other" } },
    { ...receipt, uploads: { ...receipt.uploads, pairedPostgresSha256: "d".repeat(64) } },
    { ...receipt, uploads: { ...receipt.uploads, runId: receipt.postgres.runId } },
    { ...receipt, postgres: { ...receipt.postgres, storagePath: "postgres/../elsewhere" } },
    { ...receipt, uploads: { ...receipt.uploads, storagePath: "/outside/uploads" } },
  ])("refuses invalid evidence instead of treating it as a legacy receipt", (candidate) => {
    expect(readPairedRecoveryReceipt(candidate)).toBeNull();
  });

  it("matches only a successful trial for both exact members and their digests", () => {
    expect(pairedRecoveryTrialMatches(receipt, trial)).toBe(true);
    for (const mismatch of [
      { status: "failed" }, { postgresRunId: "pg-other" }, { postgresSha256: "d".repeat(64) },
      { uploadsRunId: "uploads-other" }, { uploadsSha256: "d".repeat(64) },
      { uploadsManifestSha256: "d".repeat(64) }, { restoreId: "" },
    ]) expect(pairedRecoveryTrialMatches(receipt, { ...trial, ...mismatch })).toBe(false);
  });
});
