// BI-EB4BB4A0: the production wiring of the `dispatch-build` effect. The
// executor registered at boot runs the real decision rules over Prisma reads
// and the in-process run registry. It starts the approved-plan run inside
// withOrchestrationRunning, so a second dispatch adopts the run instead of
// doubling it. requestBuildDispatch owes the dispatch only for a build already
// in `build`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  build: vi.fn(),
  room: vi.fn(),
  rooms: vi.fn(),
  user: vi.fn(),
  queryRaw: vi.fn(),
  running: new Set<string>(),
  activities: [] as Array<{ tool: string; summary: string; createdAt: Date }>,
  run: vi.fn(),
}));

vi.mock("@dpf/db", () => {
  const prisma = {
    featureBuild: { findUnique: (...a: unknown[]) => m.build(...a) },
    workroom: { findUnique: (...a: unknown[]) => m.room(...a), findMany: (...a: unknown[]) => m.rooms(...a) },
    user: { findUnique: (...a: unknown[]) => m.user(...a) },
    // Evaluates the run-in-flight query the way Postgres would, over in-memory rows.
    buildActivity: {
      findFirst: async ({ where }: { where: { createdAt: { gte: Date }; OR: Array<{ tool: string | { in: string[] }; summary?: { startsWith: string } }> } }) =>
        m.activities.find((row) => row.createdAt >= where.createdAt.gte && where.OR.some((c) =>
          (typeof c.tool === "string" ? row.tool === c.tool : c.tool.in.includes(row.tool))
          && (!c.summary || row.summary.startsWith(c.summary.startsWith)))) ?? null,
    },
    $queryRaw: (...a: unknown[]) => m.queryRaw(...a),
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/build/build-liveness", () => ({
  isOrchestrationRunning: (id: string) => m.running.has(id),
  withOrchestrationRunning: async (id: string, run: () => Promise<unknown>) => {
    m.running.add(id); // marked synchronously, before the run's first await
    try { return await run(); } finally { m.running.delete(id); }
  },
}));
vi.mock("@/lib/build/build-on-plan-approval", () => ({
  runApprovedBuild: (...a: unknown[]) => m.run(...a),
}));

import { registerBuildDispatchExecutor, requestBuildDispatch } from "./build-dispatch-effect.server";
import { registeredEffectExecutor } from "@/lib/workroom-runtime/effect-executors";
import { RefuseEffectError } from "@/lib/workroom-runtime/effect-worker.server";
import type { ClaimedEffect } from "@/lib/workroom-runtime/workroom-effect-store";

const effect = {
  id: "e1", workCapsuleId: "room-row-1", capsuleId: "WC-1", commandKey: "build-dispatch:FB-1", kind: "dispatch-build",
  processBound: false, sessionGeneration: null, payload: { buildId: "FB-1", userId: "u1" }, attemptCount: 1, maxAttempts: 5,
} as ClaimedEffect;

beforeEach(() => {
  vi.clearAllMocks();
  m.running.clear();
  m.build.mockResolvedValue({ id: "row-1", buildId: "FB-1", phase: "build", buildPlan: { tasks: [{ title: "t" }] }, taskResults: null });
  m.room.mockResolvedValue({ executorKind: "build-studio", executorRef: "FB-1", featureBuildId: "row-1" });
  m.rooms.mockResolvedValue([{ id: "room-row-1", capsuleId: "WC-1" }]);
  m.user.mockResolvedValue({ id: "u1" });
  m.queryRaw.mockResolvedValue([{ id: "e1" }]);
  m.activities.length = 0;
  m.run.mockImplementation(() => new Promise(() => {})); // a long build: still running for the rest of the test
});

describe("registered dispatch-build executor (production deps)", () => {
  it("starts the approved-plan run once, inside the run registry; a second delivery adopts it", async () => {
    await registerBuildDispatchExecutor();
    const executor = registeredEffectExecutor("dispatch-build")!;
    await expect(executor(effect)).resolves.toMatchObject({ outcome: "started" });
    expect(m.run).toHaveBeenCalledWith({ buildId: "FB-1", userId: "u1" });
    expect(m.running.has("FB-1")).toBe(true);
    await expect(executor(effect)).resolves.toMatchObject({ outcome: "adopted", via: "in-process" });
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it("refuses another room's effect and a missing user: the effect fails for good with the reason (AC-3)", async () => {
    await registerBuildDispatchExecutor();
    const executor = registeredEffectExecutor("dispatch-build")!;
    m.room.mockResolvedValueOnce({ executorKind: "build-studio", executorRef: "FB-2", featureBuildId: "row-2" });
    await expect(executor(effect)).rejects.toThrow(new RefuseEffectError("Build dispatch refused: this room does not carry FB-1."));
    m.user.mockResolvedValueOnce(null);
    await expect(executor(effect)).rejects.toBeInstanceOf(RefuseEffectError);
    expect(m.run).not.toHaveBeenCalled();
  });

  // Independent review, critical: the transition writes phase:advance and its own
  // build_dispatch row seconds before this effect runs. Counting those as a live
  // run "adopted" a run that never existed, and no orchestrator started.
  it("starts the run although the transition and gates just wrote activity: only a run's own progress counts", async () => {
    const now = new Date();
    m.activities.push(
      { tool: "phase:advance", summary: "Phase advanced: plan → build (buildBranch initialized)", createdAt: now },
      { tool: "build_dispatch", summary: "Build dispatch committed on Workroom WC-1.", createdAt: now },
      { tool: "phase:gate-blocked", summary: "plan → build transition failed (attempt 1): sandbox not running", createdAt: now },
      { tool: "reviewBuildPlan", summary: "Plan review passed", createdAt: now },
    );
    await registerBuildDispatchExecutor();
    await expect(registeredEffectExecutor("dispatch-build")!(effect)).resolves.toMatchObject({ outcome: "started" });
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it("adopts a run that wrote its own progress recently, on any process; an old one does not count", async () => {
    await registerBuildDispatchExecutor();
    const executor = registeredEffectExecutor("dispatch-build")!;
    m.activities.push({ tool: "specialist_dispatch", summary: "Started task \"t\" (Software Engineer).", createdAt: new Date(Date.now() - 20 * 60_000) });
    await expect(executor(effect)).resolves.toMatchObject({ outcome: "started" });
    m.running.clear();
    m.run.mockClear();
    for (const row of [
      { tool: "build_dispatch", summary: "Dispatching build orchestrator: 1 tasks, parentThread=T1", createdAt: new Date() },
      { tool: "engine_selection", summary: "selected codex", createdAt: new Date() },
      { tool: "specialist_dispatch", summary: "Started task \"t\" (Software Engineer).", createdAt: new Date() },
    ]) {
      m.activities.length = 0;
      m.activities.push(row);
      await expect(executor(effect)).resolves.toMatchObject({ outcome: "adopted", via: "run-activity" });
    }
    expect(m.run).not.toHaveBeenCalled();
  });
});

describe("requestBuildDispatch (admin test route)", () => {
  it("owes the dispatch on the build's own room under the deterministic key", async () => {
    await expect(requestBuildDispatch({ buildId: "FB-1", userId: "u1" })).resolves.toEqual({ kind: "owed", capsuleId: "WC-1" });
    const values = m.queryRaw.mock.calls[0]!.slice(1);
    expect(values[1]).toBe("room-row-1");
    expect(values[2]).toBe("build-dispatch:FB-1");
    expect(values[4]).toBe("dispatch-build");
  });

  it("refuses a build still in plan: only the gated transition moves the phase", async () => {
    m.build.mockResolvedValueOnce({ id: "row-1", buildId: "FB-1", phase: "plan" });
    await expect(requestBuildDispatch({ buildId: "FB-1", userId: "u1" })).resolves.toMatchObject({ kind: "refused", reason: expect.stringContaining("plan→build transition") });
    expect(m.queryRaw).not.toHaveBeenCalled();
  });

  it("refuses with no carrier room and owes nothing", async () => {
    m.rooms.mockResolvedValueOnce([]);
    await expect(requestBuildDispatch({ buildId: "FB-1", userId: "u1" })).resolves.toMatchObject({ kind: "refused" });
    expect(m.queryRaw).not.toHaveBeenCalled();
  });
});
