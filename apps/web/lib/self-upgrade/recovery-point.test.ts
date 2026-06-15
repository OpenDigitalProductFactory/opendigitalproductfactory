import { describe, expect, it, vi } from "vitest";

import {
  classifyRecoveryPointStatus,
  createSelfUpgradeRecoveryPoint,
  resolveRequiredRecoveryTargets,
  summarizeRecoveryPointDegradation,
  summarizeRecoveryPointFailure,
  type SelfUpgradeRecoveryPointMember,
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

  it("degrades — not fails — when only a best-effort (derived-store) backup fails", async () => {
    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      runners: {
        postgres: vi.fn().mockResolvedValue({ runId: "BR-PG", status: "ok" }),
        neo4j: vi.fn().mockResolvedValue({ runId: "BR-N4J", status: "failed" }),
        qdrant: vi.fn().mockResolvedValue({ runId: "BR-QD", status: "ok" }),
      },
    });

    // neo4j (code/knowledge graph) is rebuilt from source, so a failed backup
    // of it must NOT block the upgrade — the recovery point is degraded, not
    // failed, and the orchestrator only aborts on "failed".
    expect(point.status).toBe("degraded");
    expect(summarizeRecoveryPointDegradation(point)).toBe(
      "recovery-point-degraded (best-effort backup failed, upgrade proceeding): neo4j",
    );
  });

  it("fails the recovery point only when the required postgres backup fails", async () => {
    const point = await createSelfUpgradeRecoveryPoint({
      runId: "SUR-TEST",
      runners: {
        postgres: vi.fn().mockResolvedValue({ runId: "BR-PG", status: "failed" }),
        neo4j: vi.fn().mockResolvedValue({ runId: "BR-N4J", status: "ok" }),
        qdrant: vi.fn().mockResolvedValue({ runId: "BR-QD", status: "ok" }),
      },
    });

    expect(point.status).toBe("failed");
    expect(summarizeRecoveryPointFailure(point)).toBe(
      "recovery-point-failed: postgres BR-PG",
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

  it("classifies status by required vs best-effort targets", () => {
    const members: SelfUpgradeRecoveryPointMember[] = [
      { target: "postgres", runId: "BR-PG", status: "ok" },
      { target: "neo4j", runId: "BR-N4J", status: "failed" },
      { target: "qdrant", runId: "BR-QD", status: "ok" },
    ];
    // Default: postgres required, neo4j/qdrant best-effort → degraded.
    expect(classifyRecoveryPointStatus(members, new Set(["postgres"]))).toBe("degraded");
    // Operator widens the required set to include neo4j → now it blocks.
    expect(classifyRecoveryPointStatus(members, new Set(["postgres", "neo4j"]))).toBe(
      "failed",
    );
    // Everything ok → ok.
    expect(
      classifyRecoveryPointStatus(
        members.map((member) => ({ ...member, status: "ok" as const })),
        new Set(["postgres"]),
      ),
    ).toBe("ok");
  });

  it("resolveRequiredRecoveryTargets defaults to postgres and honors the env override", () => {
    expect([...resolveRequiredRecoveryTargets({})]).toEqual(["postgres"]);
    expect(
      [
        ...resolveRequiredRecoveryTargets({
          DPF_RECOVERY_POINT_REQUIRED_TARGETS: "postgres,neo4j",
        }),
      ].sort(),
    ).toEqual(["neo4j", "postgres"]);
    // Unknown values are ignored, falling back to the postgres-only default.
    expect([
      ...resolveRequiredRecoveryTargets({ DPF_RECOVERY_POINT_REQUIRED_TARGETS: "bogus" }),
    ]).toEqual(["postgres"]);
  });
});
