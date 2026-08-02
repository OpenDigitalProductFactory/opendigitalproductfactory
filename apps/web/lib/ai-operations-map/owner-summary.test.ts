import { describe, expect, it } from "vitest";
import { buildOperationsMapOwnerSummary } from "./owner-summary";
import type { OperationsMapActivityRouting } from "./types";

const DEGRADED: OperationsMapActivityRouting = {
  generatedAt: "2026-08-02T12:00:00.000Z",
  taskRef: {},
  activities: [
    {
      activityId: "ideate",
      label: "Ideate",
      activityClass: "synthesize",
      distributionShape: "mixed",
      riskClass: "medium",
      selectedProviderId: null,
      selectedModelId: null,
      harnessRecipeKey: null,
      confidence: "calibrating",
      successSignal: "failed",
      costUsd: null,
      tokenTotal: null,
      routeDecisionId: null,
      adapterTelemetryId: null,
      decisionSummary: "No eligible endpoints for internal code-generation work.",
      exclusions: [
        {
          providerId: "routing-error",
          modelId: null,
          code: "no-eligible-endpoint",
          reason: "No allowed healthy engine can run Ideate.",
          remediation: "Connect or enable a tool-capable provider.",
        },
      ],
      enableCandidates: [
        {
          providerId: "anthropic",
          displayName: "Anthropic",
          action: "connect_credentials",
          actionLabel: "Connect & enable",
          oneClick: false,
          satisfies: ["tool use", "internal sensitivity"],
          note: "Needs credentials.",
        },
      ],
    },
    {
      activityId: "plan",
      label: "Plan",
      activityClass: "plan",
      distributionShape: "edge",
      riskClass: "high",
      selectedProviderId: null,
      selectedModelId: null,
      harnessRecipeKey: null,
      confidence: "calibrating",
      successSignal: "attention",
      costUsd: null,
      tokenTotal: null,
      routeDecisionId: null,
      adapterTelemetryId: null,
      decisionSummary: "No route selected.",
      exclusions: [],
    },
  ],
};

describe("buildOperationsMapOwnerSummary", () => {
  it("names the first degraded activity, data class, cause, provider posture, and next action", () => {
    const summary = buildOperationsMapOwnerSummary(DEGRADED);

    expect(summary.intent).toBe("attention");
    expect(summary.title).toBe("2 routing steps need attention");
    expect(summary.primaryAction).toEqual({
      href: "#activity-routing-workbench",
      label: "Review Ideate",
    });
    expect(summary.facts).toEqual(
      expect.arrayContaining([
        { label: "First affected", value: "Ideate" },
        { label: "Why", value: "No allowed healthy engine can run Ideate." },
        { label: "Data class", value: "Internal sensitivity" },
        { label: "Provider path", value: "Anthropic is disabled — Connect & enable" },
      ]),
    );
    expect(summary.wordCount).toBeLessThanOrEqual(70);
  });

  it("stays honest when no activity evidence exists", () => {
    const summary = buildOperationsMapOwnerSummary(null);

    expect(summary.intent).toBe("waiting");
    expect(summary.title).toBe("No routing decisions recorded yet");
    expect(summary.primaryAction.label).toBe("Inspect routing map");
    expect(summary.facts).toEqual([]);
  });

  it("uses a calm scan state when all activity routes are healthy", () => {
    const healthy: OperationsMapActivityRouting = {
      ...DEGRADED,
      activities: DEGRADED.activities.map((activity) => ({
        ...activity,
        selectedProviderId: "anthropic",
        selectedModelId: "claude-sonnet",
        successSignal: "valid" as const,
        exclusions: [],
        enableCandidates: [],
      })),
    };
    const summary = buildOperationsMapOwnerSummary(healthy);

    expect(summary.intent).toBe("healthy");
    expect(summary.title).toBe("Routing has no recorded failures");
    expect(summary.primaryAction.label).toBe("Inspect routing decisions");
    expect(summary.wordCount).toBeLessThanOrEqual(70);
  });
});
