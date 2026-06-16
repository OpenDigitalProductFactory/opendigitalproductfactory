/**
 * Unit tests for Activity Quiescence Protocol caller API (BI-QUIESCE-002).
 *
 * Covers the pure helpers + JSON parsing + status/level taxonomy + the
 * QuiescingError shape consumed by BI-QUIESCE-005 entry-point gates. The
 * DB-touching functions (transitionState, captureActiveSessionBlockers,
 * startQuiescence, flipActiveTaskRunsToQuiescing) need integration tests
 * with a real Postgres + Prisma; those are tracked separately under
 * BI-QUIESCE-002 follow-up integration work.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  taskRunFindMany: vi.fn(),
  buildPhaseRunFindMany: vi.fn(),
  buildPhaseRunUpdateMany: vi.fn(),
  executeRaw: vi.fn(),
  toolExecutionFindMany: vi.fn(),
  quiescenceRunFindUnique: vi.fn(),
  quiescenceRunUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findMany: (...args: unknown[]) => prismaMock.taskRunFindMany(...args),
    },
    buildPhaseRun: {
      findMany: (...args: unknown[]) => prismaMock.buildPhaseRunFindMany(...args),
      updateMany: (...args: unknown[]) => prismaMock.buildPhaseRunUpdateMany(...args),
    },
    $executeRaw: (...args: unknown[]) => prismaMock.executeRaw(...args),
    toolExecution: {
      findMany: (...args: unknown[]) => prismaMock.toolExecutionFindMany(...args),
    },
    quiescenceRun: {
      findUnique: (...args: unknown[]) => prismaMock.quiescenceRunFindUnique(...args),
      update: (...args: unknown[]) => prismaMock.quiescenceRunUpdate(...args),
    },
  },
}));

const inngestSendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: (...args: unknown[]) => inngestSendMock(...args) },
}));

import {
  captureActiveSessionBlockers,
  escalateQuiescenceToForced,
  isBuildPhaseReapable,
  isShipForceEscalated,
  getQuiescenceConfig,
  invalidateQuiescenceCache,
  isTerminalQuiescenceStatus,
  parseQuiescenceConfig,
  phaseBudgetMs,
  pickPrimaryBlocker,
  QuiescingError,
  QUIESCENCE_RUN_STATUSES,
  reconcileTerminalBuildPhaseRuns,
  signalSwapComplete,
  TERMINAL_QUIESCENCE_STATUSES,
  type ActiveSessionBlockers,
  type SurfaceBlocker,
} from "./quiescence";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.taskRunFindMany.mockResolvedValue([]);
  prismaMock.buildPhaseRunFindMany.mockResolvedValue([]);
  prismaMock.buildPhaseRunUpdateMany.mockResolvedValue({ count: 0 });
  prismaMock.executeRaw.mockResolvedValue(0);
  prismaMock.toolExecutionFindMany.mockResolvedValue([]);
  prismaMock.quiescenceRunFindUnique.mockResolvedValue(null);
  prismaMock.quiescenceRunUpdate.mockResolvedValue({});
});

describe("escalateQuiescenceToForced (BI-4F3B2FA9)", () => {
  const NOW = new Date("2026-06-10T02:00:00.000Z");

  it("sets shipForceEscalatedAt/By and appends a mid-flight-escalation audit entry", async () => {
    prismaMock.quiescenceRunFindUnique.mockResolvedValue({
      status: "draining",
      shipForceEscalatedAt: null,
      forcedSurfaces: [],
    });
    const r = await escalateQuiescenceToForced("QR-1", "user-9", NOW);
    expect(r).toEqual({ ok: true });
    const update = prismaMock.quiescenceRunUpdate.mock.calls[0]?.[0];
    expect(update.where).toEqual({ runId: "QR-1" });
    expect(update.data.shipForceEscalatedAt).toBe(NOW);
    expect(update.data.shipForceEscalatedBy).toBe("user-9");
    expect(update.data.forcedSurfaces).toEqual([
      { surface: "mid-flight-escalation", reason: expect.stringContaining("user-9"), forcedAt: NOW.toISOString() },
    ]);
  });

  it("preserves prior forcedSurfaces entries when appending", async () => {
    prismaMock.quiescenceRunFindUnique.mockResolvedValue({
      status: "draining",
      shipForceEscalatedAt: null,
      forcedSurfaces: [{ surface: "ship-force-flag", reason: "x", forcedAt: "t" }],
    });
    await escalateQuiescenceToForced("QR-1", "user-9", NOW);
    const update = prismaMock.quiescenceRunUpdate.mock.calls[0]?.[0];
    expect(update.data.forcedSurfaces).toHaveLength(2);
    expect(update.data.forcedSurfaces[0].surface).toBe("ship-force-flag");
  });

  it("is idempotent — a no-op success when already escalated", async () => {
    prismaMock.quiescenceRunFindUnique.mockResolvedValue({
      status: "draining",
      shipForceEscalatedAt: new Date(),
      forcedSurfaces: [],
    });
    const r = await escalateQuiescenceToForced("QR-1", "user-9", NOW);
    expect(r).toEqual({ ok: true });
    expect(prismaMock.quiescenceRunUpdate).not.toHaveBeenCalled();
  });

  it("refuses a terminal run", async () => {
    prismaMock.quiescenceRunFindUnique.mockResolvedValue({
      status: "completed",
      shipForceEscalatedAt: null,
      forcedSurfaces: [],
    });
    const r = await escalateQuiescenceToForced("QR-1", "user-9", NOW);
    expect(r).toEqual({ ok: false, reason: "run already completed" });
    expect(prismaMock.quiescenceRunUpdate).not.toHaveBeenCalled();
  });

  it("returns not-found when the run is missing", async () => {
    prismaMock.quiescenceRunFindUnique.mockResolvedValue(null);
    const r = await escalateQuiescenceToForced("QR-missing", "user-9", NOW);
    expect(r).toEqual({ ok: false, reason: "run not found" });
  });
});

describe("isShipForceEscalated (BI-4F3B2FA9)", () => {
  it("is true when shipForceEscalatedAt is set, false otherwise", async () => {
    prismaMock.quiescenceRunFindUnique.mockResolvedValueOnce({ shipForceEscalatedAt: new Date() });
    expect(await isShipForceEscalated("QR-1")).toBe(true);
    prismaMock.quiescenceRunFindUnique.mockResolvedValueOnce({ shipForceEscalatedAt: null });
    expect(await isShipForceEscalated("QR-1")).toBe(false);
    prismaMock.quiescenceRunFindUnique.mockResolvedValueOnce(null);
    expect(await isShipForceEscalated("QR-missing")).toBe(false);
  });
});

describe("isBuildPhaseReapable", () => {
  const now = new Date("2026-06-09T12:00:00Z");
  const old = new Date(now.getTime() - 20 * 60 * 1000); // 20 min ago
  const recent = new Date(now.getTime() - 2 * 60 * 1000); // 2 min ago
  const thresholdMs = 15 * 60 * 1000;

  it("reaps a phase with no heartbeat and an old start (a corpse)", () => {
    expect(isBuildPhaseReapable({ phaseStartedAt: old, buildLastHeartbeatAt: null, now, thresholdMs })).toBe(true);
  });

  it("does NOT reap when the build has a recent heartbeat (live work)", () => {
    expect(isBuildPhaseReapable({ phaseStartedAt: old, buildLastHeartbeatAt: recent, now, thresholdMs })).toBe(false);
  });

  it("does NOT reap a freshly-started phase even without a heartbeat", () => {
    expect(isBuildPhaseReapable({ phaseStartedAt: recent, buildLastHeartbeatAt: null, now, thresholdMs })).toBe(false);
  });

  it("reaps when both the start and the last heartbeat are older than the threshold", () => {
    const olderHeartbeat = new Date(now.getTime() - 30 * 60 * 1000);
    expect(isBuildPhaseReapable({ phaseStartedAt: old, buildLastHeartbeatAt: olderHeartbeat, now, thresholdMs })).toBe(true);
  });
});

describe("parseQuiescenceConfig", () => {
  it("returns default config on null", () => {
    const c = parseQuiescenceConfig(null);
    expect(c.level).toBe("normal");
    expect(c.runId).toBeNull();
  });

  it("returns default config on non-object", () => {
    const c = parseQuiescenceConfig("not-an-object");
    expect(c.level).toBe("normal");
  });

  it("parses a valid draining config", () => {
    const c = parseQuiescenceConfig({
      level: "draining",
      runId: "QR-2026-05-24-abc12345",
      enteredAt: "2026-05-24T18:30:00.000Z",
    });
    expect(c.level).toBe("draining");
    expect(c.runId).toBe("QR-2026-05-24-abc12345");
    expect(c.enteredAt).toBe("2026-05-24T18:30:00.000Z");
  });

  it("parses a valid swapping config", () => {
    expect(parseQuiescenceConfig({ level: "swapping" }).level).toBe("swapping");
  });

  it("clamps unknown level values to 'normal' (defensive)", () => {
    expect(parseQuiescenceConfig({ level: "panic" }).level).toBe("normal");
  });

  it("treats missing runId as null", () => {
    expect(parseQuiescenceConfig({ level: "draining" }).runId).toBeNull();
  });
});

describe("getQuiescenceConfig", () => {
  it("returns the default normal state when PlatformConfig is absent from a narrow Prisma mock", async () => {
    invalidateQuiescenceCache();

    await expect(getQuiescenceConfig(new Date("2026-05-24T18:30:00.000Z"))).resolves.toEqual({
      level: "normal",
      runId: null,
      enteredAt: "1970-01-01T00:00:00.000Z",
    });
  });
});

describe("isTerminalQuiescenceStatus + TERMINAL_QUIESCENCE_STATUSES", () => {
  it("returns true for the four terminal statuses (spec §5.2)", () => {
    expect(isTerminalQuiescenceStatus("completed")).toBe(true);
    expect(isTerminalQuiescenceStatus("deferred")).toBe(true);
    expect(isTerminalQuiescenceStatus("aborted")).toBe(true);
    expect(isTerminalQuiescenceStatus("failed")).toBe(true);
  });

  it("returns false for in-flight statuses", () => {
    expect(isTerminalQuiescenceStatus("pending")).toBe(false);
    expect(isTerminalQuiescenceStatus("preparing")).toBe(false);
    expect(isTerminalQuiescenceStatus("draining")).toBe(false);
    expect(isTerminalQuiescenceStatus("ready-to-swap")).toBe(false);
    expect(isTerminalQuiescenceStatus("swapping")).toBe(false);
  });

  it("returns false for unknown statuses (defensive)", () => {
    expect(isTerminalQuiescenceStatus("garbage")).toBe(false);
  });

  it("TERMINAL_QUIESCENCE_STATUSES is a subset of QUIESCENCE_RUN_STATUSES", () => {
    for (const status of TERMINAL_QUIESCENCE_STATUSES) {
      expect(QUIESCENCE_RUN_STATUSES).toContain(status);
    }
  });

  it("QUIESCENCE_RUN_STATUSES contains exactly the 9 spec values", () => {
    // Locked because the coordinator state machine, the watchdog, and the
    // operator UI all depend on this exact set.
    expect(QUIESCENCE_RUN_STATUSES).toHaveLength(9);
    expect(QUIESCENCE_RUN_STATUSES).toEqual([
      "pending",
      "preparing",
      "draining",
      "ready-to-swap",
      "swapping",
      "completed",
      "deferred",
      "aborted",
      "failed",
    ]);
  });
});

describe("phaseBudgetMs", () => {
  it("returns 5min for ideate/plan/review", () => {
    expect(phaseBudgetMs("ideate")).toBe(5 * 60 * 1000);
    expect(phaseBudgetMs("plan")).toBe(5 * 60 * 1000);
    expect(phaseBudgetMs("review")).toBe(5 * 60 * 1000);
  });

  it("returns 30min for build (spec §6.5)", () => {
    expect(phaseBudgetMs("build")).toBe(30 * 60 * 1000);
  });

  it("returns Infinity for ship — never force-cancel default", () => {
    expect(phaseBudgetMs("ship")).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns 5min default for unknown phase (defensive)", () => {
    expect(phaseBudgetMs("garbage")).toBe(5 * 60 * 1000);
  });
});

describe("reconcileTerminalBuildPhaseRuns", () => {
  it("closes open phase runs whose parent build is terminal or abandoned", async () => {
    const now = new Date("2026-05-31T19:30:00.000Z");
    prismaMock.buildPhaseRunUpdateMany.mockResolvedValueOnce({ count: 3 });

    // count = terminal/abandoned updateMany (3) + advanced-past correlated UPDATE (0).
    await expect(reconcileTerminalBuildPhaseRuns(now)).resolves.toBe(3);

    expect(prismaMock.buildPhaseRunUpdateMany).toHaveBeenCalledWith({
      where: {
        completedAt: null,
        build: {
          OR: [
            { phase: { in: ["complete", "failed", "abandoned"] } },
            { abandonedAt: { not: null } },
          ],
        },
      },
      data: { completedAt: now },
    });
  });

  it("also closes runs the build advanced past (phase ≠ build.phase) and sums both", async () => {
    const now = new Date("2026-06-16T01:30:00.000Z");
    prismaMock.buildPhaseRunUpdateMany.mockResolvedValueOnce({ count: 1 });
    // The correlated UPDATE closed 2 advance-orphans (e.g. a "build" run whose
    // build had moved on to "review") — the live blocker class from 2026-06-16.
    prismaMock.executeRaw.mockResolvedValueOnce(2);

    await expect(reconcileTerminalBuildPhaseRuns(now)).resolves.toBe(3);

    // The advance-past close runs as a correlated UPDATE, threading `now`.
    expect(prismaMock.executeRaw).toHaveBeenCalledOnce();
    expect(prismaMock.executeRaw.mock.calls[0]).toContain(now);
  });
});

describe("captureActiveSessionBlockers", () => {
  it("repairs terminal build phase rows and only queries non-terminal parent builds as blockers", async () => {
    const now = new Date("2026-05-31T19:30:00.000Z");

    const snapshot = await captureActiveSessionBlockers({ now, thresholdMs: 300_000 });

    expect(snapshot.hardBlockers).toBe(0);
    expect(prismaMock.buildPhaseRunUpdateMany).toHaveBeenCalledOnce();
    expect(prismaMock.buildPhaseRunFindMany).toHaveBeenCalledWith({
      where: {
        completedAt: null,
        build: {
          phase: { notIn: ["complete", "failed", "abandoned"] },
          abandonedAt: null,
        },
      },
      select: { buildId: true, phase: true, startedAt: true },
      take: 25,
    });
  });

  it("reaps AND closes a dead build phase (corpse: no active TaskRun, old start)", async () => {
    // The live FB-69231490 shape: a "build" phase open for an hour with zero
    // active TaskRuns. It must not be reported as in-flight, and the row must be
    // closed so it never re-trips the next capture.
    const now = new Date("2026-06-16T12:00:00.000Z");
    const old = new Date(now.getTime() - 60 * 60 * 1000); // 1h ago
    prismaMock.buildPhaseRunFindMany.mockResolvedValue([
      { buildId: "FB-69231490", phase: "build", startedAt: old },
    ]);
    prismaMock.taskRunFindMany.mockResolvedValue([]); // no live work

    const snapshot = await captureActiveSessionBlockers({ now });

    expect(snapshot.surfaces.find((s) => s.surface === "build-studio.phase.build")).toBeUndefined();
    expect(snapshot.hardBlockers).toBe(0);
    // 1st updateMany = reconcileTerminalBuildPhaseRuns; 2nd = the corpse close.
    expect(prismaMock.buildPhaseRunUpdateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.buildPhaseRunUpdateMany).toHaveBeenLastCalledWith({
      where: { completedAt: null, OR: [{ buildId: "FB-69231490", phase: "build" }] },
      data: { completedAt: now },
    });
  });

  it("keeps a live build phase as a blocker and does NOT close it", async () => {
    const now = new Date("2026-06-16T12:00:00.000Z");
    const old = new Date(now.getTime() - 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 60 * 1000); // heartbeat 1 min ago
    prismaMock.buildPhaseRunFindMany.mockResolvedValue([
      { buildId: "FB-LIVE", phase: "build", startedAt: old },
    ]);
    prismaMock.taskRunFindMany.mockResolvedValue([
      {
        taskRunId: "tr-live",
        title: "building",
        buildId: "FB-LIVE",
        status: "working",
        lastHeartbeatAt: recent,
        startedAt: old,
      },
    ]);

    const snapshot = await captureActiveSessionBlockers({ now });

    expect(snapshot.surfaces.some((s) => s.surface === "build-studio.phase.build")).toBe(true);
    // Only the reconcile updateMany — no corpse close for a live phase.
    expect(prismaMock.buildPhaseRunUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("does NOT reap a freshly-started build phase even with no active TaskRun yet (startup race)", async () => {
    const now = new Date("2026-06-16T12:00:00.000Z");
    const recentStart = new Date(now.getTime() - 2 * 60 * 1000); // started 2 min ago
    prismaMock.buildPhaseRunFindMany.mockResolvedValue([
      { buildId: "FB-NEW", phase: "build", startedAt: recentStart },
    ]);
    prismaMock.taskRunFindMany.mockResolvedValue([]); // TaskRun not working/active yet

    const snapshot = await captureActiveSessionBlockers({ now });

    expect(snapshot.surfaces.some((s) => s.surface === "build-studio.phase.build")).toBe(true);
    expect(prismaMock.buildPhaseRunUpdateMany).toHaveBeenCalledTimes(1); // no corpse close
  });
});

describe("pickPrimaryBlocker", () => {
  const buildSnapshot = (surfaces: SurfaceBlocker[]): ActiveSessionBlockers => ({
    capturedAt: "2026-05-24T18:30:00.000Z",
    thresholdMs: 300_000,
    totalBlockers: surfaces.length,
    hardBlockers: surfaces.filter((s) => s.kind === "hard").length,
    softBlockers: surfaces.filter((s) => s.kind === "soft").length,
    unobservableSurfaces: [],
    surfaces,
  });

  const surface = (name: string, kind: "hard" | "soft" = "hard"): SurfaceBlocker => ({
    surface: name,
    detectionClass: "A",
    kind,
    blockerSignal: { class: "A", model: "Test", rowId: "1", status: "in-flight" },
    estimatedWaitMs: 1000,
    evidence: {},
  });

  it("returns null on null snapshot", () => {
    expect(pickPrimaryBlocker(null)).toBeNull();
  });

  it("returns null on empty surfaces", () => {
    expect(pickPrimaryBlocker(buildSnapshot([]))).toBeNull();
  });

  it("prefers ship-phase over other build phases", () => {
    const s = buildSnapshot([
      surface("build-studio.phase.build"),
      surface("build-studio.phase.ship"),
      surface("coworker.reasoning-loop"),
    ]);
    expect(pickPrimaryBlocker(s)).toBe("build-studio.phase.ship");
  });

  it("prefers build phases over coworker loops", () => {
    const s = buildSnapshot([
      surface("coworker.reasoning-loop"),
      surface("build-studio.phase.plan"),
    ]);
    expect(pickPrimaryBlocker(s)).toBe("build-studio.phase.plan");
  });

  it("prefers coworker loops over other surfaces", () => {
    const s = buildSnapshot([
      surface("request.recent-tool-execution", "soft"),
      surface("coworker.reasoning-loop"),
    ]);
    expect(pickPrimaryBlocker(s)).toBe("coworker.reasoning-loop");
  });

  it("falls back to first surface when no priority matches", () => {
    const s = buildSnapshot([
      surface("request.recent-tool-execution", "soft"),
      surface("custom.other", "soft"),
    ]);
    expect(pickPrimaryBlocker(s)).toBe("request.recent-tool-execution");
  });
});

describe("QuiescingError", () => {
  it("carries the expected code", () => {
    const e = new QuiescingError("draining");
    expect(e.code).toBe("PORTAL_QUIESCING");
    expect(e.name).toBe("QuiescingError");
  });

  it("captures the level the caller observed", () => {
    expect(new QuiescingError("draining").level).toBe("draining");
    expect(new QuiescingError("swapping").level).toBe("swapping");
  });

  it("defaults retryAfterSeconds to 30 (matches 503 Retry-After in middleware)", () => {
    expect(new QuiescingError("draining").retryAfterSeconds).toBe(30);
  });

  it("allows custom retryAfterSeconds for surface-specific guidance", () => {
    expect(new QuiescingError("swapping", 120).retryAfterSeconds).toBe(120);
  });

  it("is an Error instance (catches via instanceof Error)", () => {
    expect(new QuiescingError("draining")).toBeInstanceOf(Error);
  });
});

describe("signalSwapComplete — swap-signal retry", () => {
  it("retries the swap-complete event on a transient inngest.send failure", async () => {
    vi.useFakeTimers();
    try {
      inngestSendMock
        .mockRejectedValueOnce(new Error("blip"))
        .mockResolvedValueOnce(undefined);
      const p = signalSwapComplete("QR-1");
      await vi.advanceTimersByTimeAsync(500); // let the backoff elapse
      await p;
      expect(inngestSendMock).toHaveBeenCalledTimes(2);
      expect(inngestSendMock).toHaveBeenLastCalledWith({
        name: "ops/quiescence.swap-complete",
        data: { runId: "QR-1", outcome: "succeeded" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rethrows after exhausting retries so the caller's failure handling runs", async () => {
    vi.useFakeTimers();
    try {
      inngestSendMock.mockRejectedValue(new Error("inngest down"));
      const p = signalSwapComplete("QR-1");
      const assertion = expect(p).rejects.toThrow("inngest down");
      await vi.advanceTimersByTimeAsync(1500); // both backoffs (500 + 1000)
      await assertion;
      expect(inngestSendMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
