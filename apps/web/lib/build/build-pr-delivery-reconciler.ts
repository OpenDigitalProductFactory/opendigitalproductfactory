import {
  enablePullRequestAutoMerge,
  observeGithubPullRequest,
  projectGithubPrReadiness,
  rerunFailedWorkflowJobs,
  updatePullRequestBranch,
  type GithubPrObservation,
  type GithubPrReadiness,
} from "@/lib/build/github-pr-readiness";
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
import {
  decidePrFollowThrough,
  type PrFollowThroughDecision,
  type PrRepairAuthority,
  type PrRepairPacket,
} from "./pr-follow-through";
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

export type DispatchPrRepair = (packet: PrRepairPacket) => Promise<"dispatched" | "unavailable">;

/**
 * Apply the CI follow-through decision's own effects (BI-88341B5D §3.4–3.5):
 * the single infrastructure re-run and the repair dispatch. Anything that could
 * not be carried out is downgraded honestly — a re-run that did not happen is
 * not counted, and a repair nobody was dispatched for spends no budget and is
 * staged for a person instead.
 */
async function applyFollowThroughEffects(input: {
  decision: PrFollowThroughDecision;
  prior: BuildPrDeliveryStateV1["followThrough"];
  mayActuate: boolean;
  owner: string;
  repo: string;
  token: string;
  fetchImpl?: typeof fetch;
  dispatchRepair?: DispatchPrRepair;
}): Promise<{ decision: PrFollowThroughDecision; actuated: boolean; note: string | null }> {
  const { decision } = input;
  if (decision.kind === "rerun-infrastructure") {
    if (!input.mayActuate) {
      return {
        decision: { kind: "hold", headSha: decision.headSha, followThrough: { ...input.prior, failing: decision.followThrough.failing } },
        actuated: false,
        note: "withheld:rerun-infrastructure",
      };
    }
    for (const workflowRunId of decision.workflowRunIds) {
      const result = await rerunFailedWorkflowJobs({
        owner: input.owner,
        repo: input.repo,
        workflowRunId,
        token: input.token,
        fetchImpl: input.fetchImpl,
      });
      if (result === "not-rerunnable") {
        return {
          decision: {
            kind: "attention",
            target: "platform-operator",
            reason: "infrastructure-not-rerunnable",
            headSha: decision.headSha,
            followThrough: {
              ...decision.followThrough,
              hold: "awaiting-person",
              judgedHeadSha: decision.headSha,
              attentionKey: `follow-through:infrastructure-not-rerunnable:${decision.headSha}`,
            },
          },
          actuated: false,
          note: null,
        };
      }
    }
    return { decision, actuated: true, note: null };
  }
  if (decision.kind === "repair" && decision.mode === "dispatch") {
    const dispatched = input.mayActuate && input.dispatchRepair
      ? await input.dispatchRepair(decision.packet)
      : "unavailable";
    if (dispatched === "dispatched") return { decision, actuated: true, note: null };
    return {
      decision: {
        ...decision,
        mode: "propose",
        packet: { ...decision.packet, attempt: (input.prior.attempts.attempts["post-push-ci-failure"] ?? 0) + 1 },
        followThrough: {
          ...decision.followThrough,
          hold: "awaiting-person",
          attempts: input.prior.attempts,
          attentionKey: `follow-through:repair-propose:${decision.headSha}`,
        },
      },
      actuated: false,
      note: input.mayActuate ? "repair-worker-unavailable" : "withheld:repair-dispatch",
    };
  }
  return { decision, actuated: false, note: null };
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
  /**
   * False when the room's own boundary withholds GitHub actuation (a quiet room
   * or an advise-only boundary). The record and attention still happen.
   */
  actuationAllowed?: boolean;
  /** What the room may do about a red check (§3.5). Defaults to staging it for a person. */
  repairAuthority?: PrRepairAuthority;
  /** The governed repair dispatcher. Absent means no repair worker is wired, so the packet is staged. */
  dispatchRepair?: DispatchPrRepair;
}): Promise<{
  state: BuildPrDeliveryStateV1;
  action: BuildPrDeliveryAction;
  actuated: boolean;
  followThrough: PrFollowThroughDecision;
}> {
  const action = decideBuildPrDeliveryAction({ state: input.state, readiness: input.readiness });
  const now = (input.now ?? new Date()).toISOString();
  const mayActuate = input.mode === "enforce" && input.actuationAllowed !== false;
  const effects = await applyFollowThroughEffects({
    decision: decidePrFollowThrough({
      followThrough: input.state.followThrough,
      readiness: input.readiness,
      checks: input.observation.checks,
      authority: input.repairAuthority ?? "propose",
    }),
    prior: input.state.followThrough,
    mayActuate,
    owner: input.owner,
    repo: input.repo,
    token: input.token,
    fetchImpl: input.fetchImpl,
    dispatchRepair: input.dispatchRepair,
  });
  const followThrough = effects.decision;
  let next: BuildPrDeliveryStateV1 = {
    ...input.state,
    reconciliationAttempts: input.state.reconciliationAttempts + 1,
    lastObservedHeadSha: input.readiness.headSha,
    lastReadiness: input.readiness.kind,
    lastObservedAt: now,
    lastError: effects.note,
    followThrough: followThrough.followThrough,
  };
  const done = (state: BuildPrDeliveryStateV1, actuated: boolean) => ({
    state,
    action,
    actuated: actuated || effects.actuated,
    followThrough,
  });

  if (action.kind === "wait") {
    next = { ...next, status: action.status };
    return done(next, false);
  }
  if (action.kind === "escalate") {
    next = {
      ...next,
      status: action.status,
      escalationKey: next.escalationKey ?? `build-pr-delivery:${input.state.prNumber}:${action.reason}`,
      lastError: action.reason,
    };
    return done(next, false);
  }
  if (!mayActuate) {
    next = {
      ...next,
      status: "checking",
      lastError: input.mode === "shadow"
        ? `shadow-proposed:${action.kind}`
        : input.mode === "enforce"
          ? `withheld:${action.kind}`
          : "reconciler-disabled",
    };
    return done(next, false);
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
    return done(next, result === "accepted");
  }

  if (input.observation.headSha !== action.headSha) {
    return done({ ...next, status: "checking", lastError: "head-changed-before-queue" }, false);
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
  return done(next, true);
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
