import type { BuildPhase } from "@/lib/feature-build-types";

export type OperatorBuildInput = {
  id: string;
  buildId: string;
  title: string;
  phase: BuildPhase;
  updatedAt: Date;
  needsYou: boolean;
};

export type OperatorBuildGroup = {
  key: "needs-you" | "in-progress" | "recent";
  label: "Needs you" | "In progress" | "Recent";
  builds: OperatorBuildInput[];
};

export type BuildActivityStep = {
  key: string;
  label: string;
  detail: string;
  state: "complete" | "current" | "upcoming" | "attention";
};

const ACTIVITY_STEPS: ReadonlyArray<Omit<BuildActivityStep, "state">> = [
  {
    key: "understand",
    label: "Outcome understood",
    detail: "The requested outcome and success conditions are captured.",
  },
  {
    key: "shape",
    label: "Approach shaped",
    detail: "The approach, constraints, risks, and plan are resolved.",
  },
  {
    key: "build",
    label: "Solution built",
    detail: "The change is implemented in the governed workspace.",
  },
  {
    key: "check",
    label: "Quality checked",
    detail: "Tests, review, and release evidence are being checked.",
  },
  {
    key: "ready",
    label: "Ready to use",
    detail: "The verified change is ready for governed release.",
  },
];

const CURRENT_STEP_BY_PHASE: Record<Exclude<BuildPhase, "complete" | "failed" | "abandoned">, number> = {
  ideate: 0,
  plan: 1,
  build: 2,
  review: 3,
  ship: 4,
};

function newestFirst(a: OperatorBuildInput, b: OperatorBuildInput): number {
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

export function groupOperatorBuilds(builds: OperatorBuildInput[]): OperatorBuildGroup[] {
  const needsYou = builds.filter((build) => build.needsYou).sort(newestFirst);
  const inProgress = builds
    .filter(
      (build) =>
        !build.needsYou
        && build.phase !== "complete"
        && build.phase !== "abandoned",
    )
    .sort(newestFirst);
  const recent = builds
    .filter(
      (build) =>
        !build.needsYou
        && (build.phase === "complete" || build.phase === "abandoned"),
    )
    .sort(newestFirst);

  return [
    { key: "needs-you", label: "Needs you", builds: needsYou },
    { key: "in-progress", label: "In progress", builds: inProgress },
    { key: "recent", label: "Recent", builds: recent },
  ].filter((group) => group.builds.length > 0) as OperatorBuildGroup[];
}

export function deriveBuildActivityStory(phase: BuildPhase): BuildActivityStep[] {
  if (phase === "failed" || phase === "abandoned") {
    return [
      { ...ACTIVITY_STEPS[0]!, state: "complete" },
      { ...ACTIVITY_STEPS[1]!, state: "complete" },
      {
        key: "recovery",
        label: phase === "failed" ? "Needs recovery" : "Work stopped",
        detail:
          phase === "failed"
            ? "Build Studio preserved the evidence and needs the blocker resolved before continuing."
            : "The evidence remains available if this outcome is resumed.",
        state: "attention",
      },
    ];
  }

  if (phase === "complete") {
    return ACTIVITY_STEPS.map((step) => ({ ...step, state: "complete" }));
  }

  const currentIndex = CURRENT_STEP_BY_PHASE[phase];
  return ACTIVITY_STEPS.map((step, index) => ({
    ...step,
    state: index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming",
  }));
}
