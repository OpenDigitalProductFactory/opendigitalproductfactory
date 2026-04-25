export type LifecycleLabel =
  | "Captured"
  | "Triaging"
  | "Prepared Draft"
  | "Ready to Start"
  | "In Progress"
  | "Ready to Release"
  | "Done";

type LifecycleBacklogItem = {
  status: string;
  triageOutcome?: string | null;
  activeBuildId?: string | null;
};

type LifecycleFeatureBuild = {
  phase: string;
  draftApprovedAt?: Date | null;
};

export function deriveLifecycleLabel(input: {
  backlogItem: LifecycleBacklogItem | null;
  featureBuild: LifecycleFeatureBuild | null;
  governedBacklogEnabled: boolean;
}): LifecycleLabel | null {
  const { backlogItem, featureBuild, governedBacklogEnabled } = input;

  if (!backlogItem) {
    return null;
  }

  if (backlogItem.status === "done") {
    return "Done";
  }

  if (backlogItem.status === "triaging") {
    return backlogItem.triageOutcome == null ? "Captured" : "Triaging";
  }

  if (featureBuild?.phase === "ship") {
    return "Ready to Release";
  }

  if (backlogItem.status === "in-progress") {
    return "In Progress";
  }

  const hasActiveDraft =
    backlogItem.status === "open" &&
    backlogItem.activeBuildId != null &&
    featureBuild?.phase === "ideate";

  if (hasActiveDraft) {
    if (!governedBacklogEnabled) {
      return "In Progress";
    }

    return featureBuild?.draftApprovedAt != null
      ? "Ready to Start"
      : "Prepared Draft";
  }

  return null;
}
