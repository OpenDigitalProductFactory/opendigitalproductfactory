// BI-287E1DD0: the child-thread job runs the child once, never retries it, and
// its failure path fails the interrupted child from the ORIGINAL event payload.
import { beforeEach, describe, expect, it, vi } from "vitest";

const jobsMock = vi.hoisted(() => ({ createFunction: vi.fn() }));
const runtime = vi.hoisted(() => ({ run: vi.fn(), failInterrupted: vi.fn() }));

vi.mock("@/lib/jobs", () => ({
  jobs: { createFunction: (...args: unknown[]) => jobsMock.createFunction(...args) },
}));
vi.mock("@/lib/tak/child-thread-runtime", () => ({
  runChildThreadExecution: (...args: unknown[]) => runtime.run(...args),
  failInterruptedChildThread: (...args: unknown[]) => runtime.failInterrupted(...args),
}));

const context = { threadId: "child-1", taskRunId: "TR-1", userId: "user-1", agentId: "agent-mkt", routeContext: "/coworker" };

type Defined = {
  config: { id: string; retries: number; concurrency: unknown; onFailure: (args: unknown) => Promise<void> };
  handler: (args: unknown) => Promise<unknown>;
};

async function load(): Promise<Defined> {
  vi.resetModules();
  jobsMock.createFunction.mockImplementation((config, handler) => ({ config, handler }));
  const { agentChildThreadRun } = await import("./agent-child-thread-run");
  return agentChildThreadRun as unknown as Defined;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.run.mockResolvedValue(undefined);
  runtime.failInterrupted.mockResolvedValue(undefined);
});

describe("agent/child-thread-run", () => {
  it("is process-bound: no retries, one run per TaskRun", async () => {
    const fn = await load();
    expect(fn.config).toMatchObject({
      id: "agent/child-thread-run",
      retries: 0,
      concurrency: [{ key: "event.data.taskRunId", limit: 1 }],
    });
  });

  it("runs the child execution inside one step", async () => {
    const fn = await load();
    const step = { run: vi.fn(async (_id: string, body: () => Promise<unknown>) => body()) };
    await expect(fn.handler({ event: { data: context }, step })).resolves.toEqual({ taskRunId: "TR-1" });
    expect(step.run).toHaveBeenCalledWith("run-child-thread", expect.any(Function));
    expect(runtime.run).toHaveBeenCalledWith(context);
  });

  it("fails the interrupted child from the original event on terminal failure", async () => {
    const fn = await load();
    await fn.config.onFailure({
      event: { data: { event: { name: "agent/child-thread.run", data: context } } },
      error: new Error("lease_expired_exhausted: no attempt finished in 1"),
    });
    expect(runtime.failInterrupted).toHaveBeenCalledWith(context, "lease_expired_exhausted: no attempt finished in 1");
  });

  it("ignores a failure event without the original payload", async () => {
    const fn = await load();
    await fn.config.onFailure({ event: { data: {} }, error: new Error("x") });
    expect(runtime.failInterrupted).not.toHaveBeenCalled();
  });
});
