type BacklogBuildActionItem = {
  status: string;
  triageOutcome?: string | null;
  effortSize?: string | null;
  activeBuildId?: string | null;
  activeBuild?: {
    buildId: string;
    phase: string | null;
  } | null;
};

export type BacklogBuildActionState =
  | {
    kind: "start";
    label: "Start build";
    href: null;
    disabled: false;
  }
  | {
    kind: "resume";
    label: "Resume build";
    href: string;
    disabled: false;
  }
  | {
    kind: "open";
    label: "Open build";
    href: string;
    disabled: false;
  }
  | {
    kind: "blocked";
    label: "Build blocked";
    href: null;
    disabled: true;
    reason: string;
  };

const BUILD_READY_EFFORT_SIZES = new Set(["small", "medium", "large"]);
const HISTORICAL_BUILD_PHASES = new Set(["complete", "failed"]);

export function resolveBacklogBuildActionState(
  item: BacklogBuildActionItem,
): BacklogBuildActionState {
  if (item.activeBuild?.buildId) {
    const href = `/build?buildId=${encodeURIComponent(item.activeBuild.buildId)}`;
    if (HISTORICAL_BUILD_PHASES.has(item.activeBuild.phase ?? "")) {
      return {
        kind: "open",
        label: "Open build",
        href,
        disabled: false,
      };
    }

    return {
      kind: "resume",
      label: "Resume build",
      href,
      disabled: false,
    };
  }

  if (item.activeBuildId) {
    return blocked("Linked Build Studio draft is unavailable.");
  }

  if (item.status !== "open") {
    return blocked("Item must be open.");
  }

  if (item.triageOutcome !== "build") {
    return blocked("Triage outcome must be build.");
  }

  if (!item.effortSize || !BUILD_READY_EFFORT_SIZES.has(item.effortSize)) {
    return blocked("Effort size must be small, medium, or large.");
  }

  return {
    kind: "start",
    label: "Start build",
    href: null,
    disabled: false,
  };
}

function blocked(reason: string): BacklogBuildActionState {
  return {
    kind: "blocked",
    label: "Build blocked",
    href: null,
    disabled: true,
    reason,
  };
}
