import { describe, expect, it, vi } from "vitest";

import {
  captureLocalOperationalPosture,
  deriveHealthStatus,
  servedShaFromVersion,
  summarizeRuntimeTargets,
  type OperationalPostureCaptureDb,
} from "./operational-posture-capture";

const version = {
  version: "5.12.0",
  publishedAt: new Date("2026-09-01T00:00:00Z"),
  gitSha: "abc123def456",
  imageVersion: { raw: "abc123def456", source: "git-sha" as const },
  buildDate: null,
  sourceContentHash: "sha256:content",
  note: null,
};

function finding(policySeverity: string, affectedId = "host-1") {
  return {
    findingKey: `patch:${policySeverity}:${Math.random()}`,
    findingKind: "os-patch",
    policySeverity,
    status: "open",
    title: `Finding ${policySeverity}`,
    affectedId,
    vendorIdentifier: null,
    evidence: { installedVersion: "1.0", hostname: "prod-node-7" },
    remediationHint: null,
    lastSeenAt: new Date("2026-09-01T00:00:00Z"),
  };
}

function db(overrides: Partial<{ findings: unknown[]; targets: Array<{ status: string }>; estate: number }> = {}) {
  return {
    assuranceFinding: { findMany: vi.fn().mockResolvedValue(overrides.findings ?? []) },
    runtimeTarget: { findMany: vi.fn().mockResolvedValue(overrides.targets ?? []) },
    inventoryEntity: { count: vi.fn().mockResolvedValue(overrides.estate ?? 0) },
  } as unknown as OperationalPostureCaptureDb;
}

describe("servedShaFromVersion", () => {
  it("prefers the git sha, then the image marker, then the content hash", () => {
    expect(servedShaFromVersion(version)).toBe("abc123def456");
    expect(servedShaFromVersion({ ...version, gitSha: null })).toBe("abc123def456");
    expect(servedShaFromVersion({ ...version, gitSha: null, imageVersion: null })).toBe("sha256:content");
    expect(servedShaFromVersion({ ...version, gitSha: null, imageVersion: null, sourceContentHash: null })).toBe("unknown");
  });
});

describe("summarizeRuntimeTargets", () => {
  it("counts live targets and the serving subset, ignoring retired ones", () => {
    expect(summarizeRuntimeTargets([
      { status: "running" }, { status: "verified" }, { status: "failed" },
      { status: "released" }, { status: "expired" }, { status: "planned" },
    ])).toEqual({ targetCount: 4, healthyCount: 2 });
  });
});

describe("deriveHealthStatus", () => {
  it("is healthy only with no critical findings and every live target serving", () => {
    expect(deriveHealthStatus({ criticalFindings: 0, runtime: { targetCount: 2, healthyCount: 2 } })).toBe("healthy");
    expect(deriveHealthStatus({ criticalFindings: 1, runtime: { targetCount: 2, healthyCount: 2 } })).toBe("degraded");
    expect(deriveHealthStatus({ criticalFindings: 0, runtime: { targetCount: 2, healthyCount: 1 } })).toBe("degraded");
    expect(deriveHealthStatus({ criticalFindings: 0, runtime: { targetCount: 0, healthyCount: 0 } })).toBe("healthy");
  });
});

describe("captureLocalOperationalPosture", () => {
  it("rolls the local substrate up to summary counts only", async () => {
    const now = new Date("2026-09-06T10:00:00Z");
    const source = await captureLocalOperationalPosture(db({
      findings: [finding("critical"), finding("high", "host-2"), finding("high"), finding("low")],
      targets: [{ status: "running" }, { status: "blocked" }],
      estate: 42,
    }), { loadVersion: vi.fn().mockResolvedValue(version), now });

    expect(source).toEqual({
      servedVersion: "5.12.0",
      servedSha: "abc123def456",
      patchPosture: { critical: 1, high: 2, medium: 0, low: 1 },
      health: { status: "degraded", estateItemCount: 42 },
      runtime: { targetCount: 2, healthyCount: 1 },
      capturedAt: now,
      updatedAt: now,
    });
    // Nothing host-identifying from the finding rows reaches the source.
    expect(JSON.stringify(source)).not.toContain("prod-node-7");
    expect(JSON.stringify(source)).not.toContain("host-1");
  });

  it("reads only open patch findings", async () => {
    const store = db();
    await captureLocalOperationalPosture(store, { loadVersion: vi.fn().mockResolvedValue(version) });
    expect(store.assuranceFinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: expect.anything() }),
    }));
  });
});
