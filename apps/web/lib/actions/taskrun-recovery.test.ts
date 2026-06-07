import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma at the module boundary so the tests don't need a real DB.
// Each test installs its own findUnique / findFirst / update / create
// implementations via the helpers below.
const {
  taskRunFindUnique,
  taskRunFindMany,
  taskRunUpdate,
  taskRunCreate,
  featureBuildFindUnique,
  stallEventFindFirst,
  stallEventUpdate,
  stallEventCreate,
  notificationCreate,
  deliberationRunFindFirst,
  transactionImpl,
} = vi.hoisted(() => {
  // Mocks are untyped (any) to keep the test ergonomic — production typing
  // is enforced by the actual prisma client in lib/actions/taskrun-recovery.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyFn = (): any => vi.fn();
  const taskRunFindUnique = anyFn();
  const taskRunFindMany = anyFn();
  const taskRunUpdate = anyFn();
  const taskRunCreate = anyFn();
  const featureBuildFindUnique = anyFn();
  const stallEventFindFirst = anyFn();
  const stallEventUpdate = anyFn();
  const stallEventCreate = anyFn();
  const notificationCreate = anyFn();
  const deliberationRunFindFirst = anyFn();
  const transactionImpl = vi.fn(async (fn: (tx: unknown) => unknown) =>
    fn({
      // tx.taskRun.findUnique is reached by upsertRecoveryOutcome when no
      // open StallEvent exists and it has to look up startedAt to synthesize
      // one. Tests that exercise the synthesize path use mockResolvedValueOnce
      // chains to differentiate the loadStalled call from this lookup.
      taskRun: { update: taskRunUpdate, create: taskRunCreate, findMany: taskRunFindMany, findUnique: taskRunFindUnique },
      stallEvent: { findFirst: stallEventFindFirst, update: stallEventUpdate, create: stallEventCreate },
      notification: { create: notificationCreate },
    }),
  );
  return {
    taskRunFindUnique,
    taskRunFindMany,
    taskRunUpdate,
    taskRunCreate,
    featureBuildFindUnique,
    stallEventFindFirst,
    stallEventUpdate,
    stallEventCreate,
    notificationCreate,
    deliberationRunFindFirst,
    transactionImpl,
  };
});

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: taskRunFindUnique, findMany: taskRunFindMany, update: taskRunUpdate, create: taskRunCreate },
    featureBuild: { findUnique: featureBuildFindUnique },
    stallEvent: { findFirst: stallEventFindFirst, update: stallEventUpdate, create: stallEventCreate },
    notification: { create: notificationCreate },
    deliberationRun: { findFirst: deliberationRunFindFirst },
    $transaction: transactionImpl,
  },
}));

import { taskrunRetry, taskrunAbandon, taskrunEscalate, TaskrunRecoveryError } from "./taskrun-recovery";

function stalledRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cuid-stalled-1",
    taskRunId: "TR-STALL-1",
    userId: "user-1",
    threadId: "thread-1",
    contextId: "ctx-1",
    buildId: null,
    routeContext: "/build",
    title: "Stalled task",
    objective: "Do the thing",
    source: "coworker",
    status: "stalled",
    ...overrides,
  };
}

beforeEach(() => {
  taskRunFindUnique.mockReset();
  taskRunFindMany.mockReset();
  taskRunFindMany.mockImplementation(async () => []);
  taskRunUpdate.mockReset();
  taskRunUpdate.mockImplementation(async () => ({}));
  taskRunCreate.mockReset();
  featureBuildFindUnique.mockReset();
  featureBuildFindUnique.mockImplementation(async () => null);
  stallEventFindFirst.mockReset();
  stallEventFindFirst.mockImplementation(async () => null);
  stallEventUpdate.mockReset();
  stallEventUpdate.mockImplementation(async () => ({}));
  stallEventCreate.mockReset();
  stallEventCreate.mockImplementation(async () => ({}));
  notificationCreate.mockReset();
  notificationCreate.mockImplementation(async () => ({}));
  deliberationRunFindFirst.mockReset();
  deliberationRunFindFirst.mockImplementation(async () => null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("taskrunRetry", () => {
  it("rejects when the row is not in stalled status", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), status: "working" });
    await expect(taskrunRetry("TR-STALL-1", "op-1")).rejects.toBeInstanceOf(TaskrunRecoveryError);
    await expect(taskrunRetry("TR-STALL-1", "op-1")).rejects.toThrow(/not_stalled|status is working/);
  });

  it("rejects when the row is not found", async () => {
    taskRunFindUnique.mockResolvedValue(null);
    await expect(taskrunRetry("TR-MISSING", "op-1")).rejects.toBeInstanceOf(TaskrunRecoveryError);
    await expect(taskrunRetry("TR-MISSING", "op-1")).rejects.toThrow(/not_found|not found/);
  });

  it("rejects ship-phase retry without force:true", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "ship" });
    await expect(taskrunRetry("TR-STALL-1", "op-1")).rejects.toThrow(/ship_phase_requires_force|double-publish/);
  });

  it("permits ship-phase retry with force:true", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "ship" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-RETRY-X" });
    const result = await taskrunRetry("TR-STALL-1", "op-1", { force: true });
    expect(result.newTaskRunId).toBe("TR-RETRY-X");
  });

  it("spawns a sibling TaskRun with parentTaskRunId set to the stalled row's cuid", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-RETRY-A" });
    await taskrunRetry("TR-STALL-1", "op-1");
    expect(taskRunCreate).toHaveBeenCalledTimes(1);
    const createArg = taskRunCreate.mock.calls[0]![0] as { data: { parentTaskRunId: string; status: string } };
    expect(createArg.data.parentTaskRunId).toBe("cuid-stalled-1");
    expect(createArg.data.status).toBe("submitted");
  });

  it("closes the most recent open StallEvent as 'retry'", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    stallEventFindFirst.mockResolvedValue({ id: "se-1" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-RETRY-B" });
    await taskrunRetry("TR-STALL-1", "op-99");
    expect(stallEventUpdate).toHaveBeenCalledTimes(1);
    const updateArg = stallEventUpdate.mock.calls[0]![0] as { data: { outcome: string; outcomeBy: string } };
    expect(updateArg.data.outcome).toBe("retry");
    expect(updateArg.data.outcomeBy).toBe("op-99");
  });
});

describe("taskrunRetry per-phase strategy (Phase H)", () => {
  function expectMetadata(strategy: string) {
    const createArg = taskRunCreate.mock.calls[0]![0] as { data: { a2aMetadata: { retryStrategy: string } } };
    expect(createArg.data.a2aMetadata.retryStrategy).toBe(strategy);
  }

  it("build phase → resume-build", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "build" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-R-1" });
    const result = await taskrunRetry("TR-STALL-1", "op-1");
    expect(result.strategy).toBe("resume-build");
    expectMetadata("resume-build");
  });

  it("plan phase with a prior completed DeliberationRun → resume-plan", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "plan" });
    deliberationRunFindFirst.mockResolvedValue({ id: "DR-PRIOR", consensusState: "consensus" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-R-2" });
    const result = await taskrunRetry("TR-STALL-1", "op-1");
    expect(result.strategy).toBe("resume-plan");
    const createArg = taskRunCreate.mock.calls[0]![0] as { data: { a2aMetadata: { retryStrategy: string; priorDeliberationRunId: string } } };
    expect(createArg.data.a2aMetadata.priorDeliberationRunId).toBe("DR-PRIOR");
  });

  it("plan phase with NO prior DeliberationRun → falls back to fresh", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "plan" });
    deliberationRunFindFirst.mockResolvedValue(null);
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-R-3" });
    const result = await taskrunRetry("TR-STALL-1", "op-1");
    expect(result.strategy).toBe("fresh");
    expectMetadata("fresh");
  });

  it("review phase → review-current", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "review" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-R-4" });
    const result = await taskrunRetry("TR-STALL-1", "op-1");
    expect(result.strategy).toBe("review-current");
    expectMetadata("review-current");
  });

  it("ship phase with force → ship-force", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "ship" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-R-5" });
    const result = await taskrunRetry("TR-STALL-1", "op-1", { force: true });
    expect(result.strategy).toBe("ship-force");
    expectMetadata("ship-force");
  });

  it("ideate phase (default) → fresh", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "ideate" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-R-6" });
    const result = await taskrunRetry("TR-STALL-1", "op-1");
    expect(result.strategy).toBe("fresh");
    expectMetadata("fresh");
  });

  it("records the strategy in the StallEvent.notes column", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ phase: "build" });
    stallEventFindFirst.mockResolvedValue({ id: "se-1" });
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-R-7" });
    await taskrunRetry("TR-STALL-1", "op-1");
    const updateArg = stallEventUpdate.mock.calls[0]![0] as { data: { notes?: string } };
    expect(updateArg.data.notes).toMatch(/Build phase.*runBuildPipeline.*resume/);
  });
});

describe("taskrunAbandon", () => {
  it("rejects when the row is not stalled", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), status: "completed" });
    await expect(taskrunAbandon("TR-STALL-1", "op-1")).rejects.toThrow(/Cannot recover.*status is completed/);
  });

  it("transitions the stalled row to canceled", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    await taskrunAbandon("TR-STALL-1", "op-1");
    const firstUpdate = taskRunUpdate.mock.calls[0]![0] as { data: { status: string } };
    expect(firstUpdate.data.status).toBe("canceled");
  });

  it("closes the most recent open StallEvent as 'abandoned'", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    stallEventFindFirst.mockResolvedValue({ id: "se-1" });
    await taskrunAbandon("TR-STALL-1", "op-1");
    const updateArg = stallEventUpdate.mock.calls[0]![0] as { data: { outcome: string } };
    expect(updateArg.data.outcome).toBe("abandoned");
  });

  it("cascades one level to live children with reason=parent_abandoned", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    // Have an open StallEvent on the parent so upsertRecoveryOutcome takes
    // the update path; the cascade-create assertions below stay focused on
    // child synthesis without conflating with parent synthesis.
    stallEventFindFirst.mockResolvedValue({ id: "se-parent-open" });
    taskRunFindMany.mockResolvedValue([
      { id: "cuid-child-1", taskRunId: "TR-CHILD-1", startedAt: new Date(), buildId: null, lastHeartbeatAt: null },
      { id: "cuid-child-2", taskRunId: "TR-CHILD-2", startedAt: new Date(), buildId: null, lastHeartbeatAt: null },
    ]);
    await taskrunAbandon("TR-STALL-1", "op-1");
    // 1 update for parent + 2 for children = 3 total
    expect(taskRunUpdate).toHaveBeenCalledTimes(3);
    // 2 cascade StallEvent rows
    expect(stallEventCreate).toHaveBeenCalledTimes(2);
    const cascadeReasons = stallEventCreate.mock.calls.map(
      (c: unknown[]) => (c[0] as { data: { reason: string } }).data.reason,
    );
    expect(cascadeReasons).toEqual(["parent_abandoned", "parent_abandoned"]);
  });

  it("does not touch terminal children", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    // findMany filters by status: { in: IN_FLIGHT_STATUSES } so terminal
    // children would never be returned — the mock simulates that filter by
    // returning only one live child plus a completed one filtered out.
    taskRunFindMany.mockResolvedValue([
      { id: "cuid-child-1", taskRunId: "TR-CHILD-1", startedAt: new Date(), buildId: null, lastHeartbeatAt: null },
    ]);
    await taskrunAbandon("TR-STALL-1", "op-1");
    // 1 parent + 1 live child = 2 updates total
    expect(taskRunUpdate).toHaveBeenCalledTimes(2);
    // Verify the findMany call used the in-flight filter
    const findManyArg = taskRunFindMany.mock.calls[0]![0] as { where: { status: { in: string[] } } };
    expect(findManyArg.where.status.in).toEqual(["submitted", "working", "input-required", "auth-required"]);
  });
});

describe("taskrunEscalate", () => {
  it("rejects when the row is not stalled", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), status: "completed" });
    await expect(taskrunEscalate("TR-STALL-1", "op-1")).rejects.toThrow(/Cannot recover.*status is completed/);
  });

  it("writes StallEvent.outcome=escalated with notes when provided", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    stallEventFindFirst.mockResolvedValue({ id: "se-1" });
    await taskrunEscalate("TR-STALL-1", "op-1", "Needs human review");
    const updateArg = stallEventUpdate.mock.calls[0]![0] as { data: { outcome: string; notes?: string } };
    expect(updateArg.data.outcome).toBe("escalated");
    expect(updateArg.data.notes).toBe("Needs human review");
  });

  it("does NOT transition the TaskRun status — escalation parks the row", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    await taskrunEscalate("TR-STALL-1", "op-1");
    expect(taskRunUpdate).not.toHaveBeenCalled();
  });

  it("notifies the build owner when buildId resolves to a FeatureBuild.createdById", async () => {
    taskRunFindUnique.mockResolvedValue({ ...stalledRow(), buildId: "FB-1" });
    featureBuildFindUnique.mockResolvedValue({ createdById: "user-owner" });
    await taskrunEscalate("TR-STALL-1", "op-1");
    const notifyArg = notificationCreate.mock.calls[0]![0] as { data: { userId: string; type: string } };
    expect(notifyArg.data.userId).toBe("user-owner");
    expect(notifyArg.data.type).toBe("taskrun.escalated");
  });

  it("falls back to the task's userId when no buildId is present", async () => {
    taskRunFindUnique.mockResolvedValue(stalledRow());
    await taskrunEscalate("TR-STALL-1", "op-1");
    const notifyArg = notificationCreate.mock.calls[0]![0] as { data: { userId: string } };
    expect(notifyArg.data.userId).toBe("user-1");
  });
});

describe("audit completeness — synthesize StallEvent when no open event exists", () => {
  // Caught during F2 UX dogfooding (2026-05-20): the Escalate path fired a
  // Notification but no StallEvent.outcome='escalated' row appeared in the
  // ledger because the watchdog hadn't inserted a fresh open event for that
  // taskRun. Same gap existed for Retry and Abandon. upsertRecoveryOutcome
  // now synthesizes a StallEvent with reason='operator_recovery_synthesized'
  // whenever there's no open event to close.

  function setupNoOpenEvent() {
    // First findUnique call = loadStalled → returns the stalled row.
    // Second findUnique call = upsertRecoveryOutcome lookup for startedAt.
    const startedAt = new Date("2026-05-20T10:00:00Z");
    const lastHeartbeatAt = new Date("2026-05-20T10:00:30Z");
    taskRunFindUnique
      .mockResolvedValueOnce(stalledRow())
      .mockResolvedValueOnce({ startedAt, lastHeartbeatAt });
    stallEventFindFirst.mockResolvedValue(null);
    return { startedAt, lastHeartbeatAt };
  }

  it("Retry synthesizes a StallEvent with outcome='retry' when no open event exists", async () => {
    setupNoOpenEvent();
    taskRunCreate.mockResolvedValue({ taskRunId: "TR-RETRY-SYN" });
    await taskrunRetry("TR-STALL-1", "op-syn");
    expect(stallEventUpdate).not.toHaveBeenCalled();
    expect(stallEventCreate).toHaveBeenCalledTimes(1);
    const createArg = stallEventCreate.mock.calls[0]![0] as {
      data: { outcome: string; reason: string; outcomeBy: string; thresholdHeartbeatS: number; thresholdTotalS: number };
    };
    expect(createArg.data.outcome).toBe("retry");
    expect(createArg.data.reason).toBe("operator_recovery_synthesized");
    expect(createArg.data.outcomeBy).toBe("op-syn");
    expect(createArg.data.thresholdHeartbeatS).toBe(0);
    expect(createArg.data.thresholdTotalS).toBe(0);
  });

  it("Abandon synthesizes a StallEvent with outcome='abandoned' when no open event exists", async () => {
    setupNoOpenEvent();
    await taskrunAbandon("TR-STALL-1", "op-syn");
    // Only the parent abandon synthesize — there are no live children in this setup.
    expect(stallEventCreate).toHaveBeenCalledTimes(1);
    const createArg = stallEventCreate.mock.calls[0]![0] as {
      data: { outcome: string; reason: string; outcomeBy: string };
    };
    expect(createArg.data.outcome).toBe("abandoned");
    expect(createArg.data.reason).toBe("operator_recovery_synthesized");
    expect(createArg.data.outcomeBy).toBe("op-syn");
  });

  it("Escalate synthesizes a StallEvent with outcome='escalated' when no open event exists", async () => {
    setupNoOpenEvent();
    await taskrunEscalate("TR-STALL-1", "op-syn", "operator note");
    expect(stallEventUpdate).not.toHaveBeenCalled();
    expect(stallEventCreate).toHaveBeenCalledTimes(1);
    const createArg = stallEventCreate.mock.calls[0]![0] as {
      data: { outcome: string; reason: string; outcomeBy: string; notes: string };
    };
    expect(createArg.data.outcome).toBe("escalated");
    expect(createArg.data.reason).toBe("operator_recovery_synthesized");
    expect(createArg.data.outcomeBy).toBe("op-syn");
    expect(createArg.data.notes).toBe("operator note");
  });

  it("synthesized StallEvent carries the startedAt and lastHeartbeatAt of the underlying TaskRun", async () => {
    const { startedAt, lastHeartbeatAt } = setupNoOpenEvent();
    await taskrunEscalate("TR-STALL-1", "op-syn");
    const createArg = stallEventCreate.mock.calls[0]![0] as {
      data: { startedAt: Date; lastHeartbeatAt: Date | null };
    };
    expect(createArg.data.startedAt).toEqual(startedAt);
    expect(createArg.data.lastHeartbeatAt).toEqual(lastHeartbeatAt);
  });

  it("synthesized StallEvent tolerates lastHeartbeatAt=null (row never reported a heartbeat)", async () => {
    const startedAt = new Date("2026-05-20T10:00:00Z");
    taskRunFindUnique
      .mockResolvedValueOnce(stalledRow())
      .mockResolvedValueOnce({ startedAt, lastHeartbeatAt: null });
    stallEventFindFirst.mockResolvedValue(null);
    await taskrunEscalate("TR-STALL-1", "op-syn");
    const createArg = stallEventCreate.mock.calls[0]![0] as {
      data: { lastHeartbeatAt: Date | null };
    };
    expect(createArg.data.lastHeartbeatAt).toBeNull();
  });
});
