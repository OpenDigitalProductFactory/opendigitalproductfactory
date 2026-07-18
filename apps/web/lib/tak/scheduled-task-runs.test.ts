import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  const create = vi.fn();
  const prisma = { taskRun: { create } };
  return {
    prisma: { ...prisma, $transaction: vi.fn(async (callback) => callback(prisma)) },
  };
});

vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));

describe("createTaskRunForScheduledTask", () => {
  beforeEach(async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockReset();
  });

  it("creates a proactive TaskRun with the scheduled-task source ref", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    } as never);

    const { createTaskRunForScheduledTask } = await import("./scheduled-task-runs");

    const ref = await createTaskRunForScheduledTask({
      taskId: "discovery-taxonomy-gap-triage-daily",
      ownerUserId: "user-1",
      agentId: "inventory-specialist",
      threadId: "thread-1",
      routeContext: "/platform/tools/discovery",
      title: "Discovery Taxonomy Gap Triage",
      prompt: "Triage taxonomy gaps from discovery.",
    });

    expect(ref).toEqual({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    });

    expect(prisma.taskRun.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      userId: "user-1",
      threadId: "thread-1",
      contextId: "thread-1",
      initiatingAgentId: "inventory-specialist",
      currentAgentId: "inventory-specialist",
      routeContext: "/platform/tools/discovery",
      title: "Discovery Taxonomy Gap Triage",
      objective: "Triage taxonomy gaps from discovery.",
      source: "proactive",
      status: "working",
      authorityScope: [],
      a2aMetadata: {
        trigger: "scheduled",
        sourceRef: {
          kind: "scheduled-task",
          id: "discovery-taxonomy-gap-triage-daily",
        },
      },
    });
    expect(String(arg?.data?.taskRunId)).toMatch(/^TR-SCHED-/);
  });

  it("passes scheduled proactivity plans into TaskRun metadata", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_2",
      taskRunId: "TR-SCHED-PROACT",
      contextId: "thread-2",
    } as never);

    const proactivity = {
      resolvedLevel: "balanced" as const,
      policyId: "proactivity:scheduled-task:balanced",
      attentionWindowMinutes: 60,
      followUpCadenceMinutes: [120],
      maxAttempts: 2,
      spendClass: "standard" as const,
      channelPolicy: "preferred-channel" as const,
      escalationTarget: "attention-surface" as const,
      actionBoundary: "propose" as const,
      explanation: "Balanced scheduled follow-up.",
      evidenceRefs: [{ kind: "activity-family", id: "scheduled-task" }],
    };

    const { createTaskRunForScheduledTask } = await import("./scheduled-task-runs");

    await createTaskRunForScheduledTask({
      taskId: "daily-summary",
      ownerUserId: "user-1",
      agentId: "workspace-coworker",
      threadId: "thread-2",
      routeContext: "/workspace",
      title: "Daily Summary",
      prompt: "Summarize today.",
      proactivity,
    });

    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data?.a2aMetadata).toMatchObject({
      trigger: "scheduled",
      proactivity,
    });
  });
});
