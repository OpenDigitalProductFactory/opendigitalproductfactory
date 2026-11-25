import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SuccessfulSelfUpgradeRecoveryPoint } from "./recovery-point";
import { persistSelfUpgradeRecoveryPoint, readSelfUpgradeRecoveryPoint } from "./recovery-point-store";

let root: string;
const runId = "SUR-RECEIPT";
const point: SuccessfulSelfUpgradeRecoveryPoint = {
  schemaVersion: 2, status: "ok", trigger: "pre-upgrade-recovery", selfUpgradeRunId: runId,
  createdAt: "2026-06-01T00:00:00.000Z",
  members: [
    { target: "postgres", runId: "BR-PG", status: "ok" },
    { target: "uploads", runId: "BR-UP", status: "ok" },
  ],
  pairedReceipt: {
    schemaVersion: 2,
    postgres: { runId: "BR-PG", storagePath: "postgres/pg", sha256: "a".repeat(64) },
    uploads: {
      runId: "BR-UP", storagePath: "uploads/up", sha256: "b".repeat(64),
      manifestSha256: "c".repeat(64), pairedPostgresRunId: "BR-PG", pairedPostgresSha256: "a".repeat(64),
    },
  },
};

beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "dpf-upgrade-point-test-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("host self-upgrade recovery point", () => {
  it("reads the exact pair from backup storage without an old database", async () => {
    await expect(readSelfUpgradeRecoveryPoint(root, runId)).resolves.toBeNull();
    await expect(persistSelfUpgradeRecoveryPoint(root, point)).resolves.toEqual(point);
    await expect(readSelfUpgradeRecoveryPoint(root, runId)).resolves.toEqual(point);
    const bytes = await readFile(join(root, "self-upgrade", runId, "recovery-point.json"), "utf8");
    expect(JSON.parse(bytes)).toEqual(point);
  });

  it("accepts an exact replay and never overwrites a conflicting receipt", async () => {
    await persistSelfUpgradeRecoveryPoint(root, point);
    await expect(persistSelfUpgradeRecoveryPoint(root, point)).resolves.toEqual(point);
    await expect(persistSelfUpgradeRecoveryPoint(root, { ...point, createdAt: "2026-06-02T00:00:00.000Z" }))
      .rejects.toThrow(/immutable.*changed/i);
    await expect(readSelfUpgradeRecoveryPoint(root, runId)).resolves.toEqual(point);
  });

  it("fails on a symlinked area without writing into its target", async () => {
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, join(root, "self-upgrade"));
    await expect(persistSelfUpgradeRecoveryPoint(root, point)).rejects.toThrow(/physical/i);
    await expect(readSelfUpgradeRecoveryPoint(root, runId)).rejects.toThrow(/physical/i);
    await expect(readFile(join(elsewhere, runId, "recovery-point.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on a linked or malformed receipt instead of treating it as missing", async () => {
    const area = join(root, "self-upgrade", runId);
    await mkdir(area, { recursive: true });
    const elsewhere = join(root, "elsewhere");
    const receipt = join(area, "recovery-point.json");
    await writeFile(elsewhere, JSON.stringify(point));
    await symlink(elsewhere, receipt);
    await expect(readSelfUpgradeRecoveryPoint(root, runId)).rejects.toThrow();
    await rm(receipt);
    await writeFile(receipt, JSON.stringify({ ...point, selfUpgradeRunId: "SUR-OTHER" }));
    await expect(readSelfUpgradeRecoveryPoint(root, runId)).rejects.toThrow(/invalid paired recovery point/i);
    await expect(readSelfUpgradeRecoveryPoint(root, "../elsewhere")).rejects.toThrow(/run ID/i);
  });
});
