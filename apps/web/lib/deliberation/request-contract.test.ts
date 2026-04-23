// apps/web/lib/deliberation/request-contract.test.ts
// Task 6 — request-contract builder tests (spec §9.7).

import { describe, it, expect } from "vitest";
import { buildBranchRequestContract } from "./request-contract";

describe("buildBranchRequestContract", () => {
  it("routes author role to code_gen task type", () => {
    const c = buildBranchRequestContract({
      roleId: "author",
      strategyProfile: "balanced",
      diversityMode: "single-model-multi-persona",
      artifactType: "spec",
    });
    expect(c.taskType).toBe("code_gen");
  });

  it("routes reviewer role to review task type", () => {
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "balanced",
      diversityMode: "multi-model-same-provider",
      artifactType: "code-change",
    });
    expect(c.taskType).toBe("review");
  });

  it("routes adjudicator role to synthesis task type", () => {
    const c = buildBranchRequestContract({
      roleId: "adjudicator",
      strategyProfile: "balanced",
      diversityMode: "single-model-multi-persona",
      artifactType: "spec",
    });
    expect(c.taskType).toBe("synthesis");
  });

  it("routes debater role to argumentation task type", () => {
    const c = buildBranchRequestContract({
      roleId: "debater",
      strategyProfile: "high-assurance",
      diversityMode: "multi-provider-heterogeneous",
      artifactType: "architecture-decision",
    });
    expect(c.taskType).toBe("argumentation");
  });

  it("derives reasoningDepth from strategyProfile when no recipe hint", () => {
    const economy = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "economy",
      diversityMode: "single-model-multi-persona",
      artifactType: "plan",
    });
    const highAssurance = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "high-assurance",
      diversityMode: "multi-provider-heterogeneous",
      artifactType: "plan",
    });
    expect(economy.reasoningDepth).toBe("low");
    expect(highAssurance.reasoningDepth).toBe("high");
  });

  it("maps strategyProfile to budgetClass", () => {
    const economy = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "economy",
      diversityMode: "single-model-multi-persona",
      artifactType: "plan",
    });
    const highAssurance = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "high-assurance",
      diversityMode: "multi-provider-heterogeneous",
      artifactType: "plan",
    });
    expect(economy.budgetClass).toBe("minimize_cost");
    expect(highAssurance.budgetClass).toBe("quality_first");
  });

  it("honors recipe hint capabilityTier over strategyProfile reasoning depth", () => {
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "economy",
      diversityMode: "single-model-multi-persona",
      artifactType: "plan",
      recipeHint: {
        roleId: "reviewer",
        capabilityTier: "high",
      },
    });
    expect(c.reasoningDepth).toBe("high");
  });

  it("honors recipe hint taskType over role default", () => {
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "balanced",
      diversityMode: "single-model-multi-persona",
      artifactType: "plan",
      recipeHint: {
        roleId: "reviewer",
        taskType: "custom-review",
      },
    });
    expect(c.taskType).toBe("custom-review");
  });

  it("marks interactionMode as background (non-streaming)", () => {
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "balanced",
      diversityMode: "multi-model-same-provider",
      artifactType: "plan",
    });
    expect(c.interactionMode).toBe("background");
    expect(c.requiresStreaming).toBe(false);
  });

  it("defaults minimumCapabilities to an empty floor (read-only branches)", () => {
    // spec §6.5 point 3: deliberation branches default to read-only / retrieval.
    // Hard capability floors (toolUse) would exclude endpoints that can still
    // read and critique; patterns that need tools must opt in at pattern level.
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "balanced",
      diversityMode: "single-model-multi-persona",
      artifactType: "plan",
    });
    expect(c.minimumCapabilities).toEqual({});
  });

  it("does NOT hard-pin providers (no allowedProviders) — no provider pinning", () => {
    // project memory: "no provider pinning". Diversity is a preference
    // expressed via deliberationPreferences metadata, not allowedProviders.
    const c = buildBranchRequestContract({
      roleId: "debater",
      strategyProfile: "high-assurance",
      diversityMode: "multi-provider-heterogeneous",
      artifactType: "architecture-decision",
      priorProviderIds: ["openai"],
    });
    expect(c.allowedProviders).toBeUndefined();
  });

  it("expresses diversity as preference in deliberationPreferences metadata", () => {
    const c = buildBranchRequestContract({
      roleId: "debater",
      strategyProfile: "high-assurance",
      diversityMode: "multi-provider-heterogeneous",
      artifactType: "architecture-decision",
      priorProviderIds: ["openai"],
      priorModelIds: ["gpt-4o"],
    });
    expect(c.deliberationPreferences.preferProviderDiversity).toBe(true);
    expect(c.deliberationPreferences.priorProviderIds).toEqual(["openai"]);
    expect(c.deliberationPreferences.priorModelIds).toEqual(["gpt-4o"]);
    expect(c.deliberationPreferences.diversityMode).toBe(
      "multi-provider-heterogeneous",
    );
    expect(c.deliberationPreferences.strategyProfile).toBe("high-assurance");
  });

  it("single-model-multi-persona does not request provider diversity", () => {
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "balanced",
      diversityMode: "single-model-multi-persona",
      artifactType: "plan",
    });
    expect(c.deliberationPreferences.preferProviderDiversity).toBe(false);
  });

  it("multi-model-same-provider prefers model diversity", () => {
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "balanced",
      diversityMode: "multi-model-same-provider",
      artifactType: "plan",
    });
    expect(c.deliberationPreferences.preferProviderDiversity).toBe(true);
  });

  it("carries artifactType into contractFamily for telemetry", () => {
    const c = buildBranchRequestContract({
      roleId: "reviewer",
      strategyProfile: "balanced",
      diversityMode: "single-model-multi-persona",
      artifactType: "policy",
    });
    expect(c.contractFamily).toBe("deliberation.reviewer.policy");
  });
});
