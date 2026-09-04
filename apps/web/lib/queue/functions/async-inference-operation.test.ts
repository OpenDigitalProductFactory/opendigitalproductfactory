import { beforeEach, describe, expect, it, vi } from "vitest";

const inngestMock = vi.hoisted(() => ({ createFunction: vi.fn() }));
const runtime = vi.hoisted(() => ({
  runWake: vi.fn(),
  reconcile: vi.fn(),
  publish: vi.fn(),
}));
const taskTransition = vi.hoisted(() => ({ settle: vi.fn() }));
const quiescence = vi.hoisted(() => ({
  between: vi.fn(),
  atEntry: vi.fn(),
}));

vi.mock("../inngest-client", () => ({
  inngest: { createFunction: (...args: unknown[]) => inngestMock.createFunction(...args) },
}));
vi.mock("@/lib/inference/async-operation-runtime", () => ({
  runPrismaAsyncOperationWake: (...args: unknown[]) => runtime.runWake(...args),
  reconcilePrismaAsyncOperationWakes: (...args: unknown[]) => runtime.reconcile(...args),
  publishPrismaAsyncOperationTransitions: (...args: unknown[]) => runtime.publish(...args),
}));
vi.mock("@/lib/mcp-task-durable-inference-transition", () => ({
  settleDurableInferenceTaskTransition: (...args: unknown[]) => taskTransition.settle(...args),
}));
vi.mock("../quiescence-gates", () => ({
  gateBetweenSteps: (...args: unknown[]) => quiescence.between(...args),
  gateAtEntry: (...args: unknown[]) => quiescence.atEntry(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DPF_ASYNC_OPERATION_WORKER_ENABLED;
  inngestMock.createFunction.mockImplementation((config, handler) => ({ config, handler }));
  runtime.runWake.mockResolvedValue({ status: "running", disposition: "progress" });
  runtime.reconcile.mockResolvedValue({ inspected: 1, enqueued: 1 });
  runtime.publish.mockResolvedValue({ delivered: 1 });
  taskTransition.settle.mockResolvedValue({ status: "completed", taskRunId: "TR-1", settled: true });
  quiescence.between.mockResolvedValue({ resumedAfterWait: false });
  quiescence.atEntry.mockResolvedValue({ proceed: true });
});

type Step = {
  run(name: string, fn: () => Promise<unknown>): Promise<unknown>;
  sleepUntil(name: string, time: Date): Promise<void>;
};

const sleepUntil = vi.fn().mockResolvedValue(undefined);
const step: Step = {
  run: async (_name, fn) => fn(),
  sleepUntil,
};

describe("durable async inference Inngest ownership", () => {
  it("binds each advisory wake to one database-owned operation", async () => {
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const registered = module.asyncInferenceOperationRun as unknown as {
      config: Record<string, unknown>;
      handler(input: {
        event: { data: { operationId: string; notBefore: string } };
        step: Step;
      }): Promise<unknown>;
    };

    expect(registered.config).toMatchObject({
      id: "inference/async-operation-run",
      retries: 2,
      triggers: [{ event: "inference/async-operation.run" }],
      concurrency: [{ key: "event.data.operationId", limit: 1 }],
    });
    const notBefore = "2026-09-04T12:00:30.000Z";
    await registered.handler({ event: { data: { operationId: "op-1", notBefore } }, step });
    expect(sleepUntil).toHaveBeenCalledWith("wait-until-operation-due", new Date(notBefore));
    expect(runtime.runWake).toHaveBeenCalledWith(expect.objectContaining({ operationId: "op-1" }));
    expect(runtime.publish).toHaveBeenCalledOnce();
  });

  it("recovers lost wakes from a bounded scheduled scan", async () => {
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const registered = module.asyncInferenceOperationReconciliation as unknown as {
      config: Record<string, unknown>;
      handler(input: { step: Step }): Promise<unknown>;
    };

    expect(registered.config).toMatchObject({
      id: "inference/async-operation-reconciliation",
      concurrency: { limit: 1, scope: "fn" },
    });
    await registered.handler({ step });
    expect(runtime.reconcile).toHaveBeenCalledWith({ limit: 50 });
  });

  it("rejects an advisory wake without a bounded delivery time", async () => {
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const registered = module.asyncInferenceOperationRun as unknown as {
      handler(input: {
        event: { data: { operationId: string; notBefore?: string } };
        step: Step;
      }): Promise<unknown>;
    };

    await expect(registered.handler({
      event: { data: { operationId: "op-1", notBefore: "not-a-date" } },
      step,
    })).rejects.toThrow("ASYNC_OPERATION_EVENT_NOT_BEFORE_INVALID");
    expect(runtime.runWake).not.toHaveBeenCalled();
  });

  it("does not call a provider after the between-step quiescence wait times out", async () => {
    quiescence.between.mockResolvedValueOnce({
      resumedAfterWait: false,
      reason: "timed-out-waiting-for-cleared",
    });
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const registered = module.asyncInferenceOperationRun as unknown as {
      handler(input: {
        event: { data: { operationId: string; notBefore: string } };
        step: Step;
      }): Promise<unknown>;
    };

    await expect(registered.handler({
      event: {
        data: { operationId: "op-1", notBefore: "2026-09-04T12:00:30.000Z" },
      },
      step,
    })).rejects.toThrow(
      "Async operation remained quiesced: timed-out-waiting-for-cleared",
    );
    expect(runtime.runWake).not.toHaveBeenCalled();
    expect(runtime.publish).not.toHaveBeenCalled();
  });

  it("publishes the transition outbox on an independently recoverable cadence", async () => {
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const registered = module.asyncInferenceOperationOutbox as unknown as {
      config: Record<string, unknown>;
      handler(input: { step: Step }): Promise<unknown>;
    };

    expect(registered.config).toMatchObject({
      id: "inference/async-operation-outbox",
      concurrency: { limit: 1, scope: "fn" },
    });
    await registered.handler({ step });
    expect(runtime.publish).toHaveBeenCalledWith({ limit: 50 });
  });

  it("settles a bound MCP TaskRun from the transition event through its scoped consumer", async () => {
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const registered = module.asyncInferenceOperationTaskRunTransition as unknown as {
      config: Record<string, unknown>;
      handler(input: {
        event: { data: { operationId: string; sequence: number; status: string } };
        step: Step;
      }): Promise<unknown>;
    };

    expect(registered.config).toMatchObject({
      id: "mcp/task-run-durable-inference-transition",
      triggers: [{ event: "inference/async-operation.transitioned" }],
      concurrency: [{ key: "event.data.operationId", limit: 1 }],
    });
    await registered.handler({
      event: { data: { operationId: "op-1", sequence: 3, status: "completed" } },
      step,
    });
    expect(taskTransition.settle).toHaveBeenCalledWith({
      operationId: "op-1",
      sequence: 3,
      status: "completed",
    });
  });

  it("does not settle a TaskRun while the transition consumer remains quiesced", async () => {
    quiescence.between.mockResolvedValueOnce({
      resumedAfterWait: false,
      reason: "timed-out-waiting-for-cleared",
    });
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const registered = module.asyncInferenceOperationTaskRunTransition as unknown as {
      handler(input: {
        event: { data: { operationId: string; sequence: number; status: string } };
        step: Step;
      }): Promise<unknown>;
    };

    await expect(registered.handler({
      event: { data: { operationId: "op-1", sequence: 3, status: "completed" } },
      step,
    })).rejects.toThrow(
      "Durable TaskRun transition remained quiesced: timed-out-waiting-for-cleared",
    );
    expect(taskTransition.settle).not.toHaveBeenCalled();
  });

  it("keeps durable rows intact while the worker and wake recovery are disabled", async () => {
    process.env.DPF_ASYNC_OPERATION_WORKER_ENABLED = "false";
    vi.resetModules();
    const module = await import("./async-inference-operation");
    const run = module.asyncInferenceOperationRun as unknown as {
      handler(input: {
        event: { data: { operationId: string; notBefore: string } };
        step: Step;
      }): Promise<unknown>;
    };
    const recovery = module.asyncInferenceOperationReconciliation as unknown as {
      handler(input: { step: Step }): Promise<unknown>;
    };

    await expect(run.handler({
      event: {
        data: { operationId: "op-1", notBefore: "2026-09-04T12:00:30.000Z" },
      },
      step,
    }))
      .resolves.toEqual({ skipped: true, reason: "async-operation-worker-disabled" });
    await expect(recovery.handler({ step }))
      .resolves.toEqual({ skipped: true, reason: "async-operation-worker-disabled" });
    expect(runtime.runWake).not.toHaveBeenCalled();
    expect(runtime.reconcile).not.toHaveBeenCalled();
  });
});
