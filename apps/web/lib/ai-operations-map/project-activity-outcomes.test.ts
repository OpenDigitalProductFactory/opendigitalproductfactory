import { describe, expect, it } from "vitest";
import {
  projectActivityOutcomes,
  type ActivityOutcomeProjectionInput,
} from "./project-activity-outcomes";

describe("projectActivityOutcomes", () => {
  it("derives activity outcomes from route decisions with persisted harness evidence", () => {
    const outcomes = projectActivityOutcomes({
      routeDecisions: [
        makeDecision({
          id: "decision-1",
          agentId: "build-specialist",
          selectedEndpointId: "anthropic:claude-sonnet",
          selectedModelId: "claude-sonnet",
          taskType: "analysis",
          candidateTrace: [
            makeCandidate({
              endpointId: "anthropic:claude-sonnet",
              providerId: "anthropic",
              modelId: "claude-sonnet",
              activityHarness: {
                recipeKey: "high-risk.code-edit.frontier-coding",
                activityClass: "code-edit",
                activityConfidence: "trusted",
                promptStrategy: "repo-packet-with-verification",
                contextAssembler: "work-case-repo-packet",
              },
            }),
          ],
        }),
      ],
      tokenUsage: [
        makeTokenUsage({
          id: "usage-1",
          agentId: "build-specialist",
          providerId: "anthropic",
          contextKey: "analysis",
          inputTokens: 1200,
          outputTokens: 800,
          costUsd: 0.042,
          createdAt: new Date("2026-06-28T20:00:10.000Z"),
        }),
      ],
      routeOutcomes: [
        makeRouteOutcome({
          id: "outcome-1",
          agentId: "build-specialist",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          taskType: "analysis",
          fallbackOccurred: false,
          providerErrorCode: null,
          createdAt: new Date("2026-06-28T20:00:20.000Z"),
        }),
      ],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        id: "activity-outcome:decision-1",
        routeDecisionId: "decision-1",
        activityClass: "code-edit",
        harnessRecipeKey: "high-risk.code-edit.frontier-coding",
        confidence: "trusted",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        taskType: "analysis",
        tokenTotal: 2000,
        costUsd: 0.042,
        successSignal: "valid",
        evidenceStrength: "linked",
      }),
    ]);
  });

  it("keeps harness outcomes visible when usage and route outcome evidence are missing", () => {
    const outcomes = projectActivityOutcomes({
      routeDecisions: [
        makeDecision({
          id: "decision-2",
          selectedEndpointId: "zai-coding:glm-5.2",
          selectedModelId: "glm-5.2",
          taskType: "codegen",
          candidateTrace: [
            makeCandidate({
              endpointId: "zai-coding:glm-5.2",
              providerId: "zai-coding",
              modelId: "glm-5.2",
              activityHarness: {
                recipeKey: "glm.mixed.code-edit.provisional",
                activityClass: "code-edit",
                activityConfidence: "provisional",
                promptStrategy: "glm-center-distribution-packet",
                contextAssembler: "minimal-ranked-context",
              },
            }),
          ],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        routeDecisionId: "decision-2",
        providerId: "zai-coding",
        modelId: "glm-5.2",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        successSignal: "unknown",
        tokenTotal: null,
        costUsd: null,
        evidenceStrength: "route-only",
      }),
    ]);
  });

  it("uses evaluation signals to upgrade success and carry quality evidence", () => {
    const outcomes = projectActivityOutcomes({
      routeDecisions: [
        makeDecision({
          id: "decision-review",
          selectedEndpointId: "anthropic:claude-sonnet",
          selectedModelId: "claude-sonnet",
          candidateTrace: [
            makeCandidate({
              endpointId: "anthropic:claude-sonnet",
              providerId: "anthropic",
              modelId: "claude-sonnet",
              activityHarness: {
                recipeKey: "edge.plan.balanced",
                activityClass: "plan",
                activityConfidence: "calibrating",
                promptStrategy: "standard-activity-packet",
                contextAssembler: "ranked-evidence-context",
              },
            }),
          ],
        }),
      ],
      tokenUsage: [],
      routeOutcomes: [],
      evaluationSignals: [
        {
          routeDecisionId: "decision-review",
          activityClass: "plan",
          signal: "review-passed",
          qualityScore: 0.92,
          source: "plan-review",
          occurredAt: new Date("2026-06-28T20:01:00.000Z"),
        },
      ],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        routeDecisionId: "decision-review",
        activityClass: "plan",
        harnessRecipeKey: "edge.plan.balanced",
        successSignal: "review-passed",
        qualitySignal: 0.92,
        evaluatorSource: "plan-review",
        evidenceStrength: "linked",
      }),
    ]);
  });

  it("does not fabricate activity outcomes for route decisions without harness evidence", () => {
    const outcomes = projectActivityOutcomes({
      routeDecisions: [
        makeDecision({
          id: "decision-no-harness",
          candidateTrace: [makeCandidate()],
        }),
      ],
      tokenUsage: [
        makeTokenUsage({
          providerId: "anthropic",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.01,
        }),
      ],
      routeOutcomes: [],
    });

    expect(outcomes).toEqual([]);
  });
});

function makeDecision(
  overrides: Partial<ActivityOutcomeProjectionInput["routeDecisions"][number]> = {},
): ActivityOutcomeProjectionInput["routeDecisions"][number] {
  return {
    id: "decision-1",
    agentMessageId: null,
    actorKind: "agent",
    actorId: "build-specialist",
    agentId: "build-specialist",
    selectedEndpointId: "anthropic:claude-sonnet",
    taskType: "analysis",
    sensitivity: "internal",
    reason: "Selected model.",
    fitnessScore: 0.91,
    candidateTrace: [makeCandidate()],
    excludedTrace: [],
    policyRulesApplied: [],
    fallbackChain: [],
    fallbacksUsed: null,
    shadowMode: false,
    createdAt: new Date("2026-06-28T20:00:00.000Z"),
    selectedModelId: "claude-sonnet",
    ...overrides,
  };
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    endpointId: "anthropic:claude-sonnet",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    endpointName: "Claude Sonnet",
    fitnessScore: 91,
    dimensionScores: { reasoning: 90 },
    costPerOutputMToken: 3,
    excluded: false,
    ...overrides,
  };
}

function makeTokenUsage(
  overrides: Partial<ActivityOutcomeProjectionInput["tokenUsage"][number]> = {},
): ActivityOutcomeProjectionInput["tokenUsage"][number] {
  return {
    id: "usage-1",
    agentId: "build-specialist",
    providerId: "anthropic",
    contextKey: "analysis",
    inputTokens: 0,
    outputTokens: 0,
    inferenceMs: null,
    costUsd: 0,
    createdAt: new Date("2026-06-28T20:00:05.000Z"),
    ...overrides,
  };
}

function makeRouteOutcome(
  overrides: Partial<ActivityOutcomeProjectionInput["routeOutcomes"][number]> = {},
): ActivityOutcomeProjectionInput["routeOutcomes"][number] {
  return {
    id: "outcome-1",
    agentId: "build-specialist",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    taskType: "analysis",
    fallbackOccurred: false,
    providerErrorCode: null,
    createdAt: new Date("2026-06-28T20:00:06.000Z"),
    ...overrides,
  };
}
