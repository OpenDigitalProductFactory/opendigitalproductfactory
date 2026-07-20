import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockResolveAgent,
  mockResolveTools,
  mockExecuteLoop,
} = vi.hoisted(() => ({
  mockPrisma: {
    agentThread: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    taskRun: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agentMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    professionCorpusGap: {
      upsert: vi.fn(),
    },
    professionCorpusUsageStat: {
      upsert: vi.fn(),
    },
  },
  mockResolveAgent: vi.fn(),
  mockResolveTools: vi.fn(),
  mockExecuteLoop: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/tak/autonomous-work-run", () => ({
  resolveAutonomousWorkAgent: mockResolveAgent,
  resolveAutonomousWorkTools: mockResolveTools,
  executeAutonomousAgenticLoop: mockExecuteLoop,
}));

import {
  prepareChildExecution,
  runChildThreadExecution,
} from "./agent-thread-dispatcher-runtime";
import {
  buildProviderReviewPacket,
  formatProviderReviewObjective,
} from "@/lib/routing/provider-suitability/provider-review-packet";

const providerObjective = formatProviderReviewObjective(buildProviderReviewPacket({
  businessProfile: {
    organizationId: "org-1",
    archetypeId: "arch-software",
    archetypeCategory: "software",
    operatesIn: ["de", "eu"],
    sellsTo: ["eu"],
    employsIn: [],
    dataResidency: ["eu"],
    riskPosture: "conservative",
  },
  recommendation: {
    status: "review-needed",
    workloadClasses: ["customer-records", "public-marketing"],
    items: [{
      providerConnectionId: "conn-1",
      providerId: "openai",
      scope: "public-only",
    }],
  },
}));

describe("prepareChildExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.agentThread.findUnique.mockResolvedValue({
      id: "child-1",
      userId: "user-1",
      cancelledAt: null,
    });
    mockPrisma.taskRun.findFirst.mockResolvedValue({
      taskRunId: "TR-CHILD-1",
      userId: "user-1",
      status: "submitted",
      currentAgentId: "agent-mkt",
      initiatingAgentId: "agent-mkt",
      routeContext: "/coworker",
    });
    mockPrisma.taskRun.update.mockResolvedValue({});
  });

  it("transitions submitted task run to working and returns context", async () => {
    const ctx = await prepareChildExecution("child-1", "user-1");

    expect(ctx).toEqual({
      threadId: "child-1",
      taskRunId: "TR-CHILD-1",
      userId: "user-1",
      agentId: "agent-mkt",
      routeContext: "/coworker",
    });
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CHILD-1" },
      data: expect.objectContaining({
        status: "working",
        currentAgentId: "agent-mkt",
        startedAt: expect.any(Date),
        lastHeartbeatAt: expect.any(Date),
      }),
    });
  });

  it("rejects when thread is missing", async () => {
    mockPrisma.agentThread.findUnique.mockResolvedValue(null);
    await expect(prepareChildExecution("child-1", "user-1")).rejects.toThrow(/not found/);
    expect(mockPrisma.taskRun.update).not.toHaveBeenCalled();
  });

  it("rejects when thread is owned by another user", async () => {
    mockPrisma.agentThread.findUnique.mockResolvedValue({
      id: "child-1",
      userId: "user-2",
      cancelledAt: null,
    });
    await expect(prepareChildExecution("child-1", "user-1")).rejects.toThrow(/owned by another user/);
    expect(mockPrisma.taskRun.update).not.toHaveBeenCalled();
  });

  it("rejects when thread is cancelled", async () => {
    mockPrisma.agentThread.findUnique.mockResolvedValue({
      id: "child-1",
      userId: "user-1",
      cancelledAt: new Date("2026-05-18T00:00:00.000Z"),
    });
    await expect(prepareChildExecution("child-1", "user-1")).rejects.toThrow(/cancelled/);
  });

  it("rejects when no task run exists for thread", async () => {
    mockPrisma.taskRun.findFirst.mockResolvedValue(null);
    await expect(prepareChildExecution("child-1", "user-1")).rejects.toThrow(/no task run/);
  });

  it("rejects when task run is already terminal", async () => {
    mockPrisma.taskRun.findFirst.mockResolvedValue({
      taskRunId: "TR-CHILD-1",
      userId: "user-1",
      status: "completed",
      currentAgentId: "agent-mkt",
      initiatingAgentId: "agent-mkt",
      routeContext: "/coworker",
    });
    await expect(prepareChildExecution("child-1", "user-1")).rejects.toThrow(/terminal/);
    expect(mockPrisma.taskRun.update).not.toHaveBeenCalled();
  });

  it("falls back to initiatingAgentId then to platform-coworker", async () => {
    mockPrisma.taskRun.findFirst.mockResolvedValue({
      taskRunId: "TR-CHILD-2",
      userId: "user-1",
      status: "submitted",
      currentAgentId: null,
      initiatingAgentId: null,
      routeContext: null,
    });
    const ctx = await prepareChildExecution("child-1", "user-1");
    expect(ctx.agentId).toBe("platform-coworker");
    expect(ctx.routeContext).toBe("/coworker");
  });
});

describe("runChildThreadExecution", () => {
  const ctx = {
    threadId: "child-1",
    taskRunId: "TR-CHILD-1",
    userId: "user-1",
    agentId: "agent-mkt",
    routeContext: "/coworker",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.agentMessage.findMany.mockResolvedValue([
      { role: "user", content: "Research segment A" },
    ]);
    mockPrisma.agentMessage.create.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({ isSuperuser: true });
    mockPrisma.taskRun.update.mockResolvedValue({});
    mockPrisma.agentThread.update.mockResolvedValue({});
    mockPrisma.agentThread.findUnique.mockResolvedValue(null);
    mockPrisma.taskRun.findUnique.mockResolvedValue(null);
    mockResolveAgent.mockResolvedValue({
      agentId: "agent-mkt",
      systemPrompt: "You are the marketing specialist.",
      sensitivity: "internal",
    });
    mockResolveTools.mockResolvedValue({ tools: [], toolsForProvider: [] });
    mockExecuteLoop.mockResolvedValue({
      content: "Segment A analysis complete.",
      executedTools: [{ name: "search_wiki" }],
    });
  });

  it("runs the agentic loop, persists the assistant message, and marks completed", async () => {
    await runChildThreadExecution(ctx);

    expect(mockResolveAgent).toHaveBeenCalledWith({
      agentId: "agent-mkt",
      routeContext: "/coworker",
      userContext: { userId: "user-1", platformRole: null, isSuperuser: true },
    });
    expect(mockExecuteLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "child-1",
        taskRunId: "TR-CHILD-1",
        agentId: "agent-mkt",
        chatHistory: [{ role: "user", content: "Research segment A" }],
      }),
    );
    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "child-1",
        taskRunId: "TR-CHILD-1",
        role: "assistant",
        content: "Segment A analysis complete.",
      }),
    });
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CHILD-1" },
      data: expect.objectContaining({
        status: "completed",
        currentAgentId: "agent-mkt",
        progressPayload: {
          summary: "Segment A analysis complete.",
          executedToolCount: 1,
        },
      }),
    });
    expect(mockPrisma.agentThread.update).not.toHaveBeenCalled();
  });

  it("marks failed and records terminalError when the agentic loop throws", async () => {
    mockExecuteLoop.mockRejectedValue(new Error("provider unavailable"));

    await runChildThreadExecution(ctx);

    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CHILD-1" },
      data: expect.objectContaining({
        status: "failed",
        progressPayload: { error: "provider unavailable" },
      }),
    });
    expect(mockPrisma.agentThread.update).toHaveBeenCalledWith({
      where: { id: "child-1" },
      data: expect.objectContaining({
        terminalError: expect.objectContaining({ message: "provider unavailable" }),
      }),
    });
  });

  it("marks failed when chat history is empty", async () => {
    mockPrisma.agentMessage.findMany.mockResolvedValue([]);

    await runChildThreadExecution(ctx);

    expect(mockExecuteLoop).not.toHaveBeenCalled();
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CHILD-1" },
      data: expect.objectContaining({ status: "failed" }),
    });
  });

  it("falls back to (no response) when loop returns empty content", async () => {
    mockExecuteLoop.mockResolvedValue({ content: "", executedTools: [] });

    await runChildThreadExecution(ctx);

    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: "(no response)" }),
    });
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CHILD-1" },
      data: expect.objectContaining({ status: "completed" }),
    });
  });

  it("returns a validated provider advisory to the parent in the COO voice", async () => {
    const specialistReply = JSON.stringify({
      schemaVersion: "provider-compliance-advisory.v1",
      decision: "conditional",
      plainLanguageSummary: "Use only after the business terms and EU processing region are verified.",
      safestNextAction: "Obtain the signed business terms.",
      workloadRestrictions: ["Do not send customer records."],
      unknowns: ["Retention terms are not evidenced."],
      humanReviewRequired: true,
      citations: [{
        title: "GDPR Article 28",
        reference: "eu/gdpr-controller-processor-and-transfers",
        sourceClaimId: "eu-controller-processor-contract-required",
        supports: "A processor contract is required for this customer-record workload.",
      }],
    });
    mockExecuteLoop.mockResolvedValue({ content: specialistReply, executedTools: [] });
    mockPrisma.agentThread.findUnique.mockResolvedValue({ parentThreadId: "parent-1" });
    mockPrisma.taskRun.findUnique.mockResolvedValue({
      a2aMetadata: {
        collaboration: {
          kind: "handoff",
          fromAgentId: "coo",
          toAgentId: "AGT-902",
          enteredVia: "handoff",
          tier: 2,
          summary: "Reviewing provider compliance and sovereignty",
        },
      },
    });
    mockPrisma.agentMessage.findMany.mockResolvedValue([{ role: "user", content: providerObjective }]);

    await runChildThreadExecution({ ...ctx, agentId: "AGT-902", routeContext: "/workspace" });

    expect(mockExecuteLoop).toHaveBeenCalledWith(expect.objectContaining({
      taskType: "provider-compliance-onboarding",
      modelRequirements: expect.objectContaining({
        residencyPolicy: "local_only",
        defaultBudgetClass: "minimize_cost",
      }),
    }));

    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "parent-1",
        role: "assistant",
        agentId: "coo",
        routeContext: "/workspace",
        content: expect.stringContaining("My recommendation: conditional"),
      }),
    });
    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: expect.stringContaining("EUR-Lex") }),
    });
  });

  it("returns a safe non-approval when the provider specialist output is ungrounded", async () => {
    mockExecuteLoop.mockResolvedValue({ content: "It should probably be fine.", executedTools: [] });
    mockPrisma.agentThread.findUnique.mockResolvedValue({ parentThreadId: "parent-1" });
    mockPrisma.taskRun.findUnique.mockResolvedValue({
      a2aMetadata: {
        collaboration: {
          kind: "handoff",
          fromAgentId: "coo",
          toAgentId: "AGT-902",
          enteredVia: "handoff",
          tier: 2,
          summary: "Reviewing provider compliance and sovereignty",
        },
      },
    });
    mockPrisma.agentMessage.findMany.mockResolvedValue([{ role: "user", content: providerObjective }]);

    await runChildThreadExecution({ ...ctx, agentId: "AGT-902", routeContext: "/workspace" });

    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "parent-1",
        role: "assistant",
        agentId: "coo",
        content: expect.stringMatching(/insufficient-evidence[\s\S]*connected account/i),
      }),
    });
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CHILD-1" },
      data: expect.objectContaining({
        status: "completed",
        progressPayload: expect.objectContaining({
          providerCompliance: {
            policyVersion: "provider-compliance-local-only.v1",
            corpusVersion: "professions/legal-compliance/ai-provider-account-and-sovereignty-review@v1",
            advisorySchemaVersion: "provider-compliance-advisory.v1",
            resultSource: "deterministic-fallback",
          },
        }),
      }),
    });
    expect(JSON.stringify(mockPrisma.taskRun.update.mock.calls)).not.toContain("org-1");
  });

  it("returns deterministic cited guidance when the local model is unavailable", async () => {
    mockExecuteLoop.mockRejectedValue(new Error("No local endpoint can satisfy residency policy"));
    mockPrisma.agentMessage.findMany.mockResolvedValue([{ role: "user", content: providerObjective }]);
    mockPrisma.agentThread.findUnique.mockResolvedValue({ parentThreadId: "parent-1" });
    mockPrisma.taskRun.findUnique.mockResolvedValue({
      a2aMetadata: {
        collaboration: {
          kind: "handoff",
          fromAgentId: "coo",
          toAgentId: "AGT-902",
          enteredVia: "handoff",
          tier: 2,
          summary: "Reviewing provider compliance and sovereignty",
        },
      },
    });

    await runChildThreadExecution({ ...ctx, agentId: "AGT-902", routeContext: "/workspace" });

    expect(mockPrisma.agentThread.update).not.toHaveBeenCalled();
    expect(mockPrisma.taskRun.update).toHaveBeenCalledWith({
      where: { taskRunId: "TR-CHILD-1" },
      data: expect.objectContaining({
        status: "completed",
        progressPayload: expect.objectContaining({
          providerCompliance: expect.objectContaining({ resultSource: "deterministic-fallback" }),
        }),
      }),
    });
    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "parent-1",
        content: expect.stringMatching(/insufficient-evidence.*References/s),
      }),
    });
  });
});
