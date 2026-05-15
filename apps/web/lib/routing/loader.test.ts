import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistRouteDecision } from "./loader";
import type { RouteDecision } from "./types";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    routeDecisionLog: {
      create: vi.fn().mockResolvedValue({ id: "decision-log-1" }),
    },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

describe("persistRouteDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.routeDecisionLog.create.mockResolvedValue({ id: "decision-log-1" });
  });

  it("rejects new route decision logs without an explicit actor", async () => {
    await expect(persistRouteDecision(makeDecision())).rejects.toThrow(
      /RouteDecisionLog requires an actor/,
    );

    expect(mockPrisma.routeDecisionLog.create).not.toHaveBeenCalled();
  });

  it("persists agent attribution as both the actor and coworker id", async () => {
    await persistRouteDecision(makeDecision(), { actor: { kind: "agent", id: "build-specialist" } });

    expect(mockPrisma.routeDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorKind: "agent",
        actorId: "build-specialist",
        agentId: "build-specialist",
      }),
    });
  });

  it("persists explicit non-coworker actors without inventing a coworker id", async () => {
    await persistRouteDecision(makeDecision(), { actor: { kind: "system", id: "routing-evaluator" } });

    expect(mockPrisma.routeDecisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorKind: "system",
        actorId: "routing-evaluator",
        agentId: null,
      }),
    });
  });
});

function makeDecision(): RouteDecision {
  return {
    selectedEndpoint: "anthropic:claude-sonnet",
    selectedModelId: "claude-sonnet",
    reason: "Best score for requested task.",
    fitnessScore: 91,
    fallbackChain: [],
    candidates: [
      {
        endpointId: "anthropic:claude-sonnet",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        endpointName: "Claude Sonnet",
        fitnessScore: 91,
        dimensionScores: { reasoning: 90 },
        costPerOutputMToken: 3,
        excluded: false,
      },
    ],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "conversation",
    sensitivity: "internal",
    timestamp: new Date("2026-05-14T10:00:00.000Z"),
  };
}
