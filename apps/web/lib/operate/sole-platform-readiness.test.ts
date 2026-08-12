import { describe, expect, it } from "vitest";

import {
  evaluateSolePlatformReadiness,
  isSolePlatformReady,
  SOLE_PLATFORM_READINESS_MATRIX,
  type SolePlatformReadinessEvidence,
} from "./sole-platform-readiness";

const NOW = new Date("2026-07-28T15:00:00Z");

function passingEvidence(
  overrides: Partial<SolePlatformReadinessEvidence> & Pick<SolePlatformReadinessEvidence, "dimensionId">,
): SolePlatformReadinessEvidence {
  return {
    status: "passed",
    observedAt: NOW.toISOString(),
    sourceKind: "RuntimeVerification",
    sourceId: `RV-${overrides.dimensionId}`,
    ...overrides,
  };
}

function allPassingEvidence(): SolePlatformReadinessEvidence[] {
  return SOLE_PLATFORM_READINESS_MATRIX.map((policy) =>
    passingEvidence({ dimensionId: policy.id }),
  );
}

describe("evaluateSolePlatformReadiness", () => {
  it("returns ready when every dimension has current passing evidence", () => {
    const result = evaluateSolePlatformReadiness({
      evidence: allPassingEvidence(),
      now: NOW,
    });

    expect(result.status).toBe("ready");
    expect(result.summary).toBe("All required sole-platform operational evidence is current and passing.");
    expect(result.findings).toEqual([]);
    expect(result.counts).toMatchObject({
      passed: SOLE_PLATFORM_READINESS_MATRIX.length,
      blocked: 0,
      degraded: 0,
      missing: 0,
      stale: 0,
    });
    expect(result.evidenceRefs).toHaveLength(SOLE_PLATFORM_READINESS_MATRIX.length);
    expect(isSolePlatformReady({ evidence: allPassingEvidence(), now: NOW })).toBe(true);
  });

  it("blocks sole-platform readiness when trial restore evidence is missing", () => {
    const evidence = allPassingEvidence().filter(
      (item) => item.dimensionId !== "trial-restore",
    );

    const result = evaluateSolePlatformReadiness({ evidence, now: NOW });

    expect(result.status).toBe("not-ready");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "trial-restore:missing",
        severity: "blocker",
        kind: "missing-evidence",
      }),
    );
  });

  it("keeps non-critical evidence gaps as degraded instead of ready", () => {
    const evidence = allPassingEvidence().filter(
      (item) => item.dimensionId !== "alert-routing",
    );

    const result = evaluateSolePlatformReadiness({ evidence, now: NOW });

    expect(result.status).toBe("degraded");
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: "alert-routing:missing",
        severity: "degradation",
      }),
    ]);
  });

  it("uses the latest evidence for each dimension", () => {
    const result = evaluateSolePlatformReadiness({
      now: NOW,
      evidence: [
        // Keep other dimensions passing; supply two backup-success samples so the
        // evaluator must pick by observedAt rather than array order.
        ...allPassingEvidence().filter((item) => item.dimensionId !== "backup-success"),
        passingEvidence({
          dimensionId: "backup-success",
          status: "passed",
          observedAt: "2026-07-28T14:30:00Z",
        }),
        passingEvidence({
          dimensionId: "backup-success",
          status: "failed",
          observedAt: "2026-07-28T14:59:00Z",
          summary: "latest backup failed",
        }),
      ],
    });

    expect(result.status).toBe("not-ready");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "backup-success:failed",
        summary: "latest backup failed",
      }),
    );
  });

  it("treats stale critical evidence as a blocker", () => {
    const evidence = allPassingEvidence().map((item) =>
      item.dimensionId === "platform-health"
        ? { ...item, observedAt: "2026-07-28T13:00:00Z" }
        : item,
    );

    const result = evaluateSolePlatformReadiness({ evidence, now: NOW });

    expect(result.status).toBe("not-ready");
    expect(result.counts.stale).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "platform-health:stale",
        severity: "blocker",
      }),
    );
  });

  it("does not allow critical evidence to be waived with not-applicable", () => {
    const evidence = allPassingEvidence().map((item) =>
      item.dimensionId === "rollback-readiness"
        ? {
            ...item,
            status: "not-applicable" as const,
            summary: "rollback skipped",
          }
        : item,
    );

    const result = evaluateSolePlatformReadiness({ evidence, now: NOW });

    expect(result.status).toBe("not-ready");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "rollback-readiness:not-applicable",
        severity: "blocker",
      }),
    );
  });

  it("adds externally detected operational blockers to the verdict", () => {
    const result = evaluateSolePlatformReadiness({
      evidence: allPassingEvidence(),
      now: NOW,
      blockers: [
        {
          code: "self-upgrade:run-failed",
          severity: "blocker",
          summary: "The latest governed self-upgrade run failed.",
          nextAction: "Read the failure diagnosis and rerun or roll back before relying on the install.",
          sourceKind: "SelfUpgradeRun",
          sourceId: "SUR-123",
        },
      ],
    });

    expect(result.status).toBe("not-ready");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "self-upgrade:run-failed",
        kind: "open-blocker",
        sourceId: "SUR-123",
      }),
    );
  });
});
