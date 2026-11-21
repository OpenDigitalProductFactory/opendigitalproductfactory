// BI-EB4BB4A0: the `dispatch-build` Workroom effect, which carries Build
// Studio's approved-plan dispatch on the absorbed T3 core. These tests prove,
// against its injected dependencies:
// - single dispatch;
// - idempotent recovery of a run already in flight (including a legacy
//   fire-and-forget run started before this change);
// - authority;
// - readback through the room log.
// The transition side (one commit, absence, rollback) is in
// plan-to-build-transition.test.ts.
import { describe, expect, it, vi } from "vitest";

import {
  allPlannedTasksDone,
  buildDispatchCommandId,
  executeBuildDispatchEffect,
  findBuildDispatchRoom,
  type BuildDispatchExecutorDeps,
} from "./build-dispatch-effect";
import { decideRuntimeCommand, isProcessBound, EFFECT_KINDS } from "@/lib/workroom-runtime/runtime-decider";

const ROOM = { executorKind: "build-studio", executorRef: "FB-1", featureBuildId: "row-1" };
const BUILD = { id: "row-1", phase: "build", buildPlan: { tasks: [{ title: "t1" }] }, taskResults: null };
const effect = (payload: Record<string, unknown> = { buildId: "FB-1", userId: "u1" }) => ({ workCapsuleId: "room-row-1", payload });

function deps(over: Partial<BuildDispatchExecutorDeps> = {}) {
  const startRun = vi.fn();
  const d: BuildDispatchExecutorDeps = {
    readBuild: async () => BUILD,
    readRoom: async () => ROOM,
    userExists: async () => true,
    isRunning: () => false,
    runInFlight: async () => false,
    startRun,
    ...over,
  };
  return { d, startRun: d.startRun as ReturnType<typeof vi.fn> };
}

describe("dispatch-build effect: single dispatch", () => {
  it("starts the run exactly once for a build in build with no run in flight", async () => {
    const { d, startRun } = deps();
    const out = await executeBuildDispatchEffect(effect(), d);
    expect(out).toEqual({ outcome: "started", summary: "Dispatched build FB-1 to the build orchestrator." });
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith({ buildId: "FB-1", userId: "u1" });
  });

  it("a second delivery of the same effect (lease expired, worker retried) adopts the run the first one started", async () => {
    const running = new Set<string>();
    const { d, startRun } = deps({
      isRunning: (id) => running.has(id),
      startRun: vi.fn(({ buildId }: { buildId: string }) => { running.add(buildId); }),
    });
    const first = await executeBuildDispatchEffect(effect(), d);
    const second = await executeBuildDispatchEffect(effect(), d);
    expect([first.outcome, second.outcome]).toEqual(["started", "adopted"]);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("one dispatch key per build, so a replayed transition owes nothing twice", () => {
    expect(buildDispatchCommandId("FB-1")).toBe("build-dispatch:FB-1");
    expect(buildDispatchCommandId("FB-1")).toBe(buildDispatchCommandId("FB-1"));
  });

  it("is a non-process-bound outbox kind, so it survives a portal restart and is not retired at boot", () => {
    expect(EFFECT_KINDS).toContain("dispatch-build");
    expect(isProcessBound("dispatch-build")).toBe(false);
  });
});

describe("dispatch-build effect: idempotent recovery of in-flight legacy runs", () => {
  it("adopts a run live in this process (e.g. a pre-cutover fire-and-forget dispatch) instead of doubling it", async () => {
    const { d, startRun } = deps({ isRunning: () => true });
    const out = await executeBuildDispatchEffect(effect(), d);
    expect(out).toMatchObject({ outcome: "adopted", via: "in-process" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("adopts a run that recorded its own progress recently on any process (a pre-cutover dispatch, another portal)", async () => {
    const { d, startRun } = deps({ runInFlight: async () => true });
    const out = await executeBuildDispatchEffect(effect(), d);
    expect(out).toMatchObject({ outcome: "adopted", via: "run-activity" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("does nothing for a build whose planned tasks all finished", async () => {
    const { d, startRun } = deps({
      readBuild: async () => ({ ...BUILD, taskResults: { tasks: [{ title: "t1", outcome: "DONE" }] } }),
    });
    expect((await executeBuildDispatchEffect(effect(), d)).outcome).toBe("skipped");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("does nothing for a build that has left build (reviewed, abandoned, rolled back)", async () => {
    for (const phase of ["review", "abandoned", "plan"]) {
      const { d, startRun } = deps({ readBuild: async () => ({ ...BUILD, phase }) });
      const out = await executeBuildDispatchEffect(effect(), d);
      expect(out).toMatchObject({ outcome: "skipped", summary: expect.stringContaining(`in ${phase}`) });
      expect(startRun).not.toHaveBeenCalled();
    }
  });

  it("reads completion from `outcome`, as StoredTaskResult carries it; `status` alone never counts", () => {
    const plan = { tasks: [{ title: "a" }, { title: "b" }] };
    expect(allPlannedTasksDone(plan, { tasks: [{ title: "a", outcome: "DONE" }, { title: "b", outcome: "DONE_WITH_CONCERNS" }] })).toBe(true);
    expect(allPlannedTasksDone(plan, { tasks: [{ title: "a", outcome: "DONE" }] })).toBe(false);
    expect(allPlannedTasksDone(plan, { tasks: [{ title: "a", status: "DONE" }, { title: "b", status: "DONE" }] })).toBe(false);
    expect(allPlannedTasksDone(plan, { tasks: [{ title: "a", outcome: "BLOCKED" }, { title: "b", outcome: "DONE" }] })).toBe(false);
    expect(allPlannedTasksDone({ tasks: [] }, { tasks: [] })).toBe(false);
  });
});

describe("dispatch-build effect: authority", () => {
  it("refuses a room that is not the build's own Build Studio room, and starts nothing", async () => {
    const others = [
      { ...ROOM, executorKind: "codex-desktop" },
      { ...ROOM, executorRef: "FB-OTHER" },
      { ...ROOM, featureBuildId: "row-other" },
      null,
    ];
    for (const room of others) {
      const { d, startRun } = deps({ readRoom: async () => room });
      const out = await executeBuildDispatchEffect(effect(), d);
      expect(out).toEqual({ outcome: "refused", summary: "Build dispatch refused: this room does not carry FB-1." });
      expect(startRun).not.toHaveBeenCalled();
    }
  });

  it("refuses when the dispatching user no longer exists (the run would act with no access context)", async () => {
    const { d, startRun } = deps({ userExists: async () => false });
    const out = await executeBuildDispatchEffect(effect(), d);
    expect(out).toMatchObject({ outcome: "refused", summary: expect.stringContaining("dispatching user no longer exists") });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a malformed effect or a missing build", async () => {
    const malformed = deps();
    expect((await executeBuildDispatchEffect(effect({ buildId: "FB-1" }), malformed.d)).outcome).toBe("refused");
    const missing = deps({ readBuild: async () => null });
    expect((await executeBuildDispatchEffect(effect(), missing.d)).outcome).toBe("refused");
    expect(malformed.startRun).not.toHaveBeenCalled();
    expect(missing.startRun).not.toHaveBeenCalled();
  });

  it("carrier lookup accepts exactly one live Build Studio room of this build, never a guess between two", async () => {
    const findMany = vi.fn();
    const db = { workroom: { findMany } };
    findMany.mockResolvedValueOnce([{ id: "r1", capsuleId: "WC-1" }]);
    await expect(findBuildDispatchRoom(db, { id: "row-1", buildId: "FB-1" })).resolves.toEqual({ id: "r1", capsuleId: "WC-1" });
    findMany.mockResolvedValueOnce([{ id: "r1", capsuleId: "WC-1" }, { id: "r2", capsuleId: "WC-2" }]);
    await expect(findBuildDispatchRoom(db, { id: "row-1", buildId: "FB-1" })).resolves.toBeNull();
    findMany.mockResolvedValueOnce([]);
    await expect(findBuildDispatchRoom(db, { id: "row-1", buildId: "FB-1" })).resolves.toBeNull();
    expect(findMany.mock.calls[0]![0].where).toEqual({
      executorKind: "build-studio", executorRef: "FB-1", featureBuildId: "row-1", archivedAt: null,
      status: { notIn: ["complete", "abandoned", "archived", "superseded"] },
    });
  });
});

describe("dispatch-build effect: readback through the room log", () => {
  const settled = (result: Record<string, unknown>) => decideRuntimeCommand({ session: null }, "effect-result:e1:1", {
    type: "effect.settled", effectId: "e1", attempt: 1, kind: "dispatch-build", payload: { buildId: "FB-1", userId: "u1" },
    outcome: "succeeded", final: true, result,
  });

  it("a started or adopted dispatch is written to the room as an action, and the effect settles succeeded", () => {
    const decision = settled({ outcome: "started", summary: "Dispatched build FB-1 to the build orchestrator." });
    expect(decision.settle).toMatchObject({ effectId: "e1", status: "succeeded" });
    expect(decision.activities).toEqual([expect.objectContaining({
      kind: "action", summary: "Dispatched build FB-1 to the build orchestrator.",
      payload: { kind: "build-dispatch", buildId: "FB-1", outcome: "started" },
    })]);
    expect(decision.effects).toEqual([]);
  });

  it("a refused dispatch is written to the room as an error with its reason", () => {
    const decision = settled({ outcome: "refused", summary: "Build dispatch refused: this room does not carry FB-1." });
    expect(decision.activities).toEqual([expect.objectContaining({ kind: "error", summary: "Build dispatch refused: this room does not carry FB-1." })]);
  });

  it("an infrastructure failure retries with backoff, then lands in the room log as a runtime error", () => {
    const retry = decideRuntimeCommand({ session: null }, "effect-result:e1:1", {
      type: "effect.settled", effectId: "e1", attempt: 1, kind: "dispatch-build", payload: {}, outcome: "failed", final: false, error: "db down", retryAfterMs: 1000,
    });
    expect(retry.settle).toMatchObject({ status: "pending", retryAfterMs: 1000 });
    const final = decideRuntimeCommand({ session: null }, "effect-result:e1:3", {
      type: "effect.settled", effectId: "e1", attempt: 3, kind: "dispatch-build", payload: {}, outcome: "failed", final: true, error: "db down",
    });
    expect(final.settle).toMatchObject({ status: "failed" });
    expect(final.activities).toEqual([expect.objectContaining({ kind: "error", summary: "Runtime effect dispatch-build failed: db down" })]);
  });
});
