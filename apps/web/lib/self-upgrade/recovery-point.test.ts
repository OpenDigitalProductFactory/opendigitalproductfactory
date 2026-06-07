import { describe, expect, it, vi } from "vitest";

import {
  createSelfUpgradeRecoveryPoint,
  summarizeRecoveryPointFailure,
} from "./recovery-point";

describe("self-upgrade recovery point", () => {
  it("runs all managed data-store backups with the pre-upgrade trigger", async () => {
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
        { target: "neo4j", runId: "BR-N4J", status: "ok" },
        { target: "qdrant", runId: "BR-QD", status: "ok" },
      ],
    });
    expect(postgres).toHaveBeenCalledWith({
      trigger: "pre-upgrade-recovery",
      composeProject: "dpf-test",
      backupsRoot: "/tmp/backups",
    });
    expect(neo4j).toHaveBeenCalledWith({
      trigger: "pre-upgrade-recovery",
      composeProject: "dpf-test",
      backupsRoot: "/tmp/backups",
    });
    expect(qdrant).toHaveBeenCalledWith({
      trigger: "pre-upgrade-recovery",
      backupsRoot: "/tmp/backups",
    });
  });

  it("fails the recovery point when a backup runner reports failed", async () => {
    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      runners: {
        postgres: vi.fn().mockResolvedValue({ runId: "BR-PG", status: "ok" }),
        neo4j: vi.fn().mockResolvedValue({ runId: "BR-N4J", status: "failed" }),
        qdrant: vi.fn().mockResolvedValue({ runId: "BR-QD", status: "ok" }),
      },
    });

    expect(point.status).toBe("failed");
    expect(summarizeRecoveryPointFailure(point)).toBe(
      "recovery-point-failed: neo4j BR-N4J",
    );
  });

  it("captures thrown runner errors as failed members", async () => {
    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      runners: {
        postgres: vi.fn().mockRejectedValue(new Error("pg_dump unavailable")),
        neo4j: vi.fn().mockResolvedValue({ runId: "BR-N4J", status: "ok" }),
        qdrant: vi.fn().mockResolvedValue({ runId: "BR-QD", status: "ok" }),
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
});
