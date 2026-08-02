import {
  compileBuildStudioPhaseActivity,
  type BuildStudioActivityPhase,
} from "@/lib/routing/activity-compiler";
import { calibrateActivityHarnesses } from "@/lib/routing/activity-harness-calibration";
import type { ActivityHarnessCalibration } from "@/lib/routing/activity-harness-calibration";
import { buildActivityHarnessActionProposals } from "@/lib/routing/activity-harness-governance";
import type {
  ActivityHarnessActionProposal,
  ActivityHarnessConfidenceOverride,
} from "@/lib/routing/activity-harness-governance";
import { bindHarnessRecipeForActivity } from "@/lib/routing/harness-recipe";
import type { ActivityParentRef } from "@/lib/routing/activity-contract";
import type { ActivityPackage } from "@/lib/routing/activity-package";
import type { EnableCandidate } from "@/lib/inference/phase-enable-candidates";
import type {
  OperationsMapActivityOutcome,
  OperationsMapActivityRouting,
  OperationsMapActivityRoutingExclusion,
  OperationsMapActivityStep,
  OperationsMapActivitySuccessSignal,
} from "./types";

type ActivityPhaseFlag = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  remediation: string;
};

export type ActivityPhaseResolutionSourceRow = {
  phase: BuildStudioActivityPhase;
  label: string;
  providerId: string | null;
  modelId: string | null;
  rationale: string;
  flags: ActivityPhaseFlag[];
  enableCandidates?: EnableCandidate[];
};

export type ProjectBuildStudioActivityRoutingInput = {
  parentRef: ActivityParentRef;
  phases: ActivityPhaseResolutionSourceRow[];
  observedOutcomes?: OperationsMapActivityOutcome[];
  approvedConfidenceOverrides?: ActivityHarnessConfidenceOverride[];
  generatedAt: Date;
};

export type ProjectActivityPackagesRoutingInput = {
  taskRef: ActivityParentRef;
  packages: ActivityPackage[];
  generatedAt: Date;
};

export function projectBuildStudioActivityRouting(
  input: ProjectBuildStudioActivityRoutingInput,
): OperationsMapActivityRouting {
  const calibrations = calibrateActivityHarnesses((input.observedOutcomes ?? []).map((outcome) => ({
    activityClass: outcome.activityClass,
    harnessRecipeKey: outcome.harnessRecipeKey,
    confidence: outcome.confidence,
    providerId: outcome.providerId,
    modelId: outcome.modelId,
    successSignal: outcome.successSignal,
    evidenceStrength: outcome.evidenceStrength,
    tokenTotal: outcome.tokenTotal,
    costUsd: outcome.costUsd,
    qualitySignal: outcome.qualitySignal,
  })));
  const actionProposals = buildActivityHarnessActionProposals(calibrations);

  return {
    taskRef: input.parentRef,
    generatedAt: input.generatedAt.toISOString(),
    activities: input.phases.map((phase) =>
      projectPhaseActivity(
        input.parentRef,
        phase,
        input.observedOutcomes ?? [],
        calibrations,
        actionProposals,
        input.approvedConfidenceOverrides ?? [],
      ),
    ),
  };
}

export function projectActivityPackagesRouting(
  input: ProjectActivityPackagesRoutingInput,
): OperationsMapActivityRouting {
  return {
    taskRef: input.taskRef,
    generatedAt: input.generatedAt.toISOString(),
    activities: input.packages.map(projectPackageActivity),
  };
}

function projectPackageActivity(activityPackage: ActivityPackage): OperationsMapActivityStep {
  const providerId = selectedProviderFromPackage(activityPackage);
  const modelId = selectedModelFromPackage(activityPackage);
  return {
    activityId: activityPackage.activity.activityId,
    label: activityPackage.activity.title,
    activityClass: activityPackage.activity.activityClass,
    distributionShape: activityPackage.activity.distributionShape,
    riskClass: activityPackage.activity.riskClass,
    selectedProviderId: providerId,
    selectedModelId: modelId,
    harnessRecipeKey: activityPackage.harness?.recipeKey ?? null,
    confidence: activityPackage.harness?.activityConfidence ?? null,
    successSignal: activityPackage.readiness.state === "blocked" ? "attention" : "unknown",
    costUsd: null,
    tokenTotal: null,
    routeDecisionId: null,
    adapterTelemetryId: null,
    decisionSummary: activityPackage.readiness.reason,
    tuningRecommendation: null,
    tuningRationale: null,
    actionProposalId: null,
    actionProposalAction: null,
    actionProposalRecommendedConfidence: null,
    actionProposalSummary: null,
    approvedConfidenceOverrideId: null,
    exclusions: packageExclusions(activityPackage, providerId, modelId),
    enableCandidates: [],
  };
}

function selectedProviderFromPackage(activityPackage: ActivityPackage): string | null {
  if (activityPackage.harness?.providerFamily === "zai") return "zai";
  return null;
}

function selectedModelFromPackage(activityPackage: ActivityPackage): string | null {
  if (activityPackage.harness?.modelFamily === "glm") return "glm-5.2";
  return null;
}

function packageExclusions(
  activityPackage: ActivityPackage,
  providerId: string | null,
  modelId: string | null,
): OperationsMapActivityRoutingExclusion[] {
  if (activityPackage.readiness.state !== "blocked") return [];
  return [
    {
      providerId: providerId ?? "activity-package",
      modelId,
      reason: activityPackage.readiness.reason,
    },
  ];
}

function projectPhaseActivity(
  parentRef: ActivityParentRef,
  phase: ActivityPhaseResolutionSourceRow,
  observedOutcomes: OperationsMapActivityOutcome[],
  calibrations: ActivityHarnessCalibration[],
  actionProposals: ActivityHarnessActionProposal[],
  approvedConfidenceOverrides: ActivityHarnessConfidenceOverride[],
): OperationsMapActivityStep {
  const activity = compileBuildStudioPhaseActivity({
    phase: phase.phase,
    parentRef,
  });
  const harnessRecipe = bindHarnessRecipeForActivity(activity, {
    providerId: phase.providerId,
    modelId: phase.modelId,
  });
  const observedOutcome = observedOutcomes.find((outcome) =>
    outcome.activityClass === activity.activityClass &&
    outcome.harnessRecipeKey === harnessRecipe.recipeKey &&
    outcome.providerId === phase.providerId &&
    outcome.modelId === phase.modelId,
  );
  const calibration = calibrations.find((entry) =>
    entry.activityClass === activity.activityClass &&
    entry.harnessRecipeKey === harnessRecipe.recipeKey &&
    entry.providerId === phase.providerId &&
    entry.modelId === phase.modelId,
  );
  const actionProposal = actionProposals.find((proposal) =>
    proposal.activityClass === activity.activityClass &&
    proposal.harnessRecipeKey === harnessRecipe.recipeKey &&
    proposal.providerId === phase.providerId &&
    proposal.modelId === phase.modelId,
  );
  const approvedOverride = approvedConfidenceOverrides.find((override) =>
    override.activityClass === activity.activityClass &&
    override.harnessRecipeKey === harnessRecipe.recipeKey &&
    override.providerId === phase.providerId &&
    override.modelId === phase.modelId,
  );

  return {
    activityId: activity.activityId,
    label: phase.label,
    activityClass: activity.activityClass,
    distributionShape: activity.distributionShape,
    riskClass: activity.riskClass,
    selectedProviderId: phase.providerId,
    selectedModelId: phase.modelId,
    harnessRecipeKey: harnessRecipe.recipeKey,
    confidence: approvedOverride?.confidence ?? harnessRecipe.activityConfidence,
    successSignal: observedOutcome?.successSignal ?? successSignalFromFlags(phase.flags),
    costUsd: observedOutcome?.costUsd ?? null,
    tokenTotal: observedOutcome?.tokenTotal ?? null,
    routeDecisionId: observedOutcome?.routeDecisionId ?? null,
    adapterTelemetryId: null,
    decisionSummary: phase.rationale,
    tuningRecommendation: calibration?.recommendation ?? null,
    tuningRationale: calibration?.rationale ?? null,
    actionProposalId: actionProposal?.proposalId ?? null,
    actionProposalAction: actionProposal?.action ?? null,
    actionProposalRecommendedConfidence: actionProposal?.recommendedConfidence ?? null,
    actionProposalSummary: actionProposal?.summary ?? null,
    approvedConfidenceOverrideId: approvedOverride?.proposalId ?? null,
    exclusions: exclusionsFromFlags(phase.flags),
    enableCandidates: phase.enableCandidates ?? [],
  };
}

function successSignalFromFlags(
  flags: ActivityPhaseFlag[],
): OperationsMapActivitySuccessSignal {
  if (flags.some((flag) => flag.severity === "error")) return "failed";
  if (flags.length > 0) return "attention";
  return "unknown";
}

function exclusionsFromFlags(flags: ActivityPhaseFlag[]): OperationsMapActivityRoutingExclusion[] {
  return flags.map((flag) => ({
    providerId: flag.severity === "error" ? "routing-error" : "routing-warning",
    modelId: null,
    reason: flag.message,
    code: flag.code,
    remediation: flag.remediation,
  }));
}
