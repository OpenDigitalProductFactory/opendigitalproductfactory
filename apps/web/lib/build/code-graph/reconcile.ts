import { prisma } from "@dpf/db";

import { CODE_GRAPH_GRAPH_KEY, CODE_GRAPH_PROJECTION_VERSION } from "./constants";
import {
  getChangedFiles,
  getCurrentBranch,
  inspectGitRoot,
  getCurrentHeadSha,
  getGitRoot,
  isWorkspaceDirty,
  listTrackedFiles,
} from "./git-snapshot";
import {
  clearCodeGraph,
  ensureCodeGraphNeo4jSchema,
  syncTrackedFile,
  syncTrackedFilesFull,
} from "./neo4j-projection";
import {
  clearCodeGraphFileHashes,
  countCodeGraphFileHashes,
  findCodeGraphIndexState,
  markCodeGraphFailed,
  markCodeGraphIndexing,
  markCodeGraphReady,
} from "./state-store";

export type CodeGraphRefreshMode = "noop" | "incremental" | "full";

export type CodeGraphRefreshPlan = {
  mode: CodeGraphRefreshMode;
  changedFiles: string[];
};

export type ReconcileCodeGraphInput = {
  reason: "git-commit" | "git-backup" | "scheduled" | "manual";
  graphKey?: string;
  forceFull?: boolean;
};

export type ReconcileCodeGraphResult = {
  mode: CodeGraphRefreshMode;
  graphKey: string;
  headSha: string | null;
  branch: string | null;
  workspaceDirty: boolean;
  changedFiles: string[];
};

export function planCodeGraphRefresh(input: {
  indexedGraphVersion: number | null;
  currentGraphVersion: number;
  currentHeadSha: string | null;
  lastIndexedHeadSha: string | null;
  changedFiles: string[];
  diffFailed: boolean;
  forceFull: boolean;
}): CodeGraphRefreshPlan {
  if (
    input.forceFull ||
    input.indexedGraphVersion !== input.currentGraphVersion ||
    !input.lastIndexedHeadSha ||
    !input.currentHeadSha ||
    input.diffFailed
  ) {
    return { mode: "full", changedFiles: [] };
  }

  if (input.currentHeadSha === input.lastIndexedHeadSha) {
    return { mode: "noop", changedFiles: [] };
  }

  return {
    mode: "incremental",
    changedFiles: input.changedFiles,
  };
}

function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(filePath);
}

export function orderCodeGraphFilesForProjection(files: string[]): string[] {
  return [...files].sort((left, right) => {
    const leftRank = isTestFile(left) ? 1 : 0;
    const rightRank = isTestFile(right) ? 1 : 0;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

export async function reconcileCodeGraph(input: ReconcileCodeGraphInput): Promise<ReconcileCodeGraphResult> {
  const graphKey = input.graphKey ?? CODE_GRAPH_GRAPH_KEY;
  const gitRoot = getGitRoot();
  const observedAt = new Date();

  // Guard: production containers only ship the compiled app, not the source
  // git repository. Running git commands in a non-git directory hangs until
  // the timeout fires (SIGTERM), marking the code graph as failed on every
  // scheduled run. Skip gracefully instead.
  // ABSENT is a legitimate skip; REFUSED is a fault that must not be silent.
  //
  // BI-86EF5900: these were the same branch. The portal container runs as a
  // different uid than the checkout it mounts, so git answered every command
  // with "fatal: detected dubious ownership in repository at
  // '/sandbox-workspace'". That threw, isGitRepo returned false, and this guard
  // turned it into a no-op — on EVERY scheduled run, for a day, with no record
  // anywhere. The graph emptied and kept reporting "ready" for 4406 files
  // because nothing ever wrote a failure. Skipping silently is exactly how an
  // instrument dies without anyone noticing.
  const rootStatus = await inspectGitRoot(gitRoot);
  if (rootStatus.kind === "refused") {
    await markCodeGraphFailed(graphKey, {
      workspaceRoot: gitRoot,
      // Index state is not read until after this guard, so there is no prior
      // sha to carry here — the point of the record is the refusal itself.
      previousHeadSha: null,
      branch: null,
      workspaceDirty: false,
      observedAt,
      error: new Error(
        `Git refused to read the workspace at ${gitRoot}, so the code graph could not be ` +
          `indexed. This is NOT an absent repository — the repository is there and git ` +
          `declined. Detail: ${rootStatus.detail}`,
      ),
    });
    return {
      mode: "noop",
      graphKey,
      headSha: null,
      branch: null,
      workspaceDirty: false,
      changedFiles: [],
    };
  }
  if (rootStatus.kind === "absent") {
    return {
      mode: "noop",
      graphKey,
      headSha: null,
      branch: null,
      workspaceDirty: false,
      changedFiles: [],
    };
  }
  let state = await findCodeGraphIndexState(graphKey);
  let headSha: string | null = null;
  let branch: string | null = null;
  let workspaceDirty = false;

  const lockRows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${`code-graph:${graphKey}`})) AS locked
  `;
  if (!lockRows[0]?.locked) {
    return {
      mode: "noop",
      graphKey,
      headSha: null,
      branch: null,
      workspaceDirty: false,
      changedFiles: [],
    };
  }

  try {
    [state, headSha, branch, workspaceDirty] = await Promise.all([
      findCodeGraphIndexState(graphKey),
      getCurrentHeadSha(gitRoot),
      getCurrentBranch(gitRoot),
      isWorkspaceDirty(gitRoot),
    ]);

    await markCodeGraphIndexing(graphKey, {
      workspaceRoot: gitRoot,
      headSha,
      branch,
      previousHeadSha: state?.lastIndexedHeadSha ?? null,
      workspaceDirty,
      observedAt,
    });

    let changedFiles: string[] = [];
    let diffFailed = false;
    if (state?.lastIndexedHeadSha && headSha && state.lastIndexedHeadSha !== headSha && !input.forceFull) {
      try {
        changedFiles = await getChangedFiles(gitRoot, state.lastIndexedHeadSha, headSha);
      } catch {
        diffFailed = true;
      }
    }

    const plan = planCodeGraphRefresh({
      indexedGraphVersion: state?.graphVersion ?? null,
      currentGraphVersion: CODE_GRAPH_PROJECTION_VERSION,
      currentHeadSha: headSha,
      lastIndexedHeadSha: state?.lastIndexedHeadSha ?? null,
      changedFiles,
      diffFailed,
      forceFull: input.forceFull ?? false,
    });

    const files = orderCodeGraphFilesForProjection(
      plan.mode === "full" ? await listTrackedFiles(gitRoot) : plan.changedFiles,
    );
    await ensureCodeGraphNeo4jSchema();
    if (plan.mode === "full") {
      await clearCodeGraph(graphKey);
      await clearCodeGraphFileHashes(graphKey);
      await syncTrackedFilesFull(graphKey, gitRoot, files);
    } else {
      for (const filePath of files) {
        await syncTrackedFile(graphKey, gitRoot, filePath);
      }
    }
    const indexedFileCount = await countCodeGraphFileHashes(graphKey);
    await markCodeGraphReady(graphKey, {
      workspaceRoot: gitRoot,
      headSha,
      branch,
      workspaceDirty,
      observedAt,
      indexedFileCount,
    });
    return { mode: plan.mode, graphKey, headSha, branch, workspaceDirty, changedFiles: files };
  } catch (error) {
    await markCodeGraphFailed(graphKey, {
      workspaceRoot: gitRoot,
      previousHeadSha: state?.lastIndexedHeadSha ?? null,
      branch,
      workspaceDirty,
      observedAt,
      error,
    });
    throw error;
  } finally {
    await prisma.$executeRaw`
      SELECT pg_advisory_unlock(hashtext(${`code-graph:${graphKey}`}))
    `;
  }
}

export async function ensureCodeGraphInitialized(input: {
  reconcile?: (input: ReconcileCodeGraphInput) => Promise<unknown>;
} = {}): Promise<void> {
  const existingState = await findCodeGraphIndexState(CODE_GRAPH_GRAPH_KEY);
  const needsBootstrap =
    !existingState ||
    (existingState.indexStatus === "failed" && !existingState.lastIndexedHeadSha && !existingState.lastIndexedAt);

  if (!needsBootstrap) return;

  const reconcile = input.reconcile ?? reconcileCodeGraph;
  await reconcile({
    reason: "manual",
    graphKey: CODE_GRAPH_GRAPH_KEY,
    forceFull: true,
  });
}
