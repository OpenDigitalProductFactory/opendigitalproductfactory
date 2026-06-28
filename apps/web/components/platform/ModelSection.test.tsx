import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { DiscoveredModelRow, ModelProfileRow } from "@/lib/ai-provider-types";
import { ModelSection } from "./ModelSection";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/ai-providers", () => ({
  profileModels: vi.fn(),
}));

vi.mock("@/lib/actions/endpoint-performance", () => ({
  triggerDimensionEval: vi.fn(),
}));

vi.mock("@/lib/actions/agent-model-config", () => ({
  overrideModelTier: vi.fn(),
}));

const discovered: DiscoveredModelRow[] = [
  {
    id: "disc-1",
    providerId: "zai",
    modelId: "glm-5.1",
    rawMetadata: {},
    discoveredAt: new Date("2026-06-28T10:00:00Z"),
    lastSeenAt: new Date("2026-06-28T10:00:00Z"),
  },
  {
    id: "disc-2",
    providerId: "zai",
    modelId: "glm-5.2",
    rawMetadata: {},
    discoveredAt: new Date("2026-06-28T10:00:00Z"),
    lastSeenAt: new Date("2026-06-28T10:00:00Z"),
  },
];

const profiles: ModelProfileRow[] = discovered.map((model) => ({
  id: `profile-${model.id}`,
  providerId: model.providerId,
  modelId: model.modelId,
  friendlyName: model.modelId.toUpperCase(),
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
}));

const routingProfiles = discovered.map((model) => ({
  modelId: model.modelId,
  friendlyName: model.modelId.toUpperCase(),
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
  maxContextTokens: 128000,
  supportsToolUse: true,
  modelStatus: "active",
  retiredAt: null,
}));

describe("ModelSection", () => {
  it("summarizes model readiness without exposing search or per-model controls by default", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        providerId="zai"
        models={discovered}
        profiles={profiles}
        canWrite={true}
        hasActiveProvider={true}
        latestDiscovery={new Date("2026-06-28T10:00:00Z")}
        endpointId="zai"
      />,
    );

    expect(html).toContain("2 models ready");
    expect(html).not.toContain("Search models");
    expect(html).not.toContain("Run Eval");
    expect(html).not.toContain("Override Tier");
    expect(html).not.toContain("Routing Scores");
  });

  it("keeps model search and calibration controls available in diagnostics mode", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        providerId="zai"
        models={discovered}
        profiles={profiles}
        canWrite={true}
        hasActiveProvider={true}
        latestDiscovery={new Date("2026-06-28T10:00:00Z")}
        endpointId="zai"
        showDiagnostics={true}
        routingProfiles={routingProfiles}
      />,
    );

    expect(html).toContain("Search models");
    expect(html).toContain("Override Tier");
  });
});
