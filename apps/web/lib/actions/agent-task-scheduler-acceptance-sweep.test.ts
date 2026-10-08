import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    scheduledAgentTask: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    scheduledJob: { updateMany: vi.fn(), update: vi.fn() },
  },
  runDeterministicScheduledTaskKind: vi.fn(),
  runAgenticLoop: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: mocks.prisma,
  DATA_MODEL_MIRROR_TASK_ID: "data-model-mirror-nightly",
  SYSML_PROJECTION_TASK_ID: "sysml-projection-nightly",
  SELF_OPTIMIZATION_SWEEP_TASK_ID: "self-optimization-sweep-weekly",
}));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: mocks.runAgenticLoop }));
vi.mock("./agent-task-scheduler-deterministic", () => ({
  runDeterministicScheduledTaskKind: mocks.runDeterministicScheduledTaskKind,
}));

import { executeScheduledAgentTask } from "./agent-task-scheduler";

// AC-S2-1 (BI-DF255666): the scheduler dispatches the acceptance sweep to its
// deterministic executor with no model call, and only after the guarded claim
// that makes a due tick single-flight (BI-D1CD3A11).

const sweepTask = {
  taskId: "acceptance-sweep-daily",
  taskKind: "acceptance-sweep",
  isActive: true,
  schedule: "0 5 * * *",
  ownerUserId: "user-1",
  agentId: "AGT-WS-PORTFOLIO",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.scheduledAgentTask.findUnique.mockResolvedValue(sweepTask);
  mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
  mocks.runDeterministicScheduledTaskKind.mockResolvedValue(true);
});

describe("executeScheduledAgentTask — acceptance sweep", () => {
  it("claims the due tick, then hands the task to the deterministic branch and never the LLM loop", async () => {
    await executeScheduledAgentTask("acceptance-sweep-daily");

    expect(mocks.runDeterministicScheduledTaskKind).toHaveBeenCalledWith(sweepTask);
    expect(mocks.prisma.scheduledAgentTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runDeterministicScheduledTaskKind.mock.invocationCallOrder[0]!,
    );
    expect(mocks.runAgenticLoop).not.toHaveBeenCalled();
  });

  it("does not run the sweep when a concurrent dispatch already claimed the tick", async () => {
    mocks.prisma.scheduledAgentTask.updateMany.mockResolvedValue({ count: 0 });
    await executeScheduledAgentTask("acceptance-sweep-daily");
    expect(mocks.runDeterministicScheduledTaskKind).not.toHaveBeenCalled();
  });
});
