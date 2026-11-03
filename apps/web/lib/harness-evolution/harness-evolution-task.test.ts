import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduledAgentTaskUpdate: vi.fn(),
  scheduledJobUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledAgentTask: { update: mocks.scheduledAgentTaskUpdate },
    scheduledJob: { update: mocks.scheduledJobUpdate },
  },
}));

import type { HarnessEvolutionStore } from "./harness-evolution-store";
import {
  executeHarnessEvolutionLoopTask,
  harnessEvolutionPeriodKey,
  runHarnessEvolutionLoop,
} from "./harness-evolution-task";

// BI-49BC21C1 slice 1: rooms own their candidates (AC-2/AC-3); the aggregator
// rolls them up, records budget and spend once per day, and never edits a
// room's harness (AC-4).

const NOW = new Date("2026-10-28T04:17:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const shape = (ref: string) => [{ workShape: ref }];

function fakeStore(overrides: Partial<Record<keyof HarnessEvolutionStore, ReturnType<typeof vi.fn>>> = {}) {
  const defaults = {
    findRun: vi.fn().mockResolvedValue(null),
    listActiveRooms: vi.fn().mockResolvedValue([
      { id: "r1", capsuleId: "WC-1", scopeClaims: shape("delivery-medium@1.0.0"), decisionScope: "wwmd" },
      { id: "r2", capsuleId: "WC-2", scopeClaims: shape("delivery-medium@1.0.0"), decisionScope: null },
      { id: "r3", capsuleId: "WC-3", scopeClaims: shape("acceptance-verification@1.1.0"), decisionScope: null },
      { id: "r4", capsuleId: "WC-4", scopeClaims: [], decisionScope: null },
    ]),
    listToolFailures: vi.fn().mockResolvedValue([
      { capsuleId: "WC-1", id: "te-1", toolName: "record_workroom_evidence", error: "authority_denied", createdAt: ago(1) },
      { capsuleId: "WC-1", id: "te-2", toolName: "record_workroom_evidence", error: "authority_denied: x", createdAt: ago(2) },
      { capsuleId: "WC-2", id: "te-3", toolName: "record_workroom_evidence", error: "authority_denied", createdAt: ago(3) },
      { capsuleId: "WC-2", id: "te-4", toolName: "record_workroom_evidence", error: "authority_denied", createdAt: ago(4) },
    ]),
    listRoomActivities: vi.fn().mockResolvedValue([
      { workCapsuleId: "r2", id: "a-1", kind: "status-override", recordedAt: ago(5) },
      { workCapsuleId: "r2", id: "a-2", kind: "status-override", recordedAt: ago(6) },
    ]),
    listShapeSignals: vi.fn().mockResolvedValue([
      { signalId: "IS-F1", title: "piles up", recurrenceCount: 12, evidence: { shapeRef: "delivery-medium@1.0.0", stageKey: "design-note", cause: "x" } },
      { signalId: "IS-F2", title: "other", recurrenceCount: 4, evidence: { shapeRef: "acceptance-verification@1.1.0" } },
    ]),
    listBacklogItems: vi.fn().mockResolvedValue([{ itemId: "BI-2C73B434", title: "seed", status: "open" }]),
    recordRoomCandidates: vi.fn().mockResolvedValue(true),
    recordRun: vi.fn().mockResolvedValue({ taskRunId: "TR-HEV-NEW" }),
  };
  return { ...defaults, ...overrides } as typeof defaults & HarnessEvolutionStore;
}

const RUN_INPUT = {
  ownerUserId: "user-1",
  agentId: "platform-engineer",
  taskId: "harness-evolution-loop-daily",
  taskConfig: { seedItemIds: ["BI-2C73B434", "BI-NOT-HERE"] },
  now: NOW,
};

beforeEach(() => vi.resetAllMocks());

describe("harnessEvolutionPeriodKey", () => {
  it("is the UTC calendar day", () => {
    expect(harnessEvolutionPeriodKey(new Date("2026-10-28T23:59:59Z"))).toBe("2026-10-28");
  });
});

describe("runHarnessEvolutionLoop", () => {
  it("reads only ring-0 rooms' misses inside the lookback window", async () => {
    const store = fakeStore();
    await runHarnessEvolutionLoop(store, RUN_INPUT);
    const since = new Date("2026-10-21T04:17:00Z");
    expect(store.listActiveRooms).toHaveBeenCalledWith(since);
    expect(store.listToolFailures).toHaveBeenCalledWith(["WC-1", "WC-2"], since);
    expect(store.listRoomActivities.mock.calls[0]![0]).toEqual(["r1", "r2"]);
    expect(store.listRoomActivities.mock.calls[0]![1]).toContain("status-override");
  });

  it("records each room's own candidates on that room", async () => {
    const store = fakeStore();
    const result = await runHarnessEvolutionLoop(store, RUN_INPUT);

    expect(store.recordRoomCandidates).toHaveBeenCalledTimes(2);
    const [room1, room2] = store.recordRoomCandidates.mock.calls.map((call: unknown[]) => call[0] as { roomId: string; payload: Record<string, unknown> });
    expect(room1).toMatchObject({ roomId: "r1", capsuleId: "WC-1", periodKey: "2026-10-28", agentId: "platform-engineer" });
    expect((room1!.payload.candidates as Array<{ missKey: string }>).map((c) => c.missKey)).toEqual([
      "tool:record_workroom_evidence:authority_denied",
    ]);
    expect(room1!.payload).toMatchObject({ layer: "ring-0", shapeRef: "delivery-medium@1.0.0" });
    expect((room1!.payload.candidates as Array<{ decisionScope: string; componentHint: string }>)[0]).toMatchObject({
      decisionScope: "wwmd",
      componentHint: "gpp-permit",
    });
    expect((room2!.payload.candidates as Array<{ missKey: string; actor: string }>).map((c) => [c.missKey, c.actor])).toEqual([
      // Equal recurrence: the newer miss leads.
      ["tool:record_workroom_evidence:authority_denied", "coworker"],
      ["activity:status-override", "human"],
    ]);
    expect(result.roomsWithCandidates).toBe(2);
  });

  it("rolls up cross-room recurrences, shape signals and the platform queue with budget and spend", async () => {
    const store = fakeStore();
    const result = await runHarnessEvolutionLoop(store, RUN_INPUT);
    const run = store.recordRun.mock.calls[0]![0];

    expect(run).toMatchObject({ ownerUserId: "user-1", repeatedPatternKey: "harness-evolution:2026-10-28", completedAt: NOW });
    expect(run.progressPayload).toEqual({
      periodKey: "2026-10-28",
      budget: { maxRooms: 50, maxCandidatesPerRoom: 3, maxCandidates: 50, maxProbeReplays: 20, tokenCap: 200_000, lookbackDays: 7, minRecurrence: 2 },
      spend: { roomsScanned: 2, candidatesRecorded: 3, probeReplays: 0, tokens: 0 },
      roomsWithCandidates: 2,
      roomsDeferred: 0,
      crossRoomRecurrences: 1,
    });
    const data = run.artifactData as {
      crossRoomRecurrences: Array<{ missKey: string; rooms: string[] }>;
      shapeSignals: Array<{ signalId: string }>;
      platformQueue: { open: unknown[]; rejected: Array<{ itemId: string; reason: string }> };
    };
    expect(data.crossRoomRecurrences).toEqual([
      expect.objectContaining({ shapeKey: "delivery-medium", missKey: "tool:record_workroom_evidence:authority_denied", rooms: ["WC-1", "WC-2"] }),
    ]);
    expect(data.shapeSignals.map((s) => s.signalId)).toEqual(["IS-F1"]);
    expect(data.platformQueue.rejected).toEqual([{ itemId: "BI-NOT-HERE", reason: "missing" }]);
    expect(result.taskRunId).toBe("TR-HEV-NEW");
  });

  it("stops at the run's candidate cap and defers the remaining rooms", async () => {
    const store = fakeStore();
    const result = await runHarnessEvolutionLoop(store, { ...RUN_INPUT, taskConfig: { maxCandidates: 1 } });
    expect(store.recordRoomCandidates).toHaveBeenCalledTimes(1);
    expect(result.spend.candidatesRecorded).toBe(1);
    expect(result.roomsDeferred).toBe(1);
  });

  it("records nothing new when today's run already exists", async () => {
    const store = fakeStore({ findRun: vi.fn().mockResolvedValue({ taskRunId: "TR-HEV-EXISTING" }) });
    const result = await runHarnessEvolutionLoop(store, RUN_INPUT);
    expect(result).toMatchObject({ idempotent: true, taskRunId: "TR-HEV-EXISTING" });
    expect(store.listActiveRooms).not.toHaveBeenCalled();
    expect(store.recordRoomCandidates).not.toHaveBeenCalled();
    expect(store.recordRun).not.toHaveBeenCalled();
  });
});

describe("executeHarnessEvolutionLoopTask", () => {
  const task = {
    taskId: "harness-evolution-loop-daily",
    schedule: "17 4 * * *",
    ownerUserId: "user-1",
    agentId: "platform-engineer",
    taskConfig: {},
  };

  it("marks the task and its job ok with a one-line summary", async () => {
    mocks.scheduledJobUpdate.mockResolvedValue({});
    await executeHarnessEvolutionLoopTask(task, { now: NOW, store: fakeStore() });
    expect(mocks.scheduledAgentTaskUpdate).toHaveBeenCalledWith({
      where: { taskId: task.taskId },
      data: expect.objectContaining({ lastRunAt: NOW, lastStatus: "ok", lastError: null, taskRunId: "TR-HEV-NEW" }),
    });
    expect(mocks.scheduledJobUpdate.mock.calls[0]![0].data.lastRunSummary).toBe(
      "2 of 2 ring-0 rooms hold 3 candidates; 1 cross-room recurrence; spend 0 tokens, 0 probe replays",
    );
  });

  it("records an error instead of throwing into the scheduler", async () => {
    mocks.scheduledJobUpdate.mockResolvedValue({});
    const store = fakeStore({ listActiveRooms: vi.fn().mockRejectedValue(new Error("db down")) });
    await expect(executeHarnessEvolutionLoopTask(task, { now: NOW, store })).resolves.toBeUndefined();
    expect(mocks.scheduledAgentTaskUpdate).toHaveBeenCalledWith({
      where: { taskId: task.taskId },
      data: expect.objectContaining({ lastStatus: "error", lastError: "db down" }),
    });
  });
});
