import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RouteDecisionLogClient } from "./RouteDecisionLogClient";

describe("RouteDecisionLogClient", () => {
  it("keeps route evidence inside the mobile viewport while preserving scrollable candidate detail", () => {
    const html = renderToStaticMarkup(
      <RouteDecisionLogClient
        rows={[{
          id: "route-1",
          agentMessageId: null,
          selectedEndpointId: "openrouter",
          selectedModelId: "openai/gpt-5",
          taskType: "creative",
          sensitivity: "confidential",
          reason: "Selected the eligible provider.",
          fitnessScore: 0.9,
          candidateTrace: [{
            endpointId: "openrouter",
            providerId: "openrouter",
            modelId: "openai/gpt-5",
            endpointName: "OpenRouter",
            fitnessScore: 0.9,
            dimensionScores: { rankScore: 90, estimatedCost: 0.01 },
            costPerOutputMToken: 10,
            excluded: false,
          }],
          excludedTrace: [],
          policyRulesApplied: [],
          fallbackChain: [],
          shadowMode: false,
          suitabilityReceipt: null,
          inferenceDataScreenReceipt: null,
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
        }]}
      />,
    );

    expect(html).toContain("hidden sm:grid");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("min-w-0 max-w-full overflow-hidden");
  });
});
