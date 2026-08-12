import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  broadcastSystem: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  Prisma: {},
  prisma: {
    selfUpgradeRun: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));
vi.mock("@/lib/self-upgrade/change-record", () => ({ safeSyncSelfUpgradeChangeRecord: vi.fn() }));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { broadcastSystem: mocks.broadcastSystem },
}));

import {
  createRun,
  startRun,
  completeRun,
  recordPromoterReadiness,
  recordRunRecoveryPoint,
  sanitizePromoterReadinessReport,
} from "./run-store";

const report = {
  stage: "preflight" as const, owner: "portal" as const, mode: "enforced" as const,
  result: "failed" as const, targetSha: "candidate", startedAt: "2026-07-18T00:00:00Z",
  completedAt: "2026-07-18T00:00:01Z", quiescenceBegan: false as const,
  failures: [{ code: "state", message: "token=dpfmcp_sensitive", remediation: "password=hunter2 repair state" }],
};

describe("self-upgrade evidence merging", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({}); });

  it("redacts readiness messages and caps failures", () => {
    const sanitized = sanitizePromoterReadinessReport({ ...report, failures: Array.from({ length: 20 }, (_, i) => ({ code: `c${i}`, message: `secret=value-${i}` })) });
    expect(sanitized.failures).toHaveLength(12);
    expect(JSON.stringify(sanitized)).not.toContain("value-");
  });

  it("replaces readiness while preserving recovery, rollback, and future evidence", async () => {
    mocks.findUnique.mockResolvedValue({ completionEvidence: { readiness: { result: "ready", completedAt: "earlier" }, recoveryPoint: { status: "ok" }, rollback: { status: "ok" }, future: 42 } });
    await recordPromoterReadiness("SUR-1", report);
    const evidence = mocks.update.mock.calls[0][0].data.completionEvidence;
    expect(evidence).toMatchObject({ recoveryPoint: { status: "ok" }, rollback: { status: "ok" }, future: 42, readiness: { stage: "preflight", result: "failed", attempts: [{ result: "ready", completedAt: "earlier", failureCodes: [] }] } });
  });

  it("preserves readiness when the recovery point is recorded", async () => {
    mocks.findUnique.mockResolvedValue({ completionEvidence: { readiness: report, rollback: { status: "pending" } } });
    await recordRunRecoveryPoint("SUR-1", { status: "ok" });
    expect(mocks.update.mock.calls[0][0].data.completionEvidence).toMatchObject({ readiness: report, rollback: { status: "pending" }, recoveryPoint: { status: "ok" } });
  });
});

describe("self-upgrade lifecycle invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation(({ data }) => Promise.resolve({ ...data }));
    mocks.update.mockImplementation(({ data, where }) =>
      Promise.resolve({ runId: where.runId, ...data }),
    );
  });

  it("publishes queued, running, and terminal hints after durable writes", async () => {
    const created = await createRun({ runId: "SUR-LIVE" });
    await startRun("SUR-LIVE");
    await completeRun("SUR-LIVE");

    expect(created.status).toBe("queued");
    expect(mocks.broadcastSystem.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ type: "system:self-upgrade", runId: "SUR-LIVE", status: "queued" }),
      expect.objectContaining({ type: "system:self-upgrade", runId: "SUR-LIVE", status: "running" }),
      expect.objectContaining({ type: "system:self-upgrade", runId: "SUR-LIVE", status: "succeeded" }),
    ]);
  });

  it("does not fail a durable transition when notification delivery fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.broadcastSystem.mockImplementation(() => {
      throw new Error("stream consumer failed");
    });

    await expect(startRun("SUR-DURABLE")).resolves.toMatchObject({
      runId: "SUR-DURABLE",
      status: "running",
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
