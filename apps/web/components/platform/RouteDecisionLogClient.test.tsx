import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CallParameters, RoutingConfidence, RouteDecisionLogClient } from "./RouteDecisionLogClient";
import type { RouteDecisionLogRow } from "@/lib/actions/route-decision-logs";

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
          callParameters: null,
          routingConfidence: null,
          createdAt: new Date("2026-07-20T10:00:00.000Z"),
        }]}
      />,
    );

    expect(html).toContain("hidden sm:grid");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("min-w-0 max-w-full overflow-hidden");
  });
});

// BI-B4081AA1: the audit row could say which model ran and not how it was called.
//
// The panel is tested directly rather than through a row: it lives inside the
// row's collapsed detail region, which static markup never reaches.
describe("CallParameters", () => {
  it("shows each value with the plain-language reason it is that value", () => {
    const html = renderToStaticMarkup(
      <CallParameters
        receipt={{
          sampling: { temperature: 0.6, topP: 0.95, topK: 20 },
          provenance: { temperature: "vendor", topP: "vendor", topK: "vendor" },
          mode: "thinking",
          maxTokens: 8192,
          effort: { expressedAs: "think" },
        }}
      />,
    );
    expect(html).toContain("How it was called");
    expect(html).toContain("Temperature");
    expect(html).toContain("0.6");
    expect(html).toContain("published setting for reasoning mode");
    expect(html).toContain("some variation");
    expect(html).toContain("8192");
  });

  it("states plainly when a provider could not accept the requested reasoning", () => {
    const html = renderToStaticMarkup(
      <CallParameters
        receipt={{ sampling: {}, provenance: {}, mode: "default", maxTokens: 4096, effortUnexpressed: true }}
      />,
    );
    expect(html).toContain("no way to accept it");
    // With nothing set, say so rather than render an empty box.
    expect(html).toContain("Provider defaults");
  });

  it("names the parameters a model refused", () => {
    const html = renderToStaticMarkup(
      <CallParameters
        receipt={{
          sampling: {}, provenance: {}, mode: "default", maxTokens: 4096,
          dropped: ["temperature", "topP"],
        }}
      />,
    );
    expect(html).toContain("Not accepted by this model");
    expect(html).toContain("temperature, topP");
  });

  it("reports constrained decoding when the response had to satisfy a schema", () => {
    const html = renderToStaticMarkup(
      <CallParameters
        receipt={{
          sampling: { temperature: 0 }, provenance: { temperature: "contract" },
          mode: "default", maxTokens: 4096, constrainedDecoding: true,
        }}
      />,
    );
    expect(html).toContain("JSON constrained");
    expect(html).toContain("no variation");
  });
});

// BI-A08285BC — a below-floor run is visible, and a confident one is silent.
describe("RoutingConfidence", () => {
  it("names what went wrong when the floor was relaxed", () => {
    const html = renderToStaticMarkup(
      <RoutingConfidence signal={{ qualityFloorRelaxed: true, candidateCount: 3 }} />,
    );
    expect(html).toContain("Ran with low confidence");
    expect(html).toContain("No model met the quality bar");
  });

  it("calls out a single candidate as an outcome rather than a choice", () => {
    const html = renderToStaticMarkup(<RoutingConfidence signal={{ candidateCount: 1 }} />);
    expect(html).toContain("nothing competed");
  });

  it("names a fallback win", () => {
    const html = renderToStaticMarkup(
      <RoutingConfidence signal={{ fallbackUsed: true, candidateCount: 5 }} />,
    );
    expect(html).toContain("not the ranked choice");
  });

  it("renders nothing when routing was confident, so it never becomes noise", () => {
    const html = renderToStaticMarkup(
      <RoutingConfidence signal={{ qualityFloorRelaxed: false, candidateCount: 8 }} />,
    );
    expect(html).toBe("");
  });
});
