import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateSelfAbandonEligibility,
  SELF_ABANDON_MIN_STALE_MS,
} from "./self-abandon-eligibility";

const NOW = new Date("2026-07-24T12:00:00.000Z");

function base(overrides: Partial<Parameters<typeof evaluateSelfAbandonEligibility>[0]> = {}) {
  return {
    callerId: "u1",
    createdById: "u1",
    phase: "build",
    abandonedAt: null as Date | null,
    parentEpicId: null as string | null,
    supersededByEpicId: null as string | null,
    liveTaskRunCount: 0,
    lastActivityAt: new Date(NOW.getTime() - 30 * 60 * 1000), // 30m ago
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h old
    reason: "shipped elsewhere in PR #1981",
    now: NOW,
    ...overrides,
  };
}

describe("evaluateSelfAbandonEligibility", () => {
  it("allows a stalled build owned by the caller with a cited reason", () => {
    expect(evaluateSelfAbandonEligibility(base())).toEqual({ eligible: true });
  });

  it("rejects a missing reason", () => {
    const result = evaluateSelfAbandonEligibility(base({ reason: "" }));
    expect(result).toEqual({ eligible: false, reason: "missing_reason", detail: expect.any(String) });
  });

  it("rejects a whitespace-only reason", () => {
    const result = evaluateSelfAbandonEligibility(base({ reason: "   " }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("missing_reason");
  });

  it("rejects abandoning a build the caller does not own", () => {
    const result = evaluateSelfAbandonEligibility(base({ createdById: "someone-else" }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("not_owner");
  });

  it("rejects an epic-decomposed child build", () => {
    const result = evaluateSelfAbandonEligibility(base({ parentEpicId: "EP-123" }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("epic_child");
  });

  it("rejects an already-terminal build (phase)", () => {
    for (const phase of ["complete", "failed", "abandoned"]) {
      const result = evaluateSelfAbandonEligibility(base({ phase }));
      expect(result.eligible, phase).toBe(false);
      if (!result.eligible) expect(result.reason).toBe("already_terminal");
    }
  });

  it("rejects a build that already has abandonedAt set", () => {
    const result = evaluateSelfAbandonEligibility(base({ abandonedAt: NOW }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("already_terminal");
  });

  it("rejects a build with a live task run — a healthy actively-working build", () => {
    const result = evaluateSelfAbandonEligibility(base({ liveTaskRunCount: 1 }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("live_task_run");
  });

  it("rejects a build that has not been stale long enough", () => {
    const result = evaluateSelfAbandonEligibility(
      base({ lastActivityAt: new Date(NOW.getTime() - 60 * 1000) }), // 1m ago
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("not_stale_enough");
  });

  it("uses createdAt as the staleness reference when there is no activity yet", () => {
    const result = evaluateSelfAbandonEligibility(
      base({ lastActivityAt: null, createdAt: new Date(NOW.getTime() - 60 * 1000) }), // 1m old, never active
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("not_stale_enough");
  });

  it("allows exactly at the staleness threshold boundary", () => {
    const result = evaluateSelfAbandonEligibility(
      base({ lastActivityAt: new Date(NOW.getTime() - SELF_ABANDON_MIN_STALE_MS - 1) }),
    );
    expect(result).toEqual({ eligible: true });
  });

  it("bypasses the staleness window when supersededByEpicId is set, even with fresh activity", () => {
    const result = evaluateSelfAbandonEligibility(
      base({ supersededByEpicId: "EP-999", lastActivityAt: new Date(NOW.getTime() - 1000) }),
    );
    expect(result).toEqual({ eligible: true });
  });

  it("honors a custom minStaleMs override", () => {
    const result = evaluateSelfAbandonEligibility(
      base({ lastActivityAt: new Date(NOW.getTime() - 5 * 60 * 1000), minStaleMs: 60 * 60 * 1000 }),
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe("not_stale_enough");
  });
});

// ─── abandonOwnStalledBuild (DB wrapper) ────────────────────────────────────

const db = vi.hoisted(() => ({
  featureBuildFindUnique: vi.fn(),
  taskRunCount: vi.fn(),
  buildActivityFindFirst: vi.fn(),
  buildActivityCreate: vi.fn(),
  transaction: vi.fn(),
  txFeatureBuildFindUnique: vi.fn(),
  txFeatureBuildUpdate: vi.fn(),
  txBuildActivityCreate: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findUnique: (...a: unknown[]) => db.featureBuildFindUnique(...a) },
    taskRun: { count: (...a: unknown[]) => db.taskRunCount(...a) },
    buildActivity: { findFirst: (...a: unknown[]) => db.buildActivityFindFirst(...a) },
    $transaction: (...a: unknown[]) => db.transaction(...a),
  },
}));

const buildBranch = vi.hoisted(() => ({ abandonBuildBranch: vi.fn(async () => {}) }));
vi.mock("@/lib/integrate/sandbox/build-branch", () => buildBranch);

async function runTx(cb: (tx: unknown) => Promise<boolean>) {
  return cb({
    featureBuild: {
      findUnique: (...a: unknown[]) => db.txFeatureBuildFindUnique(...a),
      update: (...a: unknown[]) => db.txFeatureBuildUpdate(...a),
    },
    buildActivity: {
      create: (...a: unknown[]) => db.txBuildActivityCreate(...a),
    },
  });
}

describe("abandonOwnStalledBuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.transaction.mockImplementation(runTx);
  });

  it("returns not_found for an unknown build", async () => {
    db.featureBuildFindUnique.mockResolvedValue(null);
    const { abandonOwnStalledBuild } = await import("./self-abandon-eligibility");
    const result = await abandonOwnStalledBuild({ buildId: "FB-nope", callerId: "u1", reason: "gone" });
    expect(result).toEqual({ kind: "not_found" });
  });

  it("rejects abandoning someone else's build", async () => {
    db.featureBuildFindUnique.mockResolvedValue({
      buildId: "FB-1", phase: "build", abandonedAt: null, createdById: "other-user",
      parentEpicId: null, supersededByEpicId: null, createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    db.taskRunCount.mockResolvedValue(0);
    db.buildActivityFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 30 * 60 * 1000) });

    const { abandonOwnStalledBuild } = await import("./self-abandon-eligibility");
    const result = await abandonOwnStalledBuild({ buildId: "FB-1", callerId: "u1", reason: "gone", now: NOW });
    expect(result).toEqual({ kind: "ineligible", reason: "not_owner", detail: expect.any(String) });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects abandoning a healthy (fresh-activity) build", async () => {
    db.featureBuildFindUnique.mockResolvedValue({
      buildId: "FB-1", phase: "build", abandonedAt: null, createdById: "u1",
      parentEpicId: null, supersededByEpicId: null, createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    db.taskRunCount.mockResolvedValue(0);
    db.buildActivityFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 60 * 1000) });

    const { abandonOwnStalledBuild } = await import("./self-abandon-eligibility");
    const result = await abandonOwnStalledBuild({ buildId: "FB-1", callerId: "u1", reason: "gone", now: NOW });
    expect(result).toEqual({ kind: "ineligible", reason: "not_stale_enough", detail: expect.any(String) });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects abandoning a build with a live task run", async () => {
    db.featureBuildFindUnique.mockResolvedValue({
      buildId: "FB-1", phase: "build", abandonedAt: null, createdById: "u1",
      parentEpicId: null, supersededByEpicId: null, createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    db.taskRunCount.mockResolvedValue(1);
    db.buildActivityFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 30 * 60 * 1000) });

    const { abandonOwnStalledBuild } = await import("./self-abandon-eligibility");
    const result = await abandonOwnStalledBuild({ buildId: "FB-1", callerId: "u1", reason: "gone", now: NOW });
    expect(result).toEqual({ kind: "ineligible", reason: "live_task_run", detail: expect.any(String) });
  });

  it("writes the audit row and abandons a stalled owned build, then releases the sandbox branch", async () => {
    db.featureBuildFindUnique.mockResolvedValue({
      buildId: "FB-1", phase: "build", abandonedAt: null, createdById: "u1",
      parentEpicId: null, supersededByEpicId: null, createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    db.taskRunCount.mockResolvedValue(0);
    db.buildActivityFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 30 * 60 * 1000) });
    db.txFeatureBuildFindUnique.mockResolvedValue({ phase: "build", abandonedAt: null });
    db.txFeatureBuildUpdate.mockResolvedValue({});
    db.txBuildActivityCreate.mockResolvedValue({});

    const { abandonOwnStalledBuild } = await import("./self-abandon-eligibility");
    const result = await abandonOwnStalledBuild({
      buildId: "FB-1",
      callerId: "u1",
      reason: "shipped elsewhere in PR #1981",
      now: NOW,
    });

    expect(result).toEqual({ kind: "abandoned", buildId: "FB-1" });
    expect(db.txFeatureBuildUpdate).toHaveBeenCalledWith({
      where: { buildId: "FB-1" },
      data: expect.objectContaining({
        phase: "abandoned",
        abandonedAt: NOW,
        abandonReason: expect.stringContaining("shipped elsewhere in PR #1981"),
      }),
    });
    expect(db.txBuildActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildId: "FB-1",
        tool: "abandon_stalled_build",
        summary: expect.stringContaining("shipped elsewhere in PR #1981"),
      }),
    });
    expect(buildBranch.abandonBuildBranch).toHaveBeenCalledWith("FB-1");
  });

  it("does not double-abandon when the row raced to terminal under the transaction", async () => {
    db.featureBuildFindUnique.mockResolvedValue({
      buildId: "FB-1", phase: "build", abandonedAt: null, createdById: "u1",
      parentEpicId: null, supersededByEpicId: null, createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    db.taskRunCount.mockResolvedValue(0);
    db.buildActivityFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 30 * 60 * 1000) });
    // Row already abandoned by a concurrent call by the time the tx reads it.
    db.txFeatureBuildFindUnique.mockResolvedValue({ phase: "abandoned", abandonedAt: NOW });

    const { abandonOwnStalledBuild } = await import("./self-abandon-eligibility");
    const result = await abandonOwnStalledBuild({ buildId: "FB-1", callerId: "u1", reason: "gone", now: NOW });
    expect(result).toEqual({
      kind: "ineligible",
      reason: "already_terminal",
      detail: expect.any(String),
    });
    expect(db.txFeatureBuildUpdate).not.toHaveBeenCalled();
    expect(buildBranch.abandonBuildBranch).not.toHaveBeenCalled();
  });

  it("bypasses staleness for an explicitly superseded build", async () => {
    db.featureBuildFindUnique.mockResolvedValue({
      buildId: "FB-1", phase: "build", abandonedAt: null, createdById: "u1",
      parentEpicId: null, supersededByEpicId: "EP-999", createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    db.taskRunCount.mockResolvedValue(0);
    db.buildActivityFindFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 1000) }); // 1s ago
    db.txFeatureBuildFindUnique.mockResolvedValue({ phase: "build", abandonedAt: null });
    db.txFeatureBuildUpdate.mockResolvedValue({});
    db.txBuildActivityCreate.mockResolvedValue({});

    const { abandonOwnStalledBuild } = await import("./self-abandon-eligibility");
    const result = await abandonOwnStalledBuild({
      buildId: "FB-1",
      callerId: "u1",
      reason: "superseded by FB-2",
      now: NOW,
    });
    expect(result).toEqual({ kind: "abandoned", buildId: "FB-1" });
  });
});
