import { beforeEach, describe, expect, it, vi } from "vitest";

const inngestMock = vi.hoisted(() => ({ createFunction: vi.fn() }));
const worker = vi.hoisted(() => ({ execute: vi.fn() }));
const dispatch = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock("../inngest-client", () => ({
  inngest: { createFunction: (...args: unknown[]) => inngestMock.createFunction(...args) },
}));
vi.mock("@/lib/mcp-task-background-worker", () => ({
  executePersistedRemoteTask: (...args: unknown[]) => worker.execute(...args),
}));
vi.mock("@/lib/mcp-task-background-dispatch", () => ({
  REMOTE_TASK_EXECUTION_EVENT: "mcp/task-run.execute",
  externalMcpTaskAsyncEnabled: vi.fn().mockReturnValue(true),
  reconcilePersistedRemoteTaskDispatches: (...args: unknown[]) => dispatch.reconcile(...args),
}));
vi.mock("../quiescence-gates", () => ({
  gateBetweenSteps: vi.fn().mockResolvedValue({ resumedAfterWait: false }),
  gateAtEntry: vi.fn().mockResolvedValue({ proceed: true }),
}));
vi.mock("../admission", () => ({
  buildPipelineConcurrency: vi.fn().mockReturnValue({ limit: 4 }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  inngestMock.createFunction.mockImplementation((config, handler) => ({ config, handler }));
  worker.execute.mockResolvedValue({ status: "completed", taskRunId: "TR-1" });
  dispatch.reconcile.mockResolvedValue({ scanned: 1, enqueued: 1, exhausted: 0, raced: 0 });
});

describe("mcp task-run background execution function", () => {
  it("binds the deterministic event to the persisted TaskRun worker", async () => {
    vi.resetModules();
    const module = await import("./mcp-task-run-execute");
    const registered = module.mcpTaskRunExecute as unknown as {
      config: Record<string, unknown>;
      handler: (input: {
        event: { data: { taskRunId: string } };
        step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> };
      }) => Promise<unknown>;
    };

    expect(registered.config).toMatchObject({
      id: "mcp/task-run-execute",
      retries: 2,
      triggers: [{ event: "mcp/task-run.execute" }],
    });
    await registered.handler({
      event: { data: { taskRunId: "TR-1" } },
      step: { run: async (_name, fn) => fn() },
    });
    expect(worker.execute).toHaveBeenCalledWith({ taskRunId: "TR-1" });
  });

  it("reconciles stale submitted TaskRuns on the bounded scheduled path", async () => {
    vi.resetModules();
    const module = await import("./mcp-task-run-execute");
    const registered = module.mcpTaskRunDispatchReconciliation as unknown as {
      config: Record<string, unknown>;
      handler: (input: {
        step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> };
      }) => Promise<unknown>;
    };

    expect(registered.config).toMatchObject({
      id: "mcp/task-run-dispatch-reconciliation",
    });
    await registered.handler({
      step: { run: async (_name, fn) => fn() },
    });
    expect(dispatch.reconcile).toHaveBeenCalledTimes(1);
  });
});
