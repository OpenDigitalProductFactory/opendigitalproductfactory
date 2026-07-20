import { describe, expect, it } from "vitest";

import type { RequestContract } from "../request-contract";
import type { ProviderSuitabilityPolicy } from "./types";
import { applyProviderSuitabilityPolicyToContract } from "./runtime-policy";
import { resolveProviderSuitabilityRollout } from "./telemetry";

function contract(overrides: Partial<RequestContract> = {}): RequestContract {
  return {
    contractId: "contract-1",
    contractFamily: "sync.test",
    taskType: "summarization",
    modality: { input: ["text"], output: ["text"] },
    interactionMode: "sync",
    sensitivity: "restricted",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    reasoningDepth: "low",
    budgetClass: "balanced",
    ...overrides,
  };
}

function policy(overrides: Partial<ProviderSuitabilityPolicy> = {}): ProviderSuitabilityPolicy {
  return {
    policyId: "aips-1",
    organizationId: "org-1",
    source: "admin",
    effect: "review",
    allowedProviders: ["anthropic", "local"],
    deniedProviders: ["openai-personal"],
    allowedProviderConnectionIds: ["connection-anthropic", "connection-local"],
    deniedProviderConnectionIds: ["connection-personal"],
    residencyPolicy: "approved_cloud",
    openRouterObligations: null,
    explanations: [],
    compilerVersion: "1.0.0",
    ...overrides,
  };
}

describe("applyProviderSuitabilityPolicyToContract", () => {
  it("does not enforce during compiler shadow mode", () => {
    const original = contract({ allowedProviders: ["openai-personal"] });
    const result = applyProviderSuitabilityPolicyToContract({
      contract: original,
      policy: policy(),
      rollout: resolveProviderSuitabilityRollout("compiler-shadow"),
      archetypeCategory: "healthcare-wellness",
    });

    expect(result.mode).toBe("shadow");
    expect(result.contract).toEqual(original);
  });

  it("intersects allowlists, unions denials, and keeps the stricter residency boundary", () => {
    const result = applyProviderSuitabilityPolicyToContract({
      contract: contract({
        allowedProviders: ["anthropic", "openai-personal"],
        deniedProviders: ["operator-denied"],
        residencyPolicy: "local_only",
      }),
      policy: policy(),
      rollout: resolveProviderSuitabilityRollout("evidence-enforcement"),
      archetypeCategory: "healthcare-wellness",
    });

    expect(result.mode).toBe("enforced");
    expect(result.contract.allowedProviders).toEqual(["anthropic"]);
    expect(result.contract.deniedProviders).toEqual(["openai-personal", "operator-denied"]);
    expect(result.contract.residencyPolicy).toBe("local_only");
  });

  it("binds selected regulated verticals before fleet-wide evidence enforcement", () => {
    const regulated = applyProviderSuitabilityPolicyToContract({
      contract: contract(),
      policy: policy(),
      rollout: resolveProviderSuitabilityRollout("selected-vertical-bindings"),
      archetypeCategory: "banking-financial-services",
    });
    const generic = applyProviderSuitabilityPolicyToContract({
      contract: contract(),
      policy: policy(),
      rollout: resolveProviderSuitabilityRollout("selected-vertical-bindings"),
      archetypeCategory: "retail",
    });

    expect(regulated.mode).toBe("enforced");
    expect(generic.mode).toBe("preview");
  });

  it("enforces restricted OpenRouter obligations at the dedicated rollout stage", () => {
    const obligations = {
      requireProviderAllowlist: true,
      requireProviderBlocklist: true,
      requireZdr: true,
      denyDataCollection: true,
      requireBoundedFallbacks: true,
      requiredRegion: "eu",
      approvedEndpointSlugs: ["anthropic"],
      providerConnectionId: "connection-openrouter",
      accountClass: "enterprise" as const,
      evidenceStatus: "contract-uploaded" as const,
      regionalProcessingEntitled: true,
      enabledRegions: ["eu"],
      requiredBaseUrl: "https://eu.openrouter.ai/api/v1",
    };
    const result = applyProviderSuitabilityPolicyToContract({
      contract: contract(),
      policy: policy({ openRouterObligations: obligations }),
      rollout: resolveProviderSuitabilityRollout("restricted-openrouter"),
      archetypeCategory: "retail",
    });

    expect(result.mode).toBe("enforced");
    expect(result.contract.openRouterObligations).toEqual(obligations);
  });
});
