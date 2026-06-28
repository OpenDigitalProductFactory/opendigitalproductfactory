import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentThread: {
      upsert: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
    },
    agentActionProposal: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { proposeActivityHarnessOverrideAction } from "./activity-harness-routing";
import { ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION } from "@/lib/routing/activity-harness-approval-source";
import { revalidatePath } from "next/cache";

describe("proposeActivityHarnessOverrideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: true },
    } as never);
    vi.mocked(prisma.agentThread.upsert).mockResolvedValue({
      id: "thread-routing",
      userId: "user-1",
      contextKey: "platform:ai:activity-routing",
    } as never);
    vi.mocked(prisma.agentMessage.create).mockResolvedValue({
      id: "message-routing",
    } as never);
    vi.mocked(prisma.agentActionProposal.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.agentActionProposal.create).mockResolvedValue({
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      status: "proposed",
    } as never);
  });

  it("creates a governed AgentActionProposal for an activity harness tuning action", async () => {
    const result = await proposeActivityHarnessOverrideAction({
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      activityClass: "plan",
      harnessRecipeKey: "edge.plan.balanced",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      confidence: "trusted",
      summary: "Promote edge.plan.balanced for plan on anthropic/claude-sonnet after approval.",
    });

    expect(result).toEqual({
      success: true,
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      status: "proposed",
    });
    expect(prisma.agentThread.upsert).toHaveBeenCalledWith({
      where: {
        userId_contextKey: {
          userId: "user-1",
          contextKey: "platform:ai:activity-routing",
        },
      },
      create: {
        userId: "user-1",
        contextKey: "platform:ai:activity-routing",
      },
      update: {},
      select: { id: true },
    });
    expect(prisma.agentMessage.create).toHaveBeenCalledWith({
      data: {
        threadId: "thread-routing",
        role: "assistant",
        content:
          "Approve activity routing change: Promote edge.plan.balanced for plan on anthropic/claude-sonnet after approval.",
        agentId: "activity-routing-governor",
        routeContext: "/platform/ai/operations-map",
        taskType: "activity-routing-governance",
      },
      select: { id: true },
    });
    expect(prisma.agentActionProposal.create).toHaveBeenCalledWith({
      data: {
        proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
        threadId: "thread-routing",
        messageId: "message-routing",
        agentId: "activity-routing-governor",
        actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
        parameters: {
          kind: "activity-harness-confidence-override",
          proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
          activityClass: "plan",
          harnessRecipeKey: "edge.plan.balanced",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          confidence: "trusted",
        },
        status: "proposed",
      },
      select: { proposalId: true, status: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/platform/ai/operations-map");
  });

  it("returns the existing proposal instead of duplicating deterministic routing actions", async () => {
    vi.mocked(prisma.agentActionProposal.findUnique).mockResolvedValue({
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      status: "proposed",
    } as never);

    const result = await proposeActivityHarnessOverrideAction({
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      activityClass: "plan",
      harnessRecipeKey: "edge.plan.balanced",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      confidence: "trusted",
      summary: "Promote edge.plan.balanced for plan on anthropic/claude-sonnet after approval.",
    });

    expect(result).toEqual({
      success: true,
      proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
      status: "proposed",
      existing: true,
    });
    expect(prisma.agentMessage.create).not.toHaveBeenCalled();
    expect(prisma.agentActionProposal.create).not.toHaveBeenCalled();
  });
});
