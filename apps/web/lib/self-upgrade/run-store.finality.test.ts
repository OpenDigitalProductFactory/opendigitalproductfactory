import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, update: vi.fn(), broadcast: vi.fn(), sync: vi.fn(), capture: vi.fn(), recovery: vi.fn(), wake: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { selfUpgradeRun: { update: state.update, findUnique: vi.fn(async () => state.row), findUniqueOrThrow: vi.fn(async () => state.row) } } }));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { broadcastSystem: state.broadcast } }));
vi.mock("@/lib/self-upgrade/change-record", () => ({ safeSyncSelfUpgradeChangeRecord: state.sync }));
vi.mock("@/lib/backlog/capture-corrective-bi", () => ({ captureCorrectiveFailureBI: state.capture, recordCorrectiveRecoveryEvidence: state.recovery }));
vi.mock("@/lib/backlog/acceptance-sweep/acceptance-upgrade-wakeup", () => ({ reconcileAcceptanceUpgradeWakeupFromStore: state.wake }));
import { completeRun, failRun } from "./run-store";

beforeEach(() => {
  vi.clearAllMocks();
  state.row = { runId: "SUR-1", status: "running", completedAt: null };
  // Model the database's conditional UPDATE, including a state change between
  // a caller's earlier read and this atomic write.
  state.update.mockImplementation(async ({ where, data }) => {
    if (where.status && !where.status.in.includes(state.row.status)) throw Object.assign(new Error("no matching row"), { code: "P2025" });
    state.row = { ...state.row, ...data };
    return state.row;
  });
});

describe("self-upgrade terminal finality (BI-0E216B0E)", () => {
  it("an already completed swap cannot be overwritten by a late failure", async () => {
    const completedAt = new Date("2026-10-22T23:18:09.753Z");
    state.row = { runId: "SUR-1", status: "succeeded", completedAt, completionEvidence: { retained: true } };
    expect(await failRun("SUR-1", "admission-reopened-before-swap: the drain already ended (completed)")).toBe(state.row);
    expect(state.row).toMatchObject({ status: "succeeded", completedAt, completionEvidence: { retained: true } });
    for (const fn of [state.broadcast, state.sync, state.capture]) expect(fn).not.toHaveBeenCalled();
  });

  it.each(["failed", "cancelled", "skipped", "succeeded"])("ordinary completion cannot rewrite a %s terminal outcome", async (status) => {
    const completedAt = new Date("2026-10-22T23:18:09.753Z");
    state.row = { runId: "SUR-1", status, completedAt, reason: "original", failureLog: "original" };
    await completeRun("SUR-1");
    expect(state.row).toMatchObject({ status, completedAt, reason: "original", failureLog: "original" });
    for (const fn of [state.broadcast, state.sync, state.recovery, state.wake]) expect(fn).not.toHaveBeenCalled();
  });

  it("fences the update itself when completion wins after a stale failure caller started", async () => {
    const update = state.update.getMockImplementation()!;
    state.update.mockImplementationOnce(async (args) => {
      state.row = { ...state.row, status: "succeeded", completedAt: new Date("2026-10-22T23:18:09.753Z") };
      return update(args);
    });
    expect(await failRun("SUR-1", "stale worker")).toMatchObject({ status: "succeeded" });
    expect(state.capture).not.toHaveBeenCalled();
  });
});
