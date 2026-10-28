import {
  visibleSetupSteps,
  type MonitoringCapabilityDecision,
  type SetupStep,
  type StepStatus,
} from "@/lib/actions/setup-constants";

type ProjectStepResolutionInput = {
  resolvedStep: SetupStep;
  resolution: Exclude<StepStatus, "pending">;
  steps: Record<string, StepStatus>;
  /**
   * Absent (null/omitted) hides monitoring. Only an explicit "undecided"
   * keeps it in the pending sequence.
   */
  monitoringDecision?: MonitoringCapabilityDecision | null;
};

export type SetupProgressProjection = {
  currentStep: SetupStep;
  isComplete: boolean;
  steps: Record<string, StepStatus>;
};

/** A hidden monitoring step must not stay pending. A recorded choice completes it; no record skips it. */
function resolveHiddenMonitoringStep(
  steps: Record<string, StepStatus>,
  monitoringDecision: MonitoringCapabilityDecision | null,
): void {
  if (monitoringDecision === "undecided") return;
  if ((steps.monitoring ?? "pending") !== "pending") return;
  steps.monitoring =
    monitoringDecision === "enabled" || monitoringDecision === "disabled" ? "completed" : "skipped";
}

/**
 * The legacy setup progress row is a projection of completed setup evidence.
 * Always choose the first unresolved step so evidence arriving out of order can
 * be retained without moving the operator past work they have not completed.
 * A hidden monitoring step is resolved here so it cannot block that sequence.
 */
export function projectSetupStepResolution({
  resolvedStep,
  resolution,
  steps,
  monitoringDecision = null,
}: ProjectStepResolutionInput): SetupProgressProjection {
  const projectedSteps = { ...steps, [resolvedStep]: resolution };
  resolveHiddenMonitoringStep(projectedSteps, monitoringDecision);
  const offered = visibleSetupSteps(monitoringDecision);
  const firstPending = offered.find(
    (step) => (projectedSteps[step] ?? "pending") === "pending",
  );

  return {
    currentStep: firstPending ?? resolvedStep,
    isComplete: firstPending === undefined,
    steps: projectedSteps,
  };
}

export function projectSetupStepCompletion({
  completedStep,
  steps,
  monitoringDecision = null,
}: {
  completedStep: SetupStep;
  steps: Record<string, StepStatus>;
  monitoringDecision?: MonitoringCapabilityDecision | null;
}): SetupProgressProjection {
  return projectSetupStepResolution({
    resolvedStep: completedStep,
    resolution: "completed",
    steps,
    monitoringDecision,
  });
}
