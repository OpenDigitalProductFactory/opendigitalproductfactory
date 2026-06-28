import { describe, expect, it } from "vitest";

import { projectActivityRoutingFromLiveState } from "./activity-routing-live-state";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  activityHarnessProposalParameters,
} from "@/lib/routing/activity-harness-approval-source";
import type {
  RoutingDecisionSourceRow,
  RoutingRouteOutcomeSourceRow,
  RoutingTokenUsageSourceRow,
} from "./project-routing-topology";

describe("projectActivityRoutingFromLiveState", () => {
  it("attaches Build Studio activity-routing projection from phase model resolution", () => {
    const routing = projectActivityRoutingFromLiveState({
      providers: [],
      taskRuns: [],
      routeDecisions: [],
      tokenUsage: [],
      routeOutcomes: [],
      activityHarnessApprovalProposals: [],
      phaseModelSelection: {
        generatedAt: "2026-06-28T20:00:00.000Z",
        phases: [makePhase()],
      },
    });

    expect(routing).toMatchObject({
      generatedAt: "2026-06-28T20:00:00.000Z",
      activities: [{
        activityId: "build:unknown:plan",
        activityClass: "plan",
        selectedProviderId: "anthropic",
        selectedModelId: "claude-sonnet",
      }],
    });
  });

  it("merges observed activity outcomes into the activity-routing projection", () => {
    const routing = projectActivityRoutingFromLiveState({
      providers: [],
      taskRuns: [],
      routeDecisions: [makeRouteDecisionRow()],
      tokenUsage: [makeTokenUsageRow()],
      routeOutcomes: [makeRouteOutcomeRow()],
      activityHarnessApprovalProposals: [],
      phaseModelSelection: {
        generatedAt: "2026-06-28T20:00:20.000Z",
        phases: [makePhase()],
      },
    });

    expect(routing?.activities[0]).toMatchObject({
      activityId: "build:unknown:plan",
      routeDecisionId: "decision-plan-1",
      tokenTotal: 1500,
      costUsd: 0.027,
      successSignal: "valid",
    });
  });

  it("loads approved confidence overrides into the activity-routing projection", () => {
    const routing = projectActivityRoutingFromLiveState({
      providers: [],
      taskRuns: [],
      routeDecisions: [],
      tokenUsage: [],
      routeOutcomes: [],
      activityHarnessApprovalProposals: [{
        proposalId: "AP-ROUTE-1",
        actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
        parameters: activityHarnessProposalParameters({
          proposalId: "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
          activityClass: "plan",
          harnessRecipeKey: "edge.plan.balanced",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          confidence: "trusted",
        }),
        status: "approved",
        decidedById: "user-1",
        decidedAt: new Date("2026-06-28T21:00:00.000Z"),
      }],
      phaseModelSelection: {
        generatedAt: "2026-06-28T20:00:20.000Z",
        phases: [makePhase()],
      },
    });

    expect(routing?.activities[0]).toMatchObject({
      activityClass: "plan",
      harnessRecipeKey: "edge.plan.balanced",
      confidence: "trusted",
      approvedConfidenceOverrideId:
        "harness-action:plan:edge.plan.balanced:anthropic:claude-sonnet:promote",
    });
  });

  it("projects live GLM provider readiness and Work Case patterns when no phase routing exists", () => {
    const routing = projectActivityRoutingFromLiveState({
      providers: [{ providerId: "zai", status: "unconfigured" }],
      taskRuns: [{
        taskRunId: "TR-WORK-CASE",
        title: "Approve governed playbook proposal",
        repeatedPatternKey: "case-resolution:approve",
        a2aMetadata: {
          workPattern: {
            patternKey: "case-resolution:approve",
            status: "active",
            scope: "case-transition",
            version: 1,
            source: "human-review",
            decisionScope: "company-wwwd",
            evidence: [{
              taskRunId: "TR-WORK-CASE",
              workCaseRef: "WC-CASE-1",
              receiptId: "receipt-1",
              decisionInteractionId: "decision-1",
            }],
            workCaseBinding: {
              caseType: "governed-playbook",
              transitionKey: "approve",
              governedActionKey: "approve-playbook-proposal",
              authorityMode: "on-behalf-of",
              receiptPolicy: "governed-action",
            },
          },
        },
      }],
      routeDecisions: [],
      tokenUsage: [],
      routeOutcomes: [],
      activityHarnessApprovalProposals: [],
      phaseModelSelection: { generatedAt: "2026-06-28T20:00:00.000Z", phases: [] },
    });

    expect(routing?.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activityId: "pilot:glm:zai-provider-catalog",
        selectedProviderId: "zai",
        selectedModelId: "glm-5.2",
        confidence: "provisional",
        successSignal: "attention",
        decisionSummary: expect.stringContaining("credentials"),
      }),
      expect.objectContaining({
        activityId: "pilot:work-case:case-resolution:approve",
        label: "Approve governed playbook proposal",
        activityClass: "tool-act",
        harnessRecipeKey: "mixed.tool-act.balanced",
        decisionSummary: "Work Case pattern has governed action, receipt policy, and case evidence.",
      }),
    ]));
  });
});

function makePhase() {
  return {
    phase: "plan" as const,
    label: "Plan",
    governedBy: "providers-routing" as const,
    mechanism: "routed" as const,
    engine: "Providers & Routing",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    isLocal: false,
    providerTier: "user_configured",
    contextTokens: 200000,
    rationale: "Selected Claude for high-risk planning.",
    flags: [],
  };
}

function makeRouteDecisionRow(): RoutingDecisionSourceRow {
  return {
    id: "decision-plan-1",
    agentMessageId: null,
    actorKind: null,
    actorId: null,
    agentId: "support-specialist",
    selectedEndpointId: "anthropic:claude-sonnet",
    selectedModelId: "claude-sonnet",
    taskType: "reasoning",
    sensitivity: "internal",
    reason: "Selected Claude.",
    fitnessScore: 0.91,
    candidateTrace: [{
      endpointId: "anthropic:claude-sonnet",
      providerId: "anthropic",
      modelId: "claude-sonnet",
      excluded: false,
      activityHarness: {
        recipeKey: "edge.plan.balanced",
        activityClass: "plan",
        activityConfidence: "calibrating",
        promptStrategy: "standard-activity-packet",
        contextAssembler: "ranked-evidence-context",
      },
    }],
    excludedTrace: [],
    policyRulesApplied: [],
    fallbackChain: [],
    fallbacksUsed: null,
    shadowMode: false,
    createdAt: new Date("2026-06-28T20:00:00.000Z"),
  };
}

function makeTokenUsageRow(): RoutingTokenUsageSourceRow {
  return {
    id: "usage-1",
    agentId: "support-specialist",
    providerId: "anthropic",
    contextKey: "reasoning",
    inputTokens: 900,
    outputTokens: 600,
    inferenceMs: 1500,
    costUsd: 0.027,
    createdAt: new Date("2026-06-28T20:00:10.000Z"),
  };
}

function makeRouteOutcomeRow(): RoutingRouteOutcomeSourceRow {
  return {
    id: "outcome-1",
    agentId: "support-specialist",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    taskType: "reasoning",
    fallbackOccurred: false,
    providerErrorCode: null,
    createdAt: new Date("2026-06-28T20:00:15.000Z"),
  };
}
