import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyRecoveryPointStatus,
  createSelfUpgradeRecoveryPoint,
  resolveRecoveryBackupTargets,
  summarizeRecoveryPointDegradation,
  summarizeRecoveryPointFailure,
  type SelfUpgradeRecoveryPointMember,
} from "./recovery-point";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("self-upgrade recovery point", () => {
  it("backs up only the primary store by default and skips the derived stores", async () => {
    const postgres = vi.fn().mockResolvedValue({ runId: "BR-PG", status: "ok" });
    const neo4j = vi.fn().mockResolvedValue({ runId: "BR-N4J", status: "ok" });
    const qdrant = vi.fn().mockResolvedValue({ runId: "BR-QD", status: "ok" });

    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      composeProject: "dpf-test",
      backupsRoot: "/tmp/backups",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      runners: { postgres, neo4j, qdrant },
    });

    expect(point).toMatchObject({
      schemaVersion: 1,
      status: "ok",
      trigger: "pre-upgrade-recovery",
      selfUpgradeRunId: "SUR-TEST",
      createdAt: "2026-06-01T00:00:00.000Z",
      members: [
        { target: "postgres", runId: "BR-PG", status: "ok" },
        { target: "neo4j", runId: null, status: "skipped" },
        { target: "qdrant", runId: null, status: "skipped" },
      ],
    });
    expect(postgres).toHaveBeenCalledWith({
      trigger: "pre-upgrade-recovery",
      composeProject: "dpf-test",
      backupsRoot: "/tmp/backups",
    });
    // Derived stores rebuild from source and aren't touched by a portal upgrade,
    // so they are never backed up by default — the runners must not be invoked.
    expect(neo4j).not.toHaveBeenCalled();
    expect(qdrant).not.toHaveBeenCalled();
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

  it("backs up an opted-in derived store best-effort: degraded (not failed) on failure", async () => {
    vi.stubEnv("DPF_RECOVERY_POINT_BACKUP_TARGETS", "neo4j");
    const postgres = vi.fn().mockResolvedValue({ runId: "BR-PG", status: "ok" });
    const neo4j = vi.fn().mockResolvedValue({ runId: "BR-N4J", status: "failed" });

    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      runners: { postgres, neo4j },
    });

    // Opted in, so neo4j IS backed up — but a failure only degrades the
    // recovery point; the orchestrator still proceeds (it aborts on "failed").
    expect(neo4j).toHaveBeenCalled();
    expect(point.status).toBe("degraded");
    expect(summarizeRecoveryPointDegradation(point)).toBe(
      "recovery-point-degraded (best-effort backup failed, upgrade proceeding): neo4j",
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

  it("resolveRecoveryBackupTargets always includes postgres and honors the opt-in", () => {
    expect([...resolveRecoveryBackupTargets({})]).toEqual(["postgres"]);
    expect(
      [
        ...resolveRecoveryBackupTargets({
          DPF_RECOVERY_POINT_BACKUP_TARGETS: "neo4j,qdrant",
        }),
      ].sort(),
    ).toEqual(["neo4j", "postgres", "qdrant"]);
    // postgres can never be dropped; unknown tokens are ignored.
    expect([
      ...resolveRecoveryBackupTargets({ DPF_RECOVERY_POINT_BACKUP_TARGETS: "bogus" }),
    ]).toEqual(["postgres"]);
  });
});
