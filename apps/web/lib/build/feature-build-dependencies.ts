export type DependencyBuildPhase = string;

export type FeatureBuildDependencyBuild = {
  id: string;
  buildId: string;
  title: string;
  phase: DependencyBuildPhase;
};

export type FeatureBuildDependencyGateBuild = {
  id: string;
  buildId: string;
  title: string;
  parentEpicId: string | null;
  phase: DependencyBuildPhase;
  /** Owner — used to dispatch the dependent's plan when it becomes ready.
   *  Optional because only the completion-select path (which drives dispatch)
   *  populates it; the plain gate-check path does not need it. */
  createdById?: string | null;
  dependenciesOut: ReadonlyArray<{
    dependsOn: FeatureBuildDependencyBuild;
  }>;
};

export type WaitingOnDependency = {
  buildId: string;
  title: string;
  phase: DependencyBuildPhase;
};

export type FeatureBuildDependencyGateResult =
  | { allowed: true; waitingOn: [] }
  | { allowed: false; waitingOn: WaitingOnDependency[]; message: string };

export type ReadyDependentBuild = {
  buildId: string;
  title: string;
  phase: DependencyBuildPhase;
  createdById: string | null;
};

export const FEATURE_BUILD_DEPENDENCY_READY_TOOL = "dependency:ready";

export const FEATURE_BUILD_DEPENDENCY_GATE_SELECT = {
  id: true,
  buildId: true,
  title: true,
  parentEpicId: true,
  phase: true,
  dependenciesOut: {
    select: {
      dependsOn: {
        select: {
          id: true,
          buildId: true,
          title: true,
          phase: true,
        },
      },
    },
  },
} as const;

export const FEATURE_BUILD_DEPENDENCY_COMPLETION_SELECT = {
  id: true,
  buildId: true,
  title: true,
  parentEpicId: true,
  phase: true,
  dependenciesIn: {
    select: {
      dependent: {
        select: {
          id: true,
          buildId: true,
          title: true,
          parentEpicId: true,
          phase: true,
          createdById: true,
          dependenciesOut: {
            select: {
              dependsOn: {
                select: {
                  id: true,
                  buildId: true,
                  title: true,
                  phase: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

type CompletionSourceBuild = FeatureBuildDependencyBuild & {
  parentEpicId: string | null;
  dependenciesIn: ReadonlyArray<{
    dependent: FeatureBuildDependencyGateBuild;
  }>;
};

type FeatureBuildDependencyDb = {
  featureBuild: {
    findUnique(args: {
      where: { buildId: string };
      select: typeof FEATURE_BUILD_DEPENDENCY_COMPLETION_SELECT;
    }): Promise<CompletionSourceBuild | null>;
  };
  buildActivity: {
    create(args: {
      data: {
        buildId: string;
        tool: string;
        summary: string;
      };
    }): Promise<unknown>;
  };
};

export function deriveFeatureBuildDependencyGate(
  build: FeatureBuildDependencyGateBuild,
): FeatureBuildDependencyGateResult {
  if (build.parentEpicId == null) {
    return { allowed: true, waitingOn: [] };
  }

  const waitingOn = build.dependenciesOut
    .flatMap((edge) => (
      edge.dependsOn.phase === "complete"
        ? []
        : [{
            buildId: edge.dependsOn.buildId,
            title: edge.dependsOn.title,
            phase: edge.dependsOn.phase,
          }]
    ))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (waitingOn.length === 0) {
    return { allowed: true, waitingOn: [] };
  }

  const titleList = waitingOn.map((dependency) => dependency.title).join(", ");
  return {
    allowed: false,
    waitingOn,
    message: `Waiting on: ${titleList}. Complete those sibling builds before starting implementation for ${build.title}.`,
  };
}

export function assertFeatureBuildDependencyGate(
  build: FeatureBuildDependencyGateBuild,
): void {
  const gate = deriveFeatureBuildDependencyGate(build);
  if (!gate.allowed) {
    throw new Error(gate.message);
  }
}

export async function assertFeatureBuildDependenciesSatisfied(args: {
  db: {
    featureBuild: {
      findUnique(query: {
        where: { buildId: string };
        select: typeof FEATURE_BUILD_DEPENDENCY_GATE_SELECT;
      }): Promise<FeatureBuildDependencyGateBuild | null>;
    };
  };
  buildId: string;
}): Promise<FeatureBuildDependencyGateResult> {
  const build = await args.db.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: FEATURE_BUILD_DEPENDENCY_GATE_SELECT,
  });
  if (!build) throw new Error("Build not found");

  const gate = deriveFeatureBuildDependencyGate(build);
  if (!gate.allowed) {
    throw new Error(gate.message);
  }
  return gate;
}

export function deriveReadyDependentsAfterCompletion(args: {
  completedBuild: FeatureBuildDependencyBuild & { parentEpicId: string | null };
  dependents: ReadonlyArray<FeatureBuildDependencyGateBuild>;
}): ReadyDependentBuild[] {
  if (args.completedBuild.parentEpicId == null || args.completedBuild.phase !== "complete") {
    return [];
  }

  return args.dependents
    .filter((dependent) => {
      if (dependent.parentEpicId !== args.completedBuild.parentEpicId) return false;
      if (dependent.phase === "complete" || dependent.phase === "failed") return false;
      return dependent.dependenciesOut.every((edge) => edge.dependsOn.phase === "complete");
    })
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((dependent) => ({
      buildId: dependent.buildId,
      title: dependent.title,
      phase: dependent.phase,
      createdById: dependent.createdById ?? null,
    }));
}

export async function recordReadyDependentsAfterCompletion(args: {
  db: FeatureBuildDependencyDb;
  buildId: string;
  /** Injectable for tests; defaults to the real plan dispatcher (dynamic import
   *  to avoid a static cycle with plan-on-approval). Mirrors approve-decomposition. */
  dispatchPlanForChild?: (params: { buildId: string; userId: string }) => Promise<unknown>;
}): Promise<ReadyDependentBuild[]> {
  const completedBuild = await args.db.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: FEATURE_BUILD_DEPENDENCY_COMPLETION_SELECT,
  });
  if (!completedBuild) return [];

  const readyDependents = deriveReadyDependentsAfterCompletion({
    completedBuild,
    dependents: completedBuild.dependenciesIn.map((edge) => edge.dependent),
  });

  await Promise.all(
    readyDependents.map((dependent) =>
      args.db.buildActivity.create({
        data: {
          buildId: dependent.buildId,
          tool: FEATURE_BUILD_DEPENDENCY_READY_TOOL,
          summary: `Ready to plan: all upstream dependency builds are complete for ${dependent.title}.`,
        },
      }).catch(() => {}),
    ),
  );

  // BI-E49DDE47 (dependency-release half): approve-decomposition dispatches the
  // UNBLOCKED heads, but dependency-chained siblings were only logged
  // "ready to plan" here and never dispatched — so they stranded in `plan` after
  // their upstream completed. Now that all upstream dependencies are complete,
  // dispatch plan generation so the chain actually advances. Fire-and-forget
  // (mirrors the ideate→plan handoff); a null owner or dispatch failure is logged,
  // never blocks the completing build.
  const dispatchPlanForChild =
    args.dispatchPlanForChild ??
    (async (params: { buildId: string; userId: string }) => {
      const { dispatchPlanForApprovedBuild } = await import("@/lib/integrate/plan-on-approval");
      return dispatchPlanForApprovedBuild(params);
    });
  await Promise.all(
    readyDependents.map(async (dependent) => {
      if (!dependent.createdById) {
        console.warn(
          `[feature-build-dependencies] ready dependent ${dependent.buildId} has no owner — cannot dispatch plan`,
        );
        return;
      }
      try {
        await dispatchPlanForChild({ buildId: dependent.buildId, userId: dependent.createdById });
      } catch (err) {
        console.warn(
          `[feature-build-dependencies] plan dispatch for ready dependent ${dependent.buildId} failed:`,
          (err as Error)?.message,
        );
      }
    }),
  );

  return readyDependents;
}
