import type { WorkPatternExecutionProfile } from "@/lib/tak/work-pattern-experiment-types";

export type WorkPatternExperimentCellRequest = {
  experimentRunId: string;
  childTaskRunId: string;
  cellKey: string;
  pairKey: string;
  methodVariantKey: string;
  modelVariantKey: string;
  executionProfile: WorkPatternExecutionProfile;
  fixtureKey: string;
  oracleKey: string;
  oracleVersion: string;
  resourcePolicyKey: string;
};

export type WorkPatternExperimentWorkspace = {
  workspaceId: string;
  workdir: string;
};

export type WorkPatternExperimentDispatchResult = {
  success: boolean;
  providerId: string;
  modelId: string;
  filesChanged: string[];
  toolCalls: number;
  toolFailures: number;
  error?: string;
};

export type WorkPatternExperimentVerification = {
  unitTests: "pass" | "fail" | "not-applicable";
  productionBuild: "pass" | "fail" | "not-run";
  uxVerification: "pass" | "fail" | "not-applicable" | "blocked";
  migration: "pass" | "fail" | "not-applicable" | "blocked";
};

export type WorkPatternExperimentExecutionDeps = {
  prepareWorkspace: (
    request: WorkPatternExperimentCellRequest,
  ) => Promise<WorkPatternExperimentWorkspace>;
  dispatch: (input: {
    request: WorkPatternExperimentCellRequest;
    workspace: WorkPatternExperimentWorkspace;
  }) => Promise<WorkPatternExperimentDispatchResult>;
  verify: (input: {
    request: WorkPatternExperimentCellRequest;
    workspace: WorkPatternExperimentWorkspace;
    dispatch: WorkPatternExperimentDispatchResult;
  }) => Promise<WorkPatternExperimentVerification>;
  /**
   * Deliberately accepted only as a negative-capability test seam. The
   * experiment executor never calls these delivery/live-state operations.
   */
  prohibited?: {
    advanceFeatureBuild?: () => unknown;
    createPullRequest?: () => unknown;
    enqueueMerge?: () => unknown;
    release?: () => unknown;
    mutateLiveState?: () => unknown;
  };
};

export type WorkPatternExperimentCellResult = {
  experimentRunId: string;
  childTaskRunId: string;
  cellKey: string;
  pairKey: string;
  methodVariantKey: string;
  modelVariantKey: string;
  fixtureKey: string;
  oracleKey: string;
  oracleVersion: string;
  resourcePolicyKey: string;
  executionProfile: WorkPatternExecutionProfile;
  workspaceId: string;
  actualProviderId: string;
  actualModelId: string;
  success: boolean;
  filesChanged: string[];
  toolCalls: number;
  toolFailures: number;
  buildGate: WorkPatternExperimentVerification;
  failureClass?: string;
};

export type WorkPatternFactorialResult = {
  cells: WorkPatternExperimentCellResult[];
  factorial: {
    methodVariants: string[];
    modelVariants: string[];
    interactionCells: Array<{
      methodVariantKey: string;
      modelVariantKey: string;
      childTaskRunId: string;
      success: boolean;
    }>;
  };
};

function uniqueInOrder(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function assertComparableRequests(requests: readonly WorkPatternExperimentCellRequest[]): void {
  const first = requests[0];
  if (!first) throw new Error("missing_work_pattern_experiment_cells");
  for (const request of requests.slice(1)) {
    if (request.experimentRunId !== first.experimentRunId) {
      throw new Error("experiment_run_mismatch");
    }
    if (request.fixtureKey !== first.fixtureKey) throw new Error("fixture_mismatch");
    if (request.executionProfile.sourceCommitSha !== first.executionProfile.sourceCommitSha) {
      throw new Error("source_commit_mismatch");
    }
    if (
      request.executionProfile.taskCorpusKey !== first.executionProfile.taskCorpusKey
      || request.executionProfile.taskCorpusVersion
        !== first.executionProfile.taskCorpusVersion
    ) {
      throw new Error("corpus_mismatch");
    }
    if (request.oracleKey !== first.oracleKey || request.oracleVersion !== first.oracleVersion) {
      throw new Error("oracle_mismatch");
    }
    if (request.resourcePolicyKey !== first.resourcePolicyKey) {
      throw new Error("resource_policy_mismatch");
    }
  }
}

export async function executeWorkPatternExperimentCell(
  request: WorkPatternExperimentCellRequest,
  deps: WorkPatternExperimentExecutionDeps,
): Promise<WorkPatternExperimentCellResult> {
  const workspace = await deps.prepareWorkspace(request);
  const dispatch = await deps.dispatch({ request, workspace });
  const buildGate = await deps.verify({ request, workspace, dispatch });
  const gatePassed =
    buildGate.unitTests !== "fail"
    && buildGate.productionBuild !== "fail"
    && buildGate.uxVerification !== "fail"
    && buildGate.migration !== "fail";
  const success = dispatch.success && gatePassed;

  // Explicit projection: do not spread request/dispatch. That would persist
  // prompts, credentials, provider auth, or bulky tool transcripts added by a
  // future adapter.
  return {
    experimentRunId: request.experimentRunId,
    childTaskRunId: request.childTaskRunId,
    cellKey: request.cellKey,
    pairKey: request.pairKey,
    methodVariantKey: request.methodVariantKey,
    modelVariantKey: request.modelVariantKey,
    fixtureKey: request.fixtureKey,
    oracleKey: request.oracleKey,
    oracleVersion: request.oracleVersion,
    resourcePolicyKey: request.resourcePolicyKey,
    executionProfile: request.executionProfile,
    workspaceId: workspace.workspaceId,
    actualProviderId: dispatch.providerId,
    actualModelId: dispatch.modelId,
    success,
    filesChanged: [...dispatch.filesChanged],
    toolCalls: dispatch.toolCalls,
    toolFailures: dispatch.toolFailures,
    buildGate,
    ...(!success ? { failureClass: dispatch.error ? "dispatch_failed" : "verification_failed" } : {}),
  };
}

export async function executeWorkPatternFactorial(
  requests: readonly WorkPatternExperimentCellRequest[],
  deps: WorkPatternExperimentExecutionDeps,
): Promise<WorkPatternFactorialResult> {
  assertComparableRequests(requests);
  const identities = new Set<string>();
  for (const request of requests) {
    if (identities.has(request.cellKey)) throw new Error(`duplicate_experiment_cell:${request.cellKey}`);
    identities.add(request.cellKey);
  }

  const cells: WorkPatternExperimentCellResult[] = [];
  const workspaceIds = new Set<string>();
  for (const request of requests) {
    const result = await executeWorkPatternExperimentCell(request, deps);
    if (workspaceIds.has(result.workspaceId)) {
      throw new Error(`shared_mutable_experiment_workspace:${result.workspaceId}`);
    }
    workspaceIds.add(result.workspaceId);
    cells.push(result);
  }

  return {
    cells,
    factorial: {
      methodVariants: uniqueInOrder(requests.map((request) => request.methodVariantKey)),
      modelVariants: uniqueInOrder(requests.map((request) => request.modelVariantKey)),
      interactionCells: cells.map((result) => ({
        methodVariantKey: result.methodVariantKey,
        modelVariantKey: result.modelVariantKey,
        childTaskRunId: result.childTaskRunId,
        success: result.success,
      })),
    },
  };
}
