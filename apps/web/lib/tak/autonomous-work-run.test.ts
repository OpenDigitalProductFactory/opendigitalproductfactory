import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  const create = vi.fn();
  return {
    prisma: {
      taskRun: { create },
    },
  };
});

describe("createAutonomousWorkRun", () => {
  beforeEach(async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockReset();
  });

  it("creates a scheduled TaskRun through the shared autonomous work seam", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    } as never);

    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    const ref = await createAutonomousWorkRun({
      trigger: "scheduled",
      userId: "user-1",
      agentId: "inventory-specialist",
      routeContext: "/platform/tools/discovery",
      title: "Discovery Taxonomy Gap Triage",
      objective: "Triage taxonomy gaps from discovery.",
      prompt: "Triage taxonomy gaps from discovery.",
      threadId: "thread-1",
      sourceRef: {
        kind: "scheduled-task",
        id: "discovery-taxonomy-gap-triage-daily",
      },
    });

    expect(ref).toEqual({
      id: "tr_internal_1",
      taskRunId: "TR-SCHED-ABCDE",
      contextId: "thread-1",
    });

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

  it("creates capacity-continuity TaskRuns with capacity metadata and no tool execution", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.taskRun.create).mockResolvedValue({
      id: "tr_internal_capacity",
      taskRunId: "TR-CAP-ABCDE",
      contextId: "thread-capacity",
    } as never);

    const { createAutonomousWorkRun } = await import("./autonomous-work-run");

    await createAutonomousWorkRun({
      trigger: "capacity-continuity",
      userId: "principal-1",
      agentId: "platform-engineer",
      routeContext: "/platform/ai/capacity-continuity",
      title: "Review stale specs",
      objective: "Review stale specs and produce evidence-backed follow-up notes.",
      prompt: "Review stale specs and produce evidence-backed follow-up notes.",
      threadId: "thread-capacity",
      sourceRef: {
        kind: "standing-order",
        id: "standing-order-1",
      },
      metadata: {
        cognitiveLoad: {
          capacityState: "away",
          standingOrderId: "standing-order-1",
          dedupeKey: "spec-drift:2026-05-12",
          fundingFitHint: {
            providerClassHint: "fixed-cost",
            modelTierHint: "standard",
          },
        },
      },
    });

    expect(prisma.taskRun.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.taskRun.create).mock.calls[0]?.[0];
    expect(arg?.data).toMatchObject({
      userId: "principal-1",
      source: "proactive",
      status: "working",
      a2aMetadata: {
        trigger: "capacity-continuity",
        sourceRef: {
          kind: "standing-order",
          id: "standing-order-1",
        },
        cognitiveLoad: {
          capacityState: "away",
          standingOrderId: "standing-order-1",
          dedupeKey: "spec-drift:2026-05-12",
          fundingFitHint: {
            providerClassHint: "fixed-cost",
            modelTierHint: "standard",
          },
        },
      },
    });
    expect(String(arg?.data?.taskRunId)).toMatch(/^TR-CAP-/);
  });
});
