import {
  defaultWorkspaceHomeRegistry,
  resolveWorkspaceHomeContribution,
  type WorkspaceHomeRegistry,
} from "./registry";
import type {
  WorkspaceHomeArchetypeRef,
  WorkspaceHomeSetupActivationSummary,
} from "./types";

type BuildWorkspaceHomeActivationSummaryInput = {
  archetype: WorkspaceHomeArchetypeRef;
  registry?: WorkspaceHomeRegistry;
};

export function buildWorkspaceHomeActivationSummary({
  archetype,
  registry = defaultWorkspaceHomeRegistry,
}: BuildWorkspaceHomeActivationSummaryInput): WorkspaceHomeSetupActivationSummary {
  const resolution = resolveWorkspaceHomeContribution({
    storefrontConfig: { archetype },
    registry,
  });

  if (resolution.mode === "vertical") {
    return {
      archetypeId: archetype.archetypeId,
      archetypeName: archetype.name ?? null,
      mode: resolution.mode,
      match: resolution.match,
      label: resolution.contribution.label,
      status: resolution.contribution.setupActivation.status,
      sourceContributionId: resolution.contribution.id,
      primitiveWidgets: resolution.contribution.setupActivation.primitiveWidgets,
      requiredCanonicalData: resolution.contribution.setupActivation.requiredCanonicalData,
      requiredSignals: resolution.contribution.setupActivation.requiredSignals,
      missingDataBehavior: resolution.contribution.setupActivation.missingDataBehavior,
      fallback: null,
      setupAction: null,
    };
  }

  return {
    archetypeId: archetype.archetypeId,
    archetypeName: archetype.name ?? null,
    mode: "unconfigured",
    match: "none",
    label: "Platform workspace view",
    status: "not-configured",
    sourceContributionId: null,
    primitiveWidgets: [],
    requiredCanonicalData: [],
    requiredSignals: [],
    missingDataBehavior: "platform-fallback",
    fallback: "platform",
    setupAction: resolution.setupAction,
  };
}

export function buildWorkspaceHomeActivationSummaries(
  archetypes: WorkspaceHomeArchetypeRef[],
  registry: WorkspaceHomeRegistry = defaultWorkspaceHomeRegistry,
): Record<string, WorkspaceHomeSetupActivationSummary> {
  return Object.fromEntries(
    archetypes.map((archetype) => [
      archetype.archetypeId ?? archetype.name ?? archetype.category ?? "unknown-archetype",
      buildWorkspaceHomeActivationSummary({ archetype, registry }),
    ]),
  );
}
