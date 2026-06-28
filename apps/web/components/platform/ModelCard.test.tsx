import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";
import { ModelCard } from "./ModelCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/endpoint-performance", () => ({
  triggerDimensionEval: vi.fn(),
}));

vi.mock("@/lib/actions/agent-model-config", () => ({
  overrideModelTier: vi.fn(),
}));

const model: DiscoveredModelRow = {
  id: "disc-1",
  providerId: "zai",
  modelId: "glm-5.1",
  rawMetadata: {},
  discoveredAt: new Date("2026-06-28T10:00:00Z"),
  lastSeenAt: new Date("2026-06-28T10:00:00Z"),
};

const profile: ModelProfileRow = {
  id: "profile-1",
  providerId: "zai",
  modelId: "glm-5.1",
  friendlyName: "GLM-5.1",
  summary: "",
  capabilityCategory: "adequate",
  costTier: "unknown",
  bestFor: [],
  avoidFor: [],
  contextWindow: null,
  speedRating: null,
  generatedBy: "test",
  generatedAt: new Date("2026-06-28T10:00:00Z"),
  modelClass: "chat",
  capabilities: { toolUse: true },
  pricing: {},
  metadataConfidence: "medium",
  qualityTier: "adequate",
  qualityTierSource: "family",
};

const routingProfile = {
  reasoning: 55,
  codegen: 55,
  toolFidelity: 55,
  instructionFollowingScore: 55,
  structuredOutputScore: 52,
  conversational: 55,
  contextRetention: 52,
  profileSource: "seed",
  profileConfidence: "medium",
  evalCount: 1,
  lastEvalAt: "2026-06-28T10:00:00Z",
  modelStatus: "active",
};

describe("ModelCard", () => {
  it("hides routing scores, eval, and tier override in the default operator view", () => {
    const html = renderToStaticMarkup(
      <ModelCard
        model={model}
        profile={profile}
        isStale={false}
        profilingFailed={false}
        canWrite={true}
        hasActiveProvider={true}
        onProfile={vi.fn()}
        routingProfile={routingProfile}
        endpointId="zai"
      />,
    );

    expect(html).toContain("GLM-5.1");
    expect(html).toContain("Adequate");
    expect(html).not.toContain("Routing Scores");
    expect(html).not.toContain("Run Eval");
    expect(html).not.toContain("Override Tier");
  });

  it("shows calibration controls only in diagnostics mode", () => {
    const html = renderToStaticMarkup(
      <ModelCard
        model={model}
        profile={profile}
        isStale={false}
        profilingFailed={false}
        canWrite={true}
        hasActiveProvider={true}
        onProfile={vi.fn()}
        routingProfile={routingProfile}
        endpointId="zai"
        showDiagnostics={true}
      />,
    );

    expect(html).toContain("Routing Scores");
    expect(html).toContain("Override Tier");
  });
});
