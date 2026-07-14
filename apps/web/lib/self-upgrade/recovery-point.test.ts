import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyRecoveryPointStatus,
  createSelfUpgradeRecoveryPoint,
  resolveRecoveryBackupTargets,
  summarizeRecoveryPointFailure,
  type SelfUpgradeRecoveryPointMember,
} from "./recovery-point";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("self-upgrade recovery point", () => {
  it("backs up the primary postgres store (postgres-only after BET-5)", async () => {
    const postgres = vi.fn().mockResolvedValue({ runId: "BR-PG", status: "ok" });

    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      composeProject: "dpf-test",
      backupsRoot: "/tmp/backups",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      runners: { postgres },
    });

    expect(point).toMatchObject({
      schemaVersion: 1,
      status: "ok",
      trigger: "pre-upgrade-recovery",
      selfUpgradeRunId: "SUR-TEST",
      createdAt: "2026-06-01T00:00:00.000Z",
      members: [{ target: "postgres", runId: "BR-PG", status: "ok" }],
    });
    // postgres is the sole recovery-point target — no derived stores remain.
    expect(point.members).toHaveLength(1);
    expect(postgres).toHaveBeenCalledWith({
      trigger: "pre-upgrade-recovery",
      composeProject: "dpf-test",
      backupsRoot: "/tmp/backups",
    });
  });

  it("fails the recovery point when the required postgres backup fails", async () => {
    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      runners: {
        postgres: vi.fn().mockResolvedValue({ runId: "BR-PG", status: "failed" }),
      },
    });

    expect(point.status).toBe("failed");
    expect(summarizeRecoveryPointFailure(point)).toBe(
      "recovery-point-failed: postgres BR-PG",
    );
  });

  it("captures a thrown postgres error as a failed member", async () => {
    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      runners: {
        postgres: vi.fn().mockRejectedValue(new Error("pg_dump unavailable")),
      },
    });

    expect(point.status).toBe("failed");
    expect(point.members[0]).toMatchObject({
      target: "postgres",
      runId: null,
      status: "failed",
      error: "pg_dump unavailable",
    });
    expect(summarizeRecoveryPointFailure(point)).toBe(
      "recovery-point-failed: postgres: pg_dump unavailable",
    );
  });

  it("skips physical backups for dry runs", async () => {
    const postgres = vi.fn();
    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-DRY",
      dryRun: true,
      runners: { postgres },
    });

    expect(point).toMatchObject({
      status: "skipped",
      reason: "dry-run",
      members: [],
    });
    expect(postgres).not.toHaveBeenCalled();
  });

  it("classifyRecoveryPointStatus blocks only on the required (postgres) target", () => {
    const ok: SelfUpgradeRecoveryPointMember[] = [
      { target: "postgres", runId: "BR-PG", status: "ok" },
      { target: "neo4j", runId: null, status: "skipped" },
      { target: "qdrant", runId: null, status: "skipped" },
    ];
    expect(classifyRecoveryPointStatus(ok)).toBe("ok");
    // A required (postgres) failure blocks the upgrade.
    expect(
      classifyRecoveryPointStatus([
        { target: "postgres", runId: "BR-PG", status: "failed" },
        ok[1],
        ok[2],
      ]),
    ).toBe("failed");
    // A best-effort (derived-store) failure only degrades.
    expect(
      classifyRecoveryPointStatus([
        ok[0],
        { target: "neo4j", runId: "BR-N4J", status: "failed" },
        ok[2],
      ]),
    ).toBe("degraded");
  });

  it("resolveRecoveryBackupTargets returns postgres only after BET-5", () => {
    expect([...resolveRecoveryBackupTargets()]).toEqual(["postgres"]);
  });
});
