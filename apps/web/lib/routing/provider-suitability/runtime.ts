import type { ActivityContract } from "../activity-contract";
import type { EndpointManifest, RouteDecision } from "../types";
import type { RequestContract } from "../request-contract";
import type { PostureOverride } from "@/lib/golden-triangle/types";
import { loadProviderSuitabilitySourceContext } from "./provider-onboarding-data";
import { deriveProviderSuitabilityWorkContext } from "./work-context";
import { compileAiProviderSuitabilityPolicy } from "./compile";
import { applyProviderSuitabilityPolicyToContract } from "./runtime-policy";
import { resolveProviderSuitabilityRollout } from "./telemetry";
import {
  buildProviderSuitabilityRouteReceipt,
  completeProviderSuitabilityRouteReceipt,
} from "./evidence";
import type { ProviderSuitabilityPolicy, ProviderTrustFacts } from "./types";
import type { OpenRouterRoutingEvidence } from "./openrouter-policy";
import { updateProviderSuitabilityReceipt } from "../loader";

export type ProviderSuitabilityRuntime = {
  policy: ProviderSuitabilityPolicy;
  providerFacts: ProviderTrustFacts[];
  mode: "shadow" | "preview" | "enforced";
  policyRuleId: string;
  activityClass: string;
  workloadClasses: string[];
};

export async function prepareProviderSuitabilityRuntime(input: {
  contract: RequestContract;
  activity: ActivityContract;
  goldenTrianglePosture?: PostureOverride;
}): Promise<{ contract: RequestContract; suitability: ProviderSuitabilityRuntime | null }> {
  const rollout = resolveProviderSuitabilityRollout(process.env.DPF_PROVIDER_SUITABILITY_ROLLOUT_STAGE);
  try {
    const source = await loadProviderSuitabilitySourceContext(
      input.activity.governedData?.applicableRegulationIds ?? [],
    );
    const workContext = deriveProviderSuitabilityWorkContext({
      archetypeId: source.businessProfile.archetypeId,
      archetypeCategory: source.businessProfile.archetypeCategory,
      valueStreamStage: null,
      activity: input.activity,
    });
    const providerFacts = source.connections
      .filter((connection) => connection.status === "active")
      .map((connection) => connection.facts);
    const policy = compileAiProviderSuitabilityPolicy({
      businessProfile: source.businessProfile,
      workloadProfiles: workContext.workloadProfiles,
      dataPolicyDecisions: [],
      regulationResults: source.regulationResults,
      providerFacts,
      source: "admin",
      activityClass: workContext.activityClass,
      goldenTrianglePosture: input.goldenTrianglePosture,
    });
    const binding = applyProviderSuitabilityPolicyToContract({
      contract: input.contract,
      policy,
      rollout,
      archetypeCategory: source.businessProfile.archetypeCategory,
    });
    return {
      contract: binding.contract,
      suitability: {
        policy,
        providerFacts,
        mode: binding.mode,
        policyRuleId: binding.policyRuleId,
        activityClass: workContext.activityClass,
        workloadClasses: workContext.workloadClasses,
      },
    };
  } catch (error) {
    if (rollout.evidenceEnforcement) throw error;
    console.error("[provider-suitability] Preview compilation failed:", error);
    return { contract: input.contract, suitability: null };
  }
}

export function attachProviderSuitabilityReceipt(
  decision: RouteDecision,
  manifests: EndpointManifest[],
  suitability: ProviderSuitabilityRuntime,
): void {
  if (!decision.selectedEndpoint) return;
  const selected = manifests.find((manifest) => manifest.id === decision.selectedEndpoint);
  if (!selected) return;
  const connections = suitability.providerFacts.filter(
    (facts) => facts.providerId === selected.providerId &&
      suitability.policy.allowedProviderConnectionIds.includes(facts.providerConnectionId),
  );
  if (connections.length !== 1) return;
  decision.providerSuitabilityReceipt = buildProviderSuitabilityRouteReceipt({
    policy: suitability.policy,
    inputVersion: `provider-suitability-input/${suitability.policy.policyId}`,
    connection: connections[0]!,
    selectedProviderId: selected.providerId,
    selectedUnderlyingProviderId: null,
    activityClass: suitability.activityClass,
    workloadClasses: suitability.workloadClasses,
    excludedProviderIds: decision.candidates
      .filter((candidate) => candidate.excluded)
      .map((candidate) => candidate.providerId),
  });
  decision.policyRulesApplied = [...new Set([
    ...decision.policyRulesApplied,
    suitability.policyRuleId,
  ])];
}

export function applyObservedRouterEvidence(
  decision: RouteDecision,
  evidence: OpenRouterRoutingEvidence | undefined,
  routeDecisionLogId: Promise<string | null>,
): void {
  if (!decision.providerSuitabilityReceipt || !evidence) return;
  const completed = completeProviderSuitabilityRouteReceipt(decision.providerSuitabilityReceipt, evidence);
  if (completed === decision.providerSuitabilityReceipt) return;
  decision.providerSuitabilityReceipt = completed;
  void routeDecisionLogId.then((id) => id
    ? updateProviderSuitabilityReceipt(id, completed).catch((error) =>
        console.error("[routeAndCall] Failed to complete provider suitability receipt:", error),
      )
    : undefined);
}
