import {
  SETUP_STEPS,
  type SetupStep,
  type StepStatus,
} from "@/lib/actions/setup-constants";

type ProjectStepResolutionInput = {
  resolvedStep: SetupStep;
  resolution: Exclude<StepStatus, "pending">;
  steps: Record<string, StepStatus>;
};

export type SetupProgressProjection = {
  currentStep: SetupStep;
  isComplete: boolean;
  steps: Record<string, StepStatus>;
};

/**
 * The legacy setup progress row is a projection of completed setup evidence.
 * Always choose the first unresolved step so evidence arriving out of order can
 * be retained without moving the operator past work they have not completed.
 */
export function projectSetupStepResolution({
  resolvedStep,
  resolution,
  steps,
}: ProjectStepResolutionInput): SetupProgressProjection {
  const projectedSteps = { ...steps, [resolvedStep]: resolution };
  const firstPending = SETUP_STEPS.find(
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
}: {
  completedStep: SetupStep;
  steps: Record<string, StepStatus>;
}): SetupProgressProjection {
  return projectSetupStepResolution({
    resolvedStep: completedStep,
    resolution: "completed",
    steps,
  });
}
