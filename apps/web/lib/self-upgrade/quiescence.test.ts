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
  toolExecutionFindMany: vi.fn(),
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
    toolExecution: {
      findMany: (...args: unknown[]) => prismaMock.toolExecutionFindMany(...args),
    },
  },
}));

import {
  captureActiveSessionBlockers,
  getQuiescenceConfig,
  invalidateQuiescenceCache,
  isTerminalQuiescenceStatus,
  parseQuiescenceConfig,
  phaseBudgetMs,
  pickPrimaryBlocker,
  QuiescingError,
  QUIESCENCE_RUN_STATUSES,
  reconcileTerminalBuildPhaseRuns,
  TERMINAL_QUIESCENCE_STATUSES,
  type ActiveSessionBlockers,
  type SurfaceBlocker,
} from "./quiescence";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.taskRunFindMany.mockResolvedValue([]);
  prismaMock.buildPhaseRunFindMany.mockResolvedValue([]);
  prismaMock.buildPhaseRunUpdateMany.mockResolvedValue({ count: 0 });
  prismaMock.toolExecutionFindMany.mockResolvedValue([]);
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
