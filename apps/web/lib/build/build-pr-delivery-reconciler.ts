import {
  enablePullRequestAutoMerge,
  observeGithubPullRequest,
  projectGithubPrReadiness,
  updatePullRequestBranch,
  type GithubPrObservation,
  type GithubPrReadiness,
} from "@/lib/integrate/github-pr-readiness";
import {
  createBuildPrDeliveryState,
  type BuildPrDeliveryStateV1,
  type BuildPrDeliveryStatus,
} from "./build-pr-delivery-state";
import {
  captureBuildPrOntoCapsule,
  persistBuildPrDeliveryStateForBuild,
  type CaptureBuildPrDeps,
} from "./capture-build-pr";
const MAX_STALE_UPDATES = 2;
const MAX_UNKNOWN_OBSERVATIONS = 6;

export type BuildPrDeliveryAction =
  | { kind: "queue" | "update-branch"; headSha: string }
  | {
      kind: "wait" | "escalate";
      status: BuildPrDeliveryStatus;
      headSha: string | null;
      reason: string;
    };

export function decideBuildPrDeliveryAction(input: {
  state: BuildPrDeliveryStateV1;
  readiness: GithubPrReadiness;
}): BuildPrDeliveryAction {
  const { state, readiness } = input;
  switch (readiness.kind) {
    case "merged":
      return {
        kind: "wait",
        status: "awaiting-release",
        headSha: readiness.headSha,
        reason: "merged-awaiting-governed-release",
      };
    case "closed":
      return {
        kind: "escalate",
        status: "closed",
        headSha: readiness.headSha,
        reason: "pull-request-closed-unmerged",
      };
    case "conflict":
      return {
        kind: "escalate",
        status: "escalated",
        headSha: readiness.headSha,
        reason: "true-merge-conflict",
      };
    case "behind":
      return state.staleUpdateAttempts < MAX_STALE_UPDATES
        ? { kind: "update-branch", headSha: readiness.headSha }
        : {
            kind: "escalate",
            status: "escalated",
            headSha: readiness.headSha,
            reason: "stale-update-budget-exhausted",
          };
    case "ready":
      return state.lastActuatedHeadSha === readiness.headSha
        ? {
            kind: "wait",
            status: "queued",
            headSha: readiness.headSha,
            reason: "already-actuated",
          }
        : { kind: "queue", headSha: readiness.headSha };
    case "queued":
      return {
        kind: "wait",
        status: "queued",
        headSha: readiness.headSha,
        reason: "merge-queue-enrolled",
      };
    case "checking":
      return {
        kind: "wait",
        status: "checking",
        headSha: readiness.headSha,
        reason: readiness.reason,
      };
    case "unknown":
      return state.reconciliationAttempts >= MAX_UNKNOWN_OBSERVATIONS
        ? {
            kind: "escalate",
            status: "escalated",
            headSha: readiness.headSha,
            reason: `observation-budget-exhausted:${readiness.reason}`,
          }
        : {
            kind: "wait",
            status: "checking",
            headSha: readiness.headSha,
            reason: readiness.reason,
          };
  }
}

export type BuildPrReconcilerMode = "off" | "shadow" | "enforce";

export function resolveBuildPrReconcilerMode(value = process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE): BuildPrReconcilerMode {
  const normalized = (value ?? "shadow").trim().toLowerCase();
  return normalized === "shadow" || normalized === "enforce" ? normalized : "off";
}

export async function executeBuildPrDeliveryAction(input: {
  state: BuildPrDeliveryStateV1;
  observation: GithubPrObservation;
  readiness: GithubPrReadiness;
  mode: BuildPrReconcilerMode;
  token: string;
  owner: string;
  repo: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ state: BuildPrDeliveryStateV1; action: BuildPrDeliveryAction; actuated: boolean }> {
  const action = decideBuildPrDeliveryAction({ state: input.state, readiness: input.readiness });
  const now = (input.now ?? new Date()).toISOString();
  let next: BuildPrDeliveryStateV1 = {
    ...input.state,
    reconciliationAttempts: input.state.reconciliationAttempts + 1,
    lastObservedHeadSha: input.readiness.headSha,
    lastReadiness: input.readiness.kind,
    lastObservedAt: now,
    lastError: null,
  };

  if (action.kind === "wait") {
    next = { ...next, status: action.status };
    return { state: next, action, actuated: false };
  }
  if (action.kind === "escalate") {
    next = {
      ...next,
      status: action.status,
      escalationKey: next.escalationKey ?? `build-pr-delivery:${input.state.prNumber}:${action.reason}`,
      lastError: action.reason,
    };
    return { state: next, action, actuated: false };
  }
  if (input.mode !== "enforce") {
    next = {
      ...next,
      status: "checking",
      lastError: input.mode === "shadow" ? `shadow-proposed:${action.kind}` : "reconciler-disabled",
    };
    return { state: next, action, actuated: false };
  }

  if (action.kind === "update-branch") {
    const result = await updatePullRequestBranch({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.state.prNumber,
      expectedHeadSha: action.headSha,
      token: input.token,
      fetchImpl: input.fetchImpl,
    });
    next = {
      ...next,
      status: result === "accepted" ? "updating" : "checking",
      staleUpdateAttempts: next.staleUpdateAttempts + (result === "accepted" ? 1 : 0),
      lastError: result === "head-changed" ? "head-changed-during-update" : null,
    };
    return { state: next, action, actuated: result === "accepted" };
  }

  if (input.observation.headSha !== action.headSha) {
    return {
      state: { ...next, status: "checking", lastError: "head-changed-before-queue" },
      action,
      actuated: false,
    };
  }
  await enablePullRequestAutoMerge({
    nodeId: input.observation.nodeId,
    token: input.token,
    fetchImpl: input.fetchImpl,
  });
  next = {
    ...next,
    status: "queued",
    lastActuatedHeadSha: action.headSha,
  };
  return { state: next, action, actuated: true };
}

/**
 * Single PR-created choke point shared by Build Studio's portal-PR and
 * contribute-to-hive paths. Durable state must exist before any GitHub
 * actuation; otherwise the operation is withheld so a restart cannot strand it.
 */
export async function initializeAndReconcileBuildPrDelivery(input: {
  db: CaptureBuildPrDeps;
  featureBuildId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  token: string;
  eligible?: boolean;
  mode?: BuildPrReconcilerMode;
  fetchImpl?: typeof fetch;
}): Promise<{
  captured: number;
  state: BuildPrDeliveryStateV1;
  action: BuildPrDeliveryAction | null;
  actuated: boolean;
}> {
  const repository = `${input.owner}/${input.repo}`;
  const initial = createBuildPrDeliveryState({
    repository,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
  });
  const capture = await captureBuildPrOntoCapsule({
    db: input.db,
    featureBuildId: input.featureBuildId,
    repository,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
  });
  if (capture.captured === 0) {
    return {
      captured: 0,
      state: { ...initial, lastError: "recovery-state-missing" },
      action: null,
      actuated: false,
    };
  }
  if (input.eligible === false) {
    const stopped: BuildPrDeliveryStateV1 = {
      ...initial,
      status: "escalated",
      escalationKey: `build-pr-delivery:${input.prNumber}:local-evidence-not-cleared`,
      lastError: "local-evidence-not-cleared",
    };
    await persistBuildPrDeliveryStateForBuild({
      db: input.db,
      featureBuildId: input.featureBuildId,
      delivery: stopped,
    });
    return { captured: capture.captured, state: stopped, action: null, actuated: false };
  }

  const observation = await observeGithubPullRequest({
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    token: input.token,
    fetchImpl: input.fetchImpl,
  });
  const outcome = await executeBuildPrDeliveryAction({
    state: initial,
    observation,
    readiness: projectGithubPrReadiness(observation),
    mode: input.mode ?? resolveBuildPrReconcilerMode(),
    token: input.token,
    owner: input.owner,
    repo: input.repo,
    fetchImpl: input.fetchImpl,
  });
  await persistBuildPrDeliveryStateForBuild({
    db: input.db,
    featureBuildId: input.featureBuildId,
    delivery: outcome.state,
  });
  return { captured: capture.captured, ...outcome };
}
