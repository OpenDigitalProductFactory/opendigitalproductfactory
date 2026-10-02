/**
 * BI-F9EE05E5 (spec §11a) — the drain waits for work instead of skipping or
 * stopping it. Covers the drain-wait helpers and the quiescence.ts seams the
 * amendment touches: the awaiting-operator status, a live phase is never reaped,
 * the periodic reconciler leaves a heartbeating drain alone, and the operator
 * controls (keep-waiting, abort) reach the coordinator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  taskRunFindMany: vi.fn(),
  taskRunUpdateMany: vi.fn(),
  buildPhaseRunFindMany: vi.fn(),
  buildPhaseRunUpdateMany: vi.fn(),
  executeRaw: vi.fn(),
  toolExecutionFindMany: vi.fn(),
  quiescenceRunFindUnique: vi.fn(),
  quiescenceRunFindMany: vi.fn(),
  quiescenceRunUpdate: vi.fn(),
  quiescenceRunUpdateMany: vi.fn(),
  platformConfigFindUnique: vi.fn(),
  platformConfigUpsert: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findMany: db.taskRunFindMany, updateMany: db.taskRunUpdateMany },
    buildPhaseRun: { findMany: db.buildPhaseRunFindMany, updateMany: db.buildPhaseRunUpdateMany },
    $executeRaw: db.executeRaw,
    toolExecution: { findMany: db.toolExecutionFindMany },
    quiescenceRun: {
      findUnique: db.quiescenceRunFindUnique,
      findMany: db.quiescenceRunFindMany,
      update: db.quiescenceRunUpdate,
      updateMany: db.quiescenceRunUpdateMany,
    },
    platformConfig: { findUnique: db.platformConfigFindUnique, upsert: db.platformConfigUpsert },
  },
}));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/jobs", () => ({ jobs: { send: sendMock } }));
vi.mock("@/lib/tak/agent-event-bus", () => ({ agentEventBus: { broadcastSystem: vi.fn() } }));
vi.mock("./read-only-tool-signal", () => ({ resolveReadOnlyToolNames: vi.fn(async () => []) }));

import {
  abortQuiescence,
  captureActiveSessionBlockers,
  isTerminalQuiescenceStatus,
  QUIESCENCE_RUN_STATUSES,
  reconcileQuiescenceOnBoot,
  summarizeBlockers,
} from "./quiescence";
import {
  awaitQuiescenceReady,
  DEFAULT_DRAIN_WAIT_BUDGET_MS,
  extendQuiescenceWait,
  isDrainHeartbeatLive,
  isDrainWaitingStatus,
  isLiveSelfUpgradeDrain,
  readDrainControl,
  recordDrainProgress,
  selfUpgradeRunsWithLiveDrain,
} from "./drain-wait";
import { guardAdmissionClosedForSwap, reassertDrainingLevel } from "./drain-admission";

const NOW = new Date("2026-09-30T18:00:00.000Z");
const MIN = 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const quiet = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  db.taskRunFindMany.mockResolvedValue([]);
  db.taskRunUpdateMany.mockResolvedValue({ count: 0 });
  db.buildPhaseRunFindMany.mockResolvedValue([]);
  db.buildPhaseRunUpdateMany.mockResolvedValue({ count: 0 });
  db.executeRaw.mockResolvedValue(0);
  db.toolExecutionFindMany.mockResolvedValue([]);
  db.quiescenceRunFindUnique.mockResolvedValue(null);
  db.quiescenceRunFindMany.mockResolvedValue([]);
  db.quiescenceRunUpdate.mockResolvedValue({});
  db.quiescenceRunUpdateMany.mockResolvedValue({ count: 0 });
  sendMock.mockResolvedValue({ ids: [] });
  db.platformConfigFindUnique.mockResolvedValue(null);
  db.platformConfigUpsert.mockResolvedValue({});
});

const level = (lvl: string, runId: string | null) =>
  db.platformConfigFindUnique.mockResolvedValue({ key: "portal.quiescence", value: { level: lvl, runId, enteredAt: NOW.toISOString() } });
const upsertedLevels = () =>
  db.platformConfigUpsert.mock.calls.map((c) => (c[0] as { update: { value: { level: string; runId: string | null } } }).update.value);

afterEach(() => {
  vi.useRealTimers();
});

describe("awaiting-operator status", () => {
  it("is a known, non-terminal QuiescenceRun status", () => {
    expect(QUIESCENCE_RUN_STATUSES).toContain("awaiting-operator");
    expect(isTerminalQuiescenceStatus("awaiting-operator")).toBe(false);
  });

  it("the wait budget defaults to 60 minutes", () => {
    expect(DEFAULT_DRAIN_WAIT_BUDGET_MS).toBe(60 * MIN);
  });
});

describe("dead-phase reaping never reaps a live phase whose TaskRun is quiescing (BI-F9EE05E5)", () => {
  it("counts a quiescing TaskRun's recent signal as live for its build", async () => {
    // The phase started an hour ago; its only TaskRun was flipped to quiescing
    // (Force now, or any drain) and is still finishing its iteration. Before the
    // fix the reaper saw no working/active heartbeat and closed the phase row.
    db.buildPhaseRunFindMany.mockResolvedValue([{ buildId: "FB-1", phase: "build", startedAt: ago(60 * MIN) }]);
    db.taskRunFindMany.mockImplementation(async (args: { where: { status: unknown } }) =>
      args.where.status === "quiescing"
        ? [{ buildId: "FB-1", lastHeartbeatAt: ago(30 * MIN), quiescedAt: ago(2 * MIN) }]
        : [],
    );

    const snap = await captureActiveSessionBlockers({ now: NOW });

    expect(snap.surfaces.map((s) => s.surface)).toContain("build-studio.phase.build");
    // Only reconcileTerminalBuildPhaseRuns closed rows; the live phase was not reaped.
    expect(db.buildPhaseRunUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("still reaps a phase whose quiescing TaskRun went silent past the liveness window", async () => {
    db.buildPhaseRunFindMany.mockResolvedValue([{ buildId: "FB-2", phase: "build", startedAt: ago(60 * MIN) }]);
    db.taskRunFindMany.mockImplementation(async (args: { where: { status: unknown } }) =>
      args.where.status === "quiescing"
        ? [{ buildId: "FB-2", lastHeartbeatAt: ago(50 * MIN), quiescedAt: ago(40 * MIN) }]
        : [],
    );

    const snap = await captureActiveSessionBlockers({ now: NOW });

    expect(snap.surfaces.map((s) => s.surface)).not.toContain("build-studio.phase.build");
  });
});

describe("blocker lines for live progress", () => {
  it("carry the build id, the phase and its start", () => {
    const [line] = summarizeBlockers({
      capturedAt: NOW.toISOString(),
      thresholdMs: 300_000,
      totalBlockers: 1,
      hardBlockers: 1,
      softBlockers: 0,
      unobservableSurfaces: [],
      surfaces: [
        {
          surface: "build-studio.phase.build",
          detectionClass: "A",
          kind: "hard",
          blockerSignal: { class: "A", model: "BuildPhaseRun", rowId: "FB-1/build", status: "in-flight" },
          estimatedWaitMs: 30 * MIN,
          evidence: { buildId: "FB-1", phase: "build", startedAt: ago(12 * MIN).toISOString() },
        },
      ],
    });
    expect(line).toMatchObject({
      sampleBuildId: "FB-1",
      sampleTitle: "build phase",
      oldestSignalAt: ago(12 * MIN).toISOString(),
    });
  });
});

describe("readDrainControl / recordDrainProgress", () => {
  it("reads the moving budget, the drain start and the force flag", async () => {
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "awaiting-operator",
      budgetMs: 90 * MIN,
      startedAt: ago(100 * MIN),
      enteredStateAt: { draining: ago(95 * MIN).toISOString() },
      shipForceEscalatedAt: null,
      abortRequestedAt: null,
      abortRequestedBy: null,
    });
    expect(await readDrainControl("QR-1")).toEqual({
      status: "awaiting-operator",
      budgetMs: 90 * MIN,
      drainStartedAt: ago(95 * MIN).toISOString(),
      forced: false,
      abortRequestedBy: null,
    });
  });

  it("returns the durable abort an operator recorded (abortRequestedAt/By)", async () => {
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "draining", budgetMs: MIN, startedAt: NOW, enteredStateAt: {}, shipForceEscalatedAt: null,
      abortRequestedAt: NOW, abortRequestedBy: "op-4",
    });
    expect(await readDrainControl("QR-1")).toMatchObject({ abortRequestedBy: "op-4" });
  });

  it("persists the heartbeat and the live snapshot in one write", async () => {
    const snapshot = { capturedAt: NOW.toISOString(), surfaces: [] };
    await recordDrainProgress("QR-1", snapshot as never, NOW);
    expect(db.quiescenceRunUpdate).toHaveBeenCalledWith({
      where: { runId: "QR-1" },
      data: { lastHeartbeatAt: NOW, finalSnapshot: snapshot },
    });
  });
});

describe("extendQuiescenceWait (Keep waiting)", () => {
  it("moves the bound to now + the extension and wakes the coordinator", async () => {
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "awaiting-operator",
      budgetMs: 60 * MIN,
      startedAt: ago(70 * MIN),
      enteredStateAt: { draining: ago(65 * MIN).toISOString() },
    });

    const r = await extendQuiescenceWait("QR-1", "op-1", { extendMs: 30 * MIN, now: NOW });

    expect(r).toEqual({ ok: true, data: { budgetMs: 95 * MIN } });
    expect(db.quiescenceRunUpdate).toHaveBeenCalledWith({ where: { runId: "QR-1" }, data: { budgetMs: 95 * MIN } });
    expect(sendMock).toHaveBeenCalledWith({
      name: "ops/quiescence.control",
      data: { runId: "QR-1", action: "keep-waiting", operatorUserId: "op-1" },
    });
  });

  it("refuses a run that is no longer waiting", async () => {
    db.quiescenceRunFindUnique.mockResolvedValue({ status: "completed", budgetMs: 1, startedAt: NOW, enteredStateAt: {} });
    expect(await extendQuiescenceWait("QR-1", "op-1", { now: NOW })).toEqual({ ok: false, error: "run is completed, not waiting" });
    expect(db.quiescenceRunUpdate).not.toHaveBeenCalled();
  });
});

describe("abortQuiescence reaches a coordinator that is still draining", () => {
  it("records the abort durably (abortRequestedAt/By) before sending the wake-up events", async () => {
    db.quiescenceRunUpdateMany.mockResolvedValue({ count: 1 });
    await abortQuiescence("QR-1", "op-3");
    // One conditional write: only a live run, and only the first Abort wins.
    expect(db.quiescenceRunUpdateMany).toHaveBeenCalledWith({
      where: { runId: "QR-1", abortRequestedAt: null, status: { notIn: ["completed", "deferred", "aborted", "failed"] } },
      data: { abortRequestedAt: expect.any(Date), abortRequestedBy: "op-3" },
    });
    expect(db.quiescenceRunUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(sendMock.mock.invocationCallOrder[0]);
    // forcedSurfaces keeps its single meaning (force audit); abort never touches it.
    expect(db.quiescenceRunUpdate).not.toHaveBeenCalled();
  });

  it("sends the operator-control abort as well as the swap-complete abort", async () => {
    await abortQuiescence("QR-1", "op-3");
    const names = sendMock.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(["ops/quiescence.swap-complete", "ops/quiescence.control"]));
    expect(sendMock).toHaveBeenCalledWith({
      name: "ops/quiescence.control",
      data: { runId: "QR-1", action: "abort", operatorUserId: "op-3" },
    });
  });
});

describe("reconcilers never reap a drain that is still heartbeating", () => {
  it("isDrainHeartbeatLive keys on lastHeartbeatAt, not startedAt", () => {
    expect(isDrainHeartbeatLive({ lastHeartbeatAt: ago(1 * MIN), now: NOW, thresholdMs: 30 * MIN })).toBe(true);
    expect(isDrainHeartbeatLive({ lastHeartbeatAt: ago(31 * MIN), now: NOW, thresholdMs: 30 * MIN })).toBe(false);
    expect(isDrainHeartbeatLive({ lastHeartbeatAt: null, now: NOW, thresholdMs: 30 * MIN })).toBe(false);
  });

  it("periodic reconcileQuiescenceOnBoot leaves a 45-minute awaiting-operator drain alone", async () => {
    db.quiescenceRunFindMany
      .mockResolvedValueOnce([
        { runId: "QR-LIVE", status: "awaiting-operator", targetVersion: "x", targetBundleHash: "t", triggerRefId: "SUR-1", startedAt: ago(45 * MIN), lastHeartbeatAt: ago(20_000) },
        { runId: "QR-DEAD", status: "draining", targetVersion: "x", targetBundleHash: "t", triggerRefId: "SUR-2", startedAt: ago(45 * MIN), lastHeartbeatAt: ago(40 * MIN) },
      ])
      .mockResolvedValueOnce([]);

    const r = await reconcileQuiescenceOnBoot({
      currentVersion: "running",
      currentBundleHash: "running",
      staleAfterMs: 30 * MIN,
      now: NOW,
      logger: quiet,
    });

    expect(r).toEqual({ reconciled: 0, failed: 1 });
    const failed = sendMock.mock.calls.map((c) => c[0] as { data: { runId: string; outcome: string } });
    expect(failed.filter((e) => e.data.outcome === "failed").map((e) => e.data.runId)).toEqual(["QR-DEAD"]);
  });

  it("selfUpgradeRunsWithLiveDrain names upgrade runs whose drain still heartbeats", async () => {
    db.quiescenceRunFindMany.mockResolvedValue([
      { triggerRefId: "SUR-LIVE", lastHeartbeatAt: ago(30_000) },
      { triggerRefId: "SUR-STALE", lastHeartbeatAt: ago(45 * MIN) },
    ]);
    const live = await selfUpgradeRunsWithLiveDrain(["SUR-LIVE", "SUR-STALE"], NOW, 30 * MIN);
    expect([...live]).toEqual(["SUR-LIVE"]);
  });

  it("selfUpgradeRunsWithLiveDrain counts a run in the swap window as live by status, not heartbeat", async () => {
    // The coordinator stops heartbeating at ready-to-swap while the promoter builds
    // (up to its 25-min budget + the 10-min handshake), so key on status — bounded,
    // so a coordinator that died at ready-to-swap is still reconciled eventually.
    db.quiescenceRunFindMany.mockResolvedValue([
      { triggerRefId: "SUR-SWAP", status: "ready-to-swap", lastHeartbeatAt: ago(40 * MIN), enteredStateAt: { "ready-to-swap": ago(35 * MIN).toISOString() } },
      { triggerRefId: "SUR-SWAPPING", status: "swapping", lastHeartbeatAt: ago(50 * MIN), enteredStateAt: { "ready-to-swap": ago(45 * MIN).toISOString(), swapping: ago(1 * MIN).toISOString() } },
      { triggerRefId: "SUR-ORPHAN", status: "ready-to-swap", lastHeartbeatAt: ago(5 * 60 * MIN), enteredStateAt: { "ready-to-swap": ago(5 * 60 * MIN).toISOString() } },
    ]);
    const live = await selfUpgradeRunsWithLiveDrain(["SUR-SWAP", "SUR-SWAPPING", "SUR-ORPHAN"], NOW, 30 * MIN);
    expect([...live].sort()).toEqual(["SUR-SWAP", "SUR-SWAPPING"]);
  });

  it("selfUpgradeRunsWithLiveDrain fails open to an empty set on a read error", async () => {
    db.quiescenceRunFindMany.mockRejectedValue(new Error("db down"));
    expect((await selfUpgradeRunsWithLiveDrain(["SUR-1"], NOW, 30 * MIN)).size).toBe(0);
  });
});

describe("awaitQuiescenceReady follows the moving deadline for an upgrade", () => {
  it("keeps waiting past the budget while the drain awaits the operator, then returns ready", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    let reads = 0;
    db.quiescenceRunFindUnique.mockImplementation(async () => {
      reads += 1;
      const status = reads < 5 ? "awaiting-operator" : "ready-to-swap";
      return { status, finalSnapshot: null, deferSurface: null, outcomeNotes: null, lastHeartbeatAt: new Date() };
    });
    const sleep = vi.fn(async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    });

    const out = await awaitQuiescenceReady("QR-1", { budgetMs: 1_000, followDrain: true, sleep, pollMs: 60_000 });

    expect(out).toMatchObject({ ok: true, outcome: "ready-to-swap" });
    expect(Date.now() - NOW.getTime()).toBeGreaterThan(1_000 + 60_000);
  });

  it("gives up only when the coordinator stops heartbeating", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "draining", finalSnapshot: null, deferSurface: null, outcomeNotes: null, lastHeartbeatAt: ago(20 * MIN),
    });
    const sleep = vi.fn(async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    });

    const out = await awaitQuiescenceReady("QR-1", { budgetMs: 1_000, followDrain: true, sleep });

    expect(out).toMatchObject({ ok: false, outcome: "failed", reason: expect.stringContaining("heartbeat") });
  });

  it("other triggers keep the budget + 60s ceiling", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "draining", finalSnapshot: null, deferSurface: null, outcomeNotes: null, lastHeartbeatAt: new Date(),
    });
    const sleep = vi.fn(async (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
    });

    const out = await awaitQuiescenceReady("QR-1", { budgetMs: 1_000, followDrain: false, sleep });

    expect(out).toMatchObject({ ok: false, outcome: "failed", reason: "awaitReady outer timeout" });
  });
});

describe("admission stays closed while a self-upgrade drain is live (restart mid-drain)", () => {
  beforeEach(() => {
    // The swap guard reads the run first: a live drain at ready-to-swap.
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "ready-to-swap", budgetMs: 60 * MIN, startedAt: ago(70 * MIN), enteredStateAt: {}, shipForceEscalatedAt: null,
    });
  });

  it("isLiveSelfUpgradeDrain: a draining / awaiting-operator self-upgrade run that heartbeats is live", async () => {
    db.quiescenceRunFindUnique.mockResolvedValueOnce({ status: "awaiting-operator", trigger: "self-upgrade", lastHeartbeatAt: ago(30_000) });
    expect(await isLiveSelfUpgradeDrain("QR-1", NOW)).toBe(true);
    db.quiescenceRunFindUnique.mockResolvedValueOnce({ status: "draining", trigger: "self-upgrade", lastHeartbeatAt: ago(10 * MIN) });
    expect(await isLiveSelfUpgradeDrain("QR-1", NOW)).toBe(false); // orphaned: coordinator silent
    db.quiescenceRunFindUnique.mockResolvedValueOnce({ status: "ready-to-swap", trigger: "self-upgrade", lastHeartbeatAt: ago(30_000) });
    expect(await isLiveSelfUpgradeDrain("QR-1", NOW)).toBe(false);
    db.quiescenceRunFindUnique.mockResolvedValueOnce({ status: "draining", trigger: "installation-teardown", lastHeartbeatAt: ago(30_000) });
    expect(await isLiveSelfUpgradeDrain("QR-1", NOW)).toBe(false);
    expect(await isLiveSelfUpgradeDrain(null, NOW)).toBe(false);
  });

  it("reassertDrainingLevel closes admission again after an external reset to normal", async () => {
    level("normal", null);
    expect(await reassertDrainingLevel("QR-1")).toBe(true);
    expect(upsertedLevels()).toEqual([expect.objectContaining({ level: "draining", runId: "QR-1" })]);
  });

  it("reassertDrainingLevel is a no-op when the level is already draining for this run", async () => {
    level("draining", "QR-1");
    expect(await reassertDrainingLevel("QR-1")).toBe(false);
    expect(db.platformConfigUpsert).not.toHaveBeenCalled();
  });

  it("swap guard: level already draining for this run → proceed, nothing written", async () => {
    level("draining", "QR-1");
    expect(await guardAdmissionClosedForSwap("QR-1")).toEqual({ ok: true, data: { reasserted: false } });
    expect(db.platformConfigUpsert).not.toHaveBeenCalled();
  });

  it("swap guard: level normal → re-asserts draining, re-checks blockers, proceeds when clear", async () => {
    level("normal", null);
    expect(await guardAdmissionClosedForSwap("QR-1")).toEqual({ ok: true, data: { reasserted: true } });
    expect(upsertedLevels()).toEqual([expect.objectContaining({ level: "draining", runId: "QR-1" })]);
    expect(db.buildPhaseRunFindMany).toHaveBeenCalled(); // blockers re-captured
  });

  it("swap guard: level normal and work started meanwhile → refuses (never swap with admission open)", async () => {
    level("normal", null);
    db.buildPhaseRunFindMany.mockResolvedValue([{ buildId: "FB-9", phase: "plan", startedAt: new Date(Date.now() - MIN) }]);
    const r = await guardAdmissionClosedForSwap("QR-1");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("build-studio.phase.plan") });
    // Admission is closed again regardless, so nothing new starts while the run fails.
    expect(upsertedLevels()).toEqual([expect.objectContaining({ level: "draining", runId: "QR-1" })]);
  });

  it("swap guard: an aborted (or abort-requested) drain is refused without re-closing admission", async () => {
    level("normal", null);
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "aborted", budgetMs: MIN, startedAt: NOW, enteredStateAt: {}, shipForceEscalatedAt: null,
    });
    expect(await guardAdmissionClosedForSwap("QR-1")).toMatchObject({ ok: false, error: expect.stringContaining("aborted") });
    db.quiescenceRunFindUnique.mockResolvedValue({
      status: "ready-to-swap", budgetMs: MIN, startedAt: NOW, enteredStateAt: {}, shipForceEscalatedAt: null,
      abortRequestedAt: NOW, abortRequestedBy: "op-1",
    });
    expect(await guardAdmissionClosedForSwap("QR-1", { forced: true })).toMatchObject({ ok: false, error: expect.stringContaining("op-1") });
    expect(db.platformConfigUpsert).not.toHaveBeenCalled();
  });

  it("isDrainWaitingStatus: only draining and awaiting-operator close admission while waiting", () => {
    expect(["pending", "preparing", "draining", "awaiting-operator", "ready-to-swap", "swapping", "completed"].filter(isDrainWaitingStatus)).toEqual([
      "draining",
      "awaiting-operator",
    ]);
  });

  it("swap guard refuses (fail closed) when the run cannot be found", async () => {
    db.quiescenceRunFindUnique.mockResolvedValue(null);
    expect(await guardAdmissionClosedForSwap("QR-1")).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
  });

  it("swap guard: a forced drain proceeds past the re-check", async () => {
    level("normal", null);
    db.buildPhaseRunFindMany.mockResolvedValue([{ buildId: "FB-9", phase: "plan", startedAt: new Date(Date.now() - MIN) }]);
    expect(await guardAdmissionClosedForSwap("QR-1", { forced: true })).toEqual({ ok: true, data: { reasserted: true } });
  });
});
