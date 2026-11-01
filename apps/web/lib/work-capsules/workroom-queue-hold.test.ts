import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-2B6A8A74 (AC-DDL-RECOVER-HOLD): a provider failure holds a room's queue;
// an explicit resume releases it.

const { db, recordActivity } = vi.hoisted(() => ({
  db: {
    workroom: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    scheduledAgentTask: { updateMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  recordActivity: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("./work-capsule-activity-store", () => ({ recordWorkCapsuleActivity: recordActivity }));

import { buildDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import {
  holdReleaseDelayMs,
  releaseDueWorkroomQueueHolds,
  holdWorkroomQueueAfterFailure,
  queueHoldingFailureKind,
  readWorkroomQueueHold,
  resumeWorkroomQueue,
} from "./workroom-queue-hold";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const ROOM_TASK = { trigger: { kind: "detected-need", workroomId: "WC-1" } };
const HELD = { since: NOW.toISOString(), kind: "rate-limit", taskId: "workroom-WC-1-shape", error: "busy",
  releaseAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(), count: 1, ownerUserId: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.workroom.findFirst.mockResolvedValue({ id: "row-1", workspaceState: { other: 1 } });
});

describe("queueHoldingFailureKind", () => {
  it("holds on the provider's failures, read from the scheduler's own kind or the loop's reply", () => {
    expect(queueHoldingFailureKind("Scheduled run produced no governed work (config). No AI model can handle this request right now.")).toBe("config");
    expect(queueHoldingFailureKind("The AI providers are momentarily busy (usually rate-limited or overloaded).")).toBe("rate-limit");
    expect(queueHoldingFailureKind("API Error: Unable to connect to API (ConnectionRefused)")).toBe("connection");
  });

  it("does not hold on an empty model reply or an ordinary error", () => {
    expect(queueHoldingFailureKind("Scheduled run produced no governed work (empty-response).")).toBeNull();
    expect(queueHoldingFailureKind("TypeError: cannot read properties of undefined")).toBeNull();
  });
});

describe("holdWorkroomQueueAfterFailure", () => {
  it("holds the room, takes the failed task off the schedule and records provider-blocked", async () => {
    const hold = await holdWorkroomQueueAfterFailure({
      taskId: HELD.taskId, ownerUserId: "user-1", taskConfig: ROOM_TASK, error: "The AI providers are momentarily busy.", now: NOW,
    });
    expect(hold).toMatchObject({ kind: "rate-limit", taskId: HELD.taskId, since: NOW.toISOString() });
    expect(db.workroom.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { workspaceState: { other: 1, queueHold: hold } },
    });
    expect(db.scheduledAgentTask.updateMany).toHaveBeenCalledWith({
      where: { taskId: HELD.taskId }, data: { nextRunAt: null, attempts: 0 },
    });
    expect(recordActivity.mock.calls[0]?.[1]).toMatchObject({ workCapsuleId: "row-1", kind: "provider-blocked" });
  });

  it("finds the room of a drive-dispatched task through its dispatch checkpoint", async () => {
    const checkpoint = buildDispatchCheckpoint(null, {
      taskId: "t", roomId: "row-1", objective: null, holderPrincipalId: null, leaseExpiresAt: NOW.toISOString(), now: NOW.toISOString(),
      stage: { shapeKey: "s", shapeVersion: "1.0.0", stageKey: "a", tools: [] },
    });
    await holdWorkroomQueueAfterFailure({ taskId: "t", ownerUserId: "user-1", taskConfig: { workroomDispatchCheckpoint: checkpoint }, error: "AI providers are momentarily busy" });
    expect(db.workroom.findFirst.mock.calls[0]?.[0]?.where?.OR).toEqual([{ capsuleId: "row-1" }, { id: "row-1" }]);
  });

  it("holds nothing for a task that serves no room, a non-provider failure, or a room already held", async () => {
    await expect(holdWorkroomQueueAfterFailure({ taskId: "t", ownerUserId: "user-1", taskConfig: {}, error: "AI providers are momentarily busy" })).resolves.toBeNull();
    await expect(holdWorkroomQueueAfterFailure({ taskId: "t", ownerUserId: "user-1", taskConfig: ROOM_TASK, error: "TypeError: boom" })).resolves.toBeNull();
    db.workroom.findFirst.mockResolvedValue({ id: "row-1", workspaceState: { queueHold: HELD } });
    await expect(holdWorkroomQueueAfterFailure({ taskId: "t", ownerUserId: "user-1", taskConfig: ROOM_TASK, error: "AI providers are momentarily busy" })).resolves.toBeNull();
    expect(db.workroom.update).not.toHaveBeenCalled();
  });
});

describe("resumeWorkroomQueue", () => {
  const actor = { userId: "user-1", agentId: null, principalId: "prn-1" };

  it("clears the hold, re-arms the held task and records provider-unblocked", async () => {
    db.workroom.findUnique.mockResolvedValue({ id: "row-1", workspaceState: { other: 1, queueHold: HELD } });
    const result = await resumeWorkroomQueue({ db: db as never, capsuleId: "WC-1", reason: "provider answers again", actor, now: NOW });
    expect(result).toEqual({ resumed: true, hold: HELD });
    expect(db.workroom.update).toHaveBeenCalledWith({ where: { id: "row-1" },
      data: { workspaceState: { other: 1, queueHoldHistory: { count: 1, lastReleasedAt: NOW.toISOString() } } } });
    expect(db.scheduledAgentTask.updateMany).toHaveBeenCalledWith({
      where: { taskId: HELD.taskId, isActive: true }, data: { nextRunAt: NOW },
    });
    expect(recordActivity.mock.calls[0]?.[1]).toMatchObject({ kind: "provider-unblocked", actor });
  });

  it("is a no-op for a room with no hold", async () => {
    db.workroom.findUnique.mockResolvedValue({ id: "row-1", workspaceState: {} });
    await expect(resumeWorkroomQueue({ db: db as never, capsuleId: "WC-1", reason: "r", actor })).resolves.toEqual({ resumed: false, hold: null });
    expect(db.workroom.update).not.toHaveBeenCalled();
    expect(readWorkroomQueueHold({ queueHold: "junk" })).toBeNull();
  });
});

// BI-95638941: a hold releases itself; a room held again soon waits longer.
describe("hold release timing", () => {
  it("backs off 30 minutes, doubling per repeat hold, capped at 6 hours", () => {
    expect([1, 2, 3, 4, 5, 9].map((count) => holdReleaseDelayMs(count) / 60_000)).toEqual([30, 60, 120, 240, 360, 360]);
  });

  it("records releaseAt, count and owner, and counts a re-hold within a day of the last release", async () => {
    db.workroom.findFirst.mockResolvedValue({ id: "row-1",
      workspaceState: { queueHoldHistory: { count: 2, lastReleasedAt: new Date(NOW.getTime() - 3_600_000).toISOString() } } });
    const hold = await holdWorkroomQueueAfterFailure({ taskId: "t", ownerUserId: "user-1", taskConfig: ROOM_TASK, error: "AI providers are momentarily busy", now: NOW });
    expect(hold).toMatchObject({ count: 3, ownerUserId: "user-1", releaseAt: new Date(NOW.getTime() + 120 * 60_000).toISOString() });
  });

  it("starts over after a quiet day", async () => {
    db.workroom.findFirst.mockResolvedValue({ id: "row-1",
      workspaceState: { queueHoldHistory: { count: 4, lastReleasedAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString() } } });
    const hold = await holdWorkroomQueueAfterFailure({ taskId: "t", ownerUserId: "user-1", taskConfig: ROOM_TASK, error: "AI providers are momentarily busy", now: NOW });
    expect(hold).toMatchObject({ count: 1 });
  });
});

describe("releaseDueWorkroomQueueHolds", () => {
  it("releases due holds (legacy ones 30 minutes after they began), leaves the rest, and records each as a resume", async () => {
    const later = new Date(NOW.getTime() + 31 * 60_000);
    const legacy = { since: NOW.toISOString(), kind: "rate-limit", taskId: "t-legacy", error: "" };
    const notYet = { ...HELD, taskId: "t-wait", releaseAt: new Date(NOW.getTime() + 3_600_000).toISOString() };
    db.workroom.findMany.mockResolvedValue([
      { capsuleId: "WC-DUE", workspaceState: { queueHold: HELD } },
      { capsuleId: "WC-LEGACY", workspaceState: { queueHold: legacy } },
      { capsuleId: "WC-WAIT", workspaceState: { queueHold: notYet } },
      { capsuleId: "WC-FREE", workspaceState: {} },
    ]);
    db.workroom.findUnique.mockImplementation(async ({ where }: { where: { capsuleId: string } }) =>
      ({ id: `row-${where.capsuleId}`, workspaceState: where.capsuleId === "WC-DUE" ? { queueHold: HELD } : { queueHold: legacy } }));
    db.scheduledAgentTask.findUnique.mockResolvedValue({ ownerUserId: "user-legacy" });
    await expect(releaseDueWorkroomQueueHolds(later)).resolves.toEqual(["WC-DUE", "WC-LEGACY"]);
    expect(recordActivity.mock.calls.map((call) => (call as unknown as [unknown, { kind: string; actor: { userId: string } }])[1]))
      .toEqual([
        expect.objectContaining({ kind: "provider-unblocked", actor: expect.objectContaining({ userId: "user-1" }) }),
        expect.objectContaining({ kind: "provider-unblocked", actor: expect.objectContaining({ userId: "user-legacy" }) }),
      ]);
  });
});
