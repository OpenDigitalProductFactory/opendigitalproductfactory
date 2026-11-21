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
  recent: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@dpf/db", () => {
  const prisma = {
    featureBuild: { findUnique: (...a: unknown[]) => m.build(...a) },
    workroom: { findUnique: (...a: unknown[]) => m.room(...a), findMany: (...a: unknown[]) => m.rooms(...a) },
    user: { findUnique: (...a: unknown[]) => m.user(...a) },
    $queryRaw: (...a: unknown[]) => m.queryRaw(...a),
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/build/build-liveness", () => ({
  isOrchestrationRunning: (id: string) => m.running.has(id),
  recentlyActiveBuildIds: async (_db: unknown, ids: string[]) => new Set((await m.recent(ids)) ? ids : []),
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
  m.recent.mockResolvedValue(false);
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

  it("refuses another room's effect and a missing user against the real reads", async () => {
    await registerBuildDispatchExecutor();
    const executor = registeredEffectExecutor("dispatch-build")!;
    m.room.mockResolvedValueOnce({ executorKind: "build-studio", executorRef: "FB-2", featureBuildId: "row-2" });
    await expect(executor(effect)).resolves.toMatchObject({ outcome: "refused" });
    m.user.mockResolvedValueOnce(null);
    await expect(executor(effect)).resolves.toMatchObject({ outcome: "refused" });
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
