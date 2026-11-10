import { beforeEach, describe, expect, it, vi } from "vitest";

import { DURABLE_INFERENCE_TASK_CONTRACT_FAMILY } from "@/lib/mcp-task-durable-inference-contract";
import {
  admitWorkroomBoundDurableTaskOperation,
  canonicalWorkroomDurableTaskRunId,
  type WorkroomDurableTaskAdmissionDependencies,
} from "./async-operation-workroom-task";

const requestDigest = "d".repeat(64);
const screenedRequestDigest = "s".repeat(64);

const input = {
  providerId: "gemini",
  modelId: "gemini-3.1-pro-preview",
  contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  screenedRequestDigest,
  screenedRequestContext: {
    version: 1,
    messages: [{ role: "user", content: "Complete the bounded acceptance." }],
    systemPrompt: "Return only the final answer.",
    executionPlan: {
      providerId: "gemini",
      modelId: "gemini-3.1-pro-preview",
      recipeId: "execution-recipe-row-1",
      contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
      executionAdapter: "async",
    },
    dispatchScreen: { schemaVersion: 1 },
    attribution: {
      traceId: "trace-1",
      agentId: "AGT-WS-REVIEW",
      threadId: "thread-1",
    },
  },
  expiresAt: new Date(Date.now() + 15 * 60_000),
  request: {
    kind: "workroom" as const,
    workroomId: "WC-TASK-HUB",
    requestKey: "live-acceptance:task-hub:1",
    requestDigest,
  },
  actor: {
    userId: "user-1",
    agentId: "AGT-WS-REVIEW",
    principalId: "principal-1",
    isSuperuser: false,
  },
};

function dependencies(): WorkroomDurableTaskAdmissionDependencies {
  return {
    resolveWorkroom: vi.fn().mockResolvedValue({
      id: "workroom-row-1",
      capsuleId: "WC-TASK-HUB",
      title: "Async completion delivery task hub",
      objective: "Deliver one durable transition to the Task Hub.",
    }),
    createOrReplayTaskRun: vi.fn().mockResolvedValue({
      id: "task-row-1",
      taskRunId: canonicalWorkroomDurableTaskRunId({
        workroomId: "workroom-row-1",
        requestKey: input.request.requestKey,
        requestDigest,
      }),
      replayed: false,
    }),
    admitTaskRunOperation: vi.fn().mockResolvedValue({
      operationId: "async-op-1",
      replayed: false,
    }),
    projectTaskRunAdmission: vi.fn().mockResolvedValue({ shouldEnqueue: true }),
    enqueue: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Workroom-bound closed durable task admission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the canonical TaskRun before admitting and waking the provider operation", async () => {
    const deps = dependencies();

    await expect(admitWorkroomBoundDurableTaskOperation(input, deps)).resolves.toEqual({
      operationId: "async-op-1",
      taskRunId: expect.stringMatching(/^TR-ASYNC-[A-F0-9]{24}$/u),
      replayed: false,
    });

    const taskRunId = canonicalWorkroomDurableTaskRunId({
      workroomId: "workroom-row-1",
      requestKey: input.request.requestKey,
      requestDigest,
    });
    expect(deps.resolveWorkroom).toHaveBeenCalledWith({
      request: input.request,
      actor: input.actor,
    });
    expect(deps.createOrReplayTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId,
      userId: "user-1",
      agentId: "AGT-WS-REVIEW",
      workroom: expect.objectContaining({ id: "workroom-row-1", capsuleId: "WC-TASK-HUB" }),
      requestKey: input.request.requestKey,
      requestDigest,
      routingRecipeId: "execution-recipe-row-1",
    }));
    expect(deps.admitTaskRunOperation).toHaveBeenCalledWith(expect.objectContaining({
      request: {
        kind: "task-run",
        taskRunId,
        requestKey: input.request.requestKey,
        requestDigest,
      },
      actor: input.actor,
      deferInitialWake: true,
    }));
    expect(deps.projectTaskRunAdmission).toHaveBeenCalledWith({
      taskRunId,
      requestKey: input.request.requestKey,
      requestDigest,
      operationId: "async-op-1",
      routingRecipeId: "execution-recipe-row-1",
      now: expect.any(Date),
    });
    expect(deps.enqueue).toHaveBeenCalledWith("async-op-1");
    expect(vi.mocked(deps.createOrReplayTaskRun).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.admitTaskRunOperation).mock.invocationCallOrder[0]);
    expect(vi.mocked(deps.projectTaskRunAdmission).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.enqueue).mock.invocationCallOrder[0]);
  });

  it("reuses one TaskRun and operation without emitting another wake after durable projection", async () => {
    const deps = dependencies();
    vi.mocked(deps.createOrReplayTaskRun).mockResolvedValueOnce({
      id: "task-row-1",
      taskRunId: canonicalWorkroomDurableTaskRunId({
        workroomId: "workroom-row-1",
        requestKey: input.request.requestKey,
        requestDigest,
      }),
      replayed: true,
    });
    vi.mocked(deps.admitTaskRunOperation).mockResolvedValueOnce({
      operationId: "async-op-1",
      replayed: true,
    });
    vi.mocked(deps.projectTaskRunAdmission).mockResolvedValueOnce({ shouldEnqueue: false });

    await expect(admitWorkroomBoundDurableTaskOperation(input, deps)).resolves.toMatchObject({
      operationId: "async-op-1",
      replayed: true,
    });

    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("stops before TaskRun creation when server Workroom authorization is denied", async () => {
    const deps = dependencies();
    vi.mocked(deps.resolveWorkroom).mockRejectedValueOnce(
      new Error("ASYNC_OPERATION_AUTHORITY_DENIED"),
    );

    await expect(admitWorkroomBoundDurableTaskOperation(input, deps))
      .rejects.toThrow("ASYNC_OPERATION_AUTHORITY_DENIED");

    expect(deps.createOrReplayTaskRun).not.toHaveBeenCalled();
    expect(deps.admitTaskRunOperation).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("refuses missing human attribution before any durable write", async () => {
    const deps = dependencies();

    await expect(admitWorkroomBoundDurableTaskOperation({
      ...input,
      actor: { ...input.actor, userId: null },
    }, deps)).rejects.toThrow("DURABLE_INFERENCE_WORKROOM_USER_REQUIRED");

    expect(deps.resolveWorkroom).not.toHaveBeenCalled();
    expect(deps.createOrReplayTaskRun).not.toHaveBeenCalled();
  });

  it("refuses attribution drift before authorizing or dispatching", async () => {
    const deps = dependencies();

    await expect(admitWorkroomBoundDurableTaskOperation({
      ...input,
      actor: { ...input.actor, agentId: "AGT-FORGED" },
    }, deps)).rejects.toThrow("DURABLE_INFERENCE_WORKROOM_AGENT_MISMATCH");

    expect(deps.resolveWorkroom).not.toHaveBeenCalled();
    expect(deps.admitTaskRunOperation).not.toHaveBeenCalled();
  });

  it("does not admit or wake when the Workroom TaskRun link conflicts", async () => {
    const deps = dependencies();
    vi.mocked(deps.createOrReplayTaskRun).mockRejectedValueOnce(
      new Error("DURABLE_INFERENCE_WORKROOM_TASKRUN_BINDING_CONFLICT"),
    );

    await expect(admitWorkroomBoundDurableTaskOperation(input, deps))
      .rejects.toThrow("DURABLE_INFERENCE_WORKROOM_TASKRUN_BINDING_CONFLICT");

    expect(deps.admitTaskRunOperation).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("does not wake when TaskRun projection rejects operation identity drift", async () => {
    const deps = dependencies();
    vi.mocked(deps.projectTaskRunAdmission).mockRejectedValueOnce(
      new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH"),
    );

    await expect(admitWorkroomBoundDurableTaskOperation(input, deps))
      .rejects.toThrow("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");

    expect(deps.enqueue).not.toHaveBeenCalled();
  });
});
