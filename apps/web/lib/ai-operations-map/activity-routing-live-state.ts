import {
  projectActivityPackagesRouting,
  projectBuildStudioActivityRouting,
} from "./project-activity-routing";
import type { ModelSelectionOverview } from "@/lib/inference/phase-model-resolution";
import { projectActivityOutcomes } from "./project-activity-outcomes";
import {
  buildGlmActivityPilotPackage,
  buildWorkCaseActivityPilotPackage,
  type ActivityPackage,
} from "@/lib/routing/activity-package";
import { parseWorkPatternMetadata } from "@/lib/tak/work-pattern-types";
import {
  activityHarnessOverridesFromProposalRows,
  type ActivityHarnessApprovalProposalRow,
} from "@/lib/routing/activity-harness-approval-source";

type ActivityPhaseSelection = Pick<ModelSelectionOverview, "generatedAt" | "phases">;

export function projectActivityRoutingFromLiveState(input: {
  providers: Array<{ providerId: string; status: string | null }>;
  taskRuns: Array<{
    taskRunId: string;
    title: string;
    a2aMetadata?: unknown;
    repeatedPatternKey?: string | null;
  }>;
  routeDecisions: Parameters<typeof projectActivityOutcomes>[0]["routeDecisions"];
  tokenUsage: Parameters<typeof projectActivityOutcomes>[0]["tokenUsage"];
  routeOutcomes: Parameters<typeof projectActivityOutcomes>[0]["routeOutcomes"];
  activityHarnessApprovalProposals: ActivityHarnessApprovalProposalRow[];
  phaseModelSelection: ActivityPhaseSelection;
}): ReturnType<typeof projectBuildStudioActivityRouting> | null {
  const packages = activityPackagesFromLiveState({
    providers: input.providers,
    taskRuns: input.taskRuns,
  });
  const outcomes = projectActivityOutcomes({
    routeDecisions: input.routeDecisions,
    tokenUsage: input.tokenUsage,
    routeOutcomes: input.routeOutcomes,
  });
  const overrides = activityHarnessOverridesFromProposalRows(
    input.activityHarnessApprovalProposals,
  );

  if (input.phaseModelSelection.phases.length > 0) {
    return mergeActivityRoutingWithPackages(
      projectBuildStudioActivityRouting({
        parentRef: {},
        generatedAt: new Date(input.phaseModelSelection.generatedAt),
        phases: input.phaseModelSelection.phases,
        observedOutcomes: outcomes,
        approvedConfidenceOverrides: overrides,
      }),
      packages,
    );
  }

  return packages.length > 0
    ? projectActivityPackagesRouting({
      taskRef: {},
      generatedAt: new Date(),
      packages,
    })
    : null;
}

function mergeActivityRoutingWithPackages(
  routing: ReturnType<typeof projectBuildStudioActivityRouting>,
  packages: ActivityPackage[],
): ReturnType<typeof projectBuildStudioActivityRouting> {
  if (packages.length === 0) return routing;
  const packageRouting = projectActivityPackagesRouting({
    taskRef: routing.taskRef,
    generatedAt: new Date(routing.generatedAt),
    packages,
  });
  return {
    ...routing,
    activities: [...routing.activities, ...packageRouting.activities],
  };
}

function activityPackagesFromLiveState(input: {
  providers: Array<{ providerId: string; status: string | null }>;
  taskRuns: Array<{
    taskRunId: string;
    title: string;
    a2aMetadata?: unknown;
    repeatedPatternKey?: string | null;
  }>;
}): ActivityPackage[] {
  const packages: ActivityPackage[] = [];
  const glmProvider = input.providers.find((provider) =>
    provider.providerId === "zai" || provider.providerId === "zai-coding",
  );
  if (glmProvider) {
    packages.push(buildGlmActivityPilotPackage({
      pilotId: "zai-provider-catalog",
      parentRef: { patternKey: "glm-center-provider-catalog" },
      credentialReady: glmProvider.status === "active",
    }));
  }

  const seenPatterns = new Set<string>();
  for (const taskRun of input.taskRuns) {
    const metadata = workPatternFromTaskRunMetadata(taskRun.a2aMetadata);
    if (!metadata?.workCaseBinding || seenPatterns.has(metadata.patternKey)) continue;
    seenPatterns.add(metadata.patternKey);
    packages.push(buildWorkCaseActivityPilotPackage({ metadata, title: taskRun.title }));
  }

  return packages;
}

function workPatternFromTaskRunMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseWorkPatternMetadata((value as Record<string, unknown>).workPattern);
}
