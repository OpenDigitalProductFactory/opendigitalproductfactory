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
    kind: "rebuild";
    label: "Rebuild";
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
// A dead draft the operator can neither resume nor learn from. startBacklogBuild
// (BI-08AE51DC) already detaches these and promotes a FRESH draft, so the row
// must offer a Rebuild action rather than a Resume link into the corpse — the
// missing frontend half of that fix (BI-99D896CF). Mirrors the "abandoned" entry
// in backlog-build.ts TERMINAL_BUILD_PHASES; "panicked" is intentionally excluded
// because startBacklogBuild still treats it as live (routes to the existing build).
const DEAD_DRAFT_PHASES = new Set(["abandoned"]);

export function resolveBacklogBuildActionState(
  item: BacklogBuildActionItem,
): BacklogBuildActionState {
  if (item.activeBuild?.buildId) {
    const phase = item.activeBuild.phase ?? "";
    const href = `/build?buildId=${encodeURIComponent(item.activeBuild.buildId)}`;
    if (DEAD_DRAFT_PHASES.has(phase)) {
      return {
        kind: "rebuild",
        label: "Rebuild",
        href: null,
        disabled: false,
      };
    }
    if (HISTORICAL_BUILD_PHASES.has(phase)) {
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
