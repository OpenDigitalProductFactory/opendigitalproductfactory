import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    modelProvider: { findMany: vi.fn() },
    modelProfile: { findMany: vi.fn() },
    routeDecisionLog: { findMany: vi.fn() },
    routeOutcome: { findMany: vi.fn() },
    scheduledAgentTask: { findMany: vi.fn() },
    scheduledJob: { findMany: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => db);

const providerData = vi.hoisted(() => ({
  getTokenSpendByProvider: vi.fn(),
  getTokenSpendByAgent: vi.fn(),
}));
vi.mock("@/lib/inference/ai-provider-data", () => providerData);

import { loadAiPlatformPosture } from "./get-ai-platform-posture";

function baseMocks() {
  db.prisma.modelProvider.findMany.mockResolvedValue([]);
  db.prisma.modelProfile.findMany.mockResolvedValue([]);
  db.prisma.routeDecisionLog.findMany.mockResolvedValue([]);
  db.prisma.routeOutcome.findMany.mockResolvedValue([]);
  db.prisma.scheduledAgentTask.findMany.mockResolvedValue([]);
  db.prisma.scheduledJob.findMany.mockResolvedValue([]);
  providerData.getTokenSpendByProvider.mockResolvedValue([]);
  providerData.getTokenSpendByAgent.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  baseMocks();
});

describe("loadAiPlatformPosture", () => {
  it("defaults to a 24h window and excludes retired providers/models", async () => {
    const posture = await loadAiPlatformPosture();
    expect(posture.windowHours).toBe(24);
    expect(db.prisma.modelProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retiredAt: null } }),
    );
    expect(db.prisma.modelProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retiredAt: null } }),
    );
  });

  it("caps windowHours at 168 and includes retired rows when requested", async () => {
    const posture = await loadAiPlatformPosture({ windowHours: 9999, includeRetired: true });
    expect(posture.windowHours).toBe(168);
    expect(db.prisma.modelProvider.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(db.prisma.modelProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("ignores a non-positive windowHours and falls back to 24", async () => {
    const posture = await loadAiPlatformPosture({ windowHours: -5 });
    expect(posture.windowHours).toBe(24);
  });

  it("maps provider rows into the posture shape, serializing retiredAt", async () => {
    db.prisma.modelProvider.findMany.mockResolvedValue([
      {
        providerId: "anthropic",
        name: "Anthropic",
        status: "active",
        category: "direct",
        capabilityTier: "frontier",
        costBand: "premium",
        cliEngine: "claude",
        endpointType: "llm",
        avgLatencyMs: 850,
        recentFailureRate: 0.01,
        maxConcurrency: 8,
        toolFidelity: 92,
        reasoning: 95,
        codegen: 90,
        retiredAt: null,
      },
    ]);
    const posture = await loadAiPlatformPosture();
    expect(posture.providers).toEqual([
      {
        providerId: "anthropic",
        name: "Anthropic",
        status: "active",
        category: "direct",
        capabilityTier: "frontier",
        costBand: "premium",
        cliEngine: "claude",
        endpointType: "llm",
        avgLatencyMs: 850,
        recentFailureRate: 0.01,
        maxConcurrency: 8,
        toolFidelity: 92,
        reasoning: 95,
        codegen: 90,
        retiredAt: null,
      },
    ]);
  });

  it("delegates token spend to the existing groupBy readers for the current calendar month", async () => {
    providerData.getTokenSpendByProvider.mockResolvedValue([
      { providerId: "anthropic", providerName: "Anthropic", totalInputTokens: 100, totalOutputTokens: 50, totalCostUsd: 1.5, provenance: {} },
    ]);
    providerData.getTokenSpendByAgent.mockResolvedValue([
      { agentId: "platform-engineer", agentName: "Platform Engineer", totalInputTokens: 40, totalOutputTokens: 20, totalCostUsd: 0.5 },
    ]);
    const posture = await loadAiPlatformPosture();
    expect(providerData.getTokenSpendByProvider).toHaveBeenCalledTimes(1);
    expect(providerData.getTokenSpendByAgent).toHaveBeenCalledTimes(1);
    expect(posture.tokenSpend.byProvider).toEqual([
      { providerId: "anthropic", providerName: "Anthropic", inputTokens: 100, outputTokens: 50, costUsd: 1.5 },
    ]);
    expect(posture.tokenSpend.byAgent).toEqual([
      { agentId: "platform-engineer", agentName: "Platform Engineer", inputTokens: 40, outputTokens: 20, costUsd: 0.5 },
    ]);
  });

  it("computes failover-chain fallback rate from RouteDecisionLog.fallbacksUsed and RouteOutcome.fallbackOccurred", async () => {
    const now = new Date();
    db.prisma.routeDecisionLog.findMany.mockResolvedValue([
      { agentId: "a1", selectedEndpointId: "anthropic:claude-sonnet", selectedModelId: "claude-sonnet", taskType: "code", fallbackChain: ["anthropic", "openai"], fallbacksUsed: ["openai"], createdAt: now },
      { agentId: "a2", selectedEndpointId: "openai:gpt-5", selectedModelId: "gpt-5", taskType: "chat", fallbackChain: [], fallbacksUsed: null, createdAt: now },
    ]);
    db.prisma.routeOutcome.findMany.mockResolvedValue([
      { fallbackOccurred: true, providerErrorCode: "rate_limited" },
      { fallbackOccurred: false, providerErrorCode: null },
    ]);

    const posture = await loadAiPlatformPosture();
    expect(posture.failoverChain.decisionCount).toBe(2);
    expect(posture.failoverChain.fallbacksUsedCount).toBe(1);
    expect(posture.failoverChain.fallbackRate).toBeCloseTo(0.5);
    expect(posture.failoverChain.outcomeCount).toBe(2);
    expect(posture.failoverChain.outcomeFallbackCount).toBe(1);
    expect(posture.failoverChain.outcomeFallbackRate).toBeCloseTo(0.5);
    expect(posture.failoverChain.distinctProviderErrorCodes).toEqual(["rate_limited"]);
    expect(posture.failoverChain.recentFallbackChains).toEqual([
      { agentId: "a1", taskType: "code", chain: ["anthropic", "openai"], occurredAt: now.toISOString() },
    ]);
  });

  it("returns zero rates when there are no route decisions/outcomes in the window", async () => {
    const posture = await loadAiPlatformPosture();
    expect(posture.failoverChain.fallbackRate).toBe(0);
    expect(posture.failoverChain.outcomeFallbackRate).toBe(0);
  });

  it("derives agent-to-provider assignment from the most-routed-to provider per agent", async () => {
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    db.prisma.routeDecisionLog.findMany.mockResolvedValue([
      { agentId: "platform-engineer", selectedEndpointId: "anthropic:claude-sonnet", selectedModelId: "claude-sonnet", taskType: "code", fallbackChain: [], fallbacksUsed: null, createdAt: older },
      { agentId: "platform-engineer", selectedEndpointId: "anthropic:claude-haiku", selectedModelId: "claude-haiku", taskType: "chat", fallbackChain: [], fallbacksUsed: null, createdAt: newer },
      { agentId: "platform-engineer", selectedEndpointId: "openai:gpt-5", selectedModelId: "gpt-5", taskType: "chat", fallbackChain: [], fallbacksUsed: null, createdAt: older },
      { agentId: null, selectedEndpointId: "openai:gpt-5", selectedModelId: "gpt-5", taskType: "chat", fallbackChain: [], fallbacksUsed: null, createdAt: older },
      { agentId: "inventory-specialist", selectedEndpointId: "none", selectedModelId: null, taskType: "chat", fallbackChain: [], fallbacksUsed: null, createdAt: older },
    ]);

    const posture = await loadAiPlatformPosture();
    expect(posture.agentProviderAssignments).toEqual([
      {
        agentId: "platform-engineer",
        currentProviderId: "anthropic",
        currentModelId: "claude-haiku",
        decisionCount: 2,
        lastDecisionAt: newer.toISOString(),
      },
    ]);
  });

  it("summarizes scheduled tasks and jobs with active/failing counts", async () => {
    db.prisma.scheduledAgentTask.findMany.mockResolvedValue([
      { taskId: "agent-task-1", agentId: "platform-engineer", title: "Refresh posture", isActive: true, nextRunAt: null, lastStatus: "ok", lastError: null },
      { taskId: "agent-task-2", agentId: "platform-engineer", title: "Broken task", isActive: true, nextRunAt: null, lastStatus: "error", lastError: "boom" },
      { taskId: "agent-task-3", agentId: "platform-engineer", title: "Inactive task", isActive: false, nextRunAt: null, lastStatus: null, lastError: null },
    ]);
    db.prisma.scheduledJob.findMany.mockResolvedValue([
      { jobId: "job-1", name: "Job 1", schedule: "daily", enabled: true, nextRunAt: null, lastStatus: "ok", lastError: null },
      { jobId: "job-2", name: "Job 2", schedule: "daily", enabled: false, nextRunAt: null, lastStatus: "error", lastError: "boom" },
    ]);

    const posture = await loadAiPlatformPosture();
    expect(posture.scheduledTasks.counts).toEqual({
      activeAgentTasks: 2,
      failingAgentTasks: 1,
      enabledJobs: 1,
      failingJobs: 1,
    });
  });
});
