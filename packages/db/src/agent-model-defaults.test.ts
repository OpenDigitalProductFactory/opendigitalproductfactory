import { describe, expect, it } from "vitest";
import {
  AGENT_MODEL_CONFIG_DEFAULTS,
  resolveAgentModelDefaultUpdate,
} from "./agent-model-defaults";

describe("agent model config defaults", () => {
  it("covers route specialists that require tool-backed coworker work", () => {
    const byId = new Map(AGENT_MODEL_CONFIG_DEFAULTS.map((entry) => [entry.agentId, entry]));

    expect(byId.get("finance-agent")?.minimumCapabilities?.toolUse).toBe(true);
    expect(byId.get("finance-agent")?.minimumTier).toBe("strong");
    expect(byId.get("licensing-specialist")?.minimumCapabilities?.toolUse).toBe(true);
    expect(byId.get("licensing-specialist")?.minimumTier).toBe("strong");
  });

  it("converges a stale system-owned row to the current declaration", () => {
    const declaration = AGENT_MODEL_CONFIG_DEFAULTS.find(
      (entry) => entry.agentId === "marketing-specialist",
    )!;

    expect(
      resolveAgentModelDefaultUpdate(
        {
          minimumTier: "frontier",
          budgetClass: "quality_first",
          pinnedProviderId: "legacy-provider",
          pinnedModelId: "legacy-model",
          minimumCapabilities: { toolUse: false },
          minimumContextTokens: 16_000,
          configuredById: null,
        },
        declaration,
      ),
    ).toEqual({
      minimumTier: "adequate",
      budgetClass: "balanced",
      pinnedProviderId: null,
      pinnedModelId: null,
      minimumCapabilities: { toolUse: true },
      minimumContextTokens: 0,
    });
  });

  it("preserves operator-owned routing choices", () => {
    const declaration = AGENT_MODEL_CONFIG_DEFAULTS.find(
      (entry) => entry.agentId === "marketing-specialist",
    )!;

    expect(
      resolveAgentModelDefaultUpdate(
        {
          minimumTier: "frontier",
          budgetClass: "quality_first",
          pinnedProviderId: "chosen-provider",
          pinnedModelId: "chosen-model",
          minimumCapabilities: { toolUse: false },
          minimumContextTokens: 64_000,
          configuredById: "user-1",
        },
        declaration,
      ),
    ).toBeNull();
  });

  it("backfills missing safety floors without replacing operator choices", () => {
    const declaration = AGENT_MODEL_CONFIG_DEFAULTS.find(
      (entry) => entry.agentId === "marketing-specialist",
    )!;

    expect(
      resolveAgentModelDefaultUpdate(
        {
          minimumTier: "frontier",
          budgetClass: "quality_first",
          pinnedProviderId: "chosen-provider",
          pinnedModelId: "chosen-model",
          minimumCapabilities: null,
          minimumContextTokens: null,
          configuredById: "user-1",
        },
        declaration,
      ),
    ).toEqual({
      minimumCapabilities: { toolUse: true },
      minimumContextTokens: 0,
    });
  });
});
