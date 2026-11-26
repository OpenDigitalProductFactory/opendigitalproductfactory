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
  readBuildPrDeliveryState,
  type BuildPrDeliveryStateV1,
  type BuildPrDeliveryStatus,
  type BuildPrQueueHold,
} from "./build-pr-delivery-state";
import {
  captureBuildPrOntoCapsule,
  persistBuildPrDeliveryStateForBuild,
  type CaptureBuildPrDeps,
} from "./capture-build-pr";
import {
  attentionKeyFor,
  decidePrFollowThrough,
  type PrFollowThroughDecision,
  type PrRepairAuthority,
  type PrRepairDispatchResult,
  type PrRepairPacket,
} from "./pr-follow-through";
import { MAX_UNKNOWN_OBSERVATIONS, consecutiveUnknownObservations, nextUnknownObservation } from "./build-pr-delivery-recheck";
const MAX_STALE_UPDATES = 2;
const QUEUE_HOLD_RECHECK_MS = 5 * 60_000;

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
  /** True when an eligible PR-only custody room has no outstanding owned work and can close as undelivered. */
  prOnlyCustody?: boolean;
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
      return input.prOnlyCustody
        ? {
            kind: "wait",
            status: "closed",
            headSha: readiness.headSha,
            reason: "pull-request-closed-unmerged-closeout",
          }
        : {
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
      if (state.pendingQueueUpdate?.fromHeadSha === readiness.headSha) {
        return { kind: "wait", status: "updating", headSha: readiness.headSha, reason: "awaiting-accepted-branch-update" };
      }
      return state.lastActuatedHeadSha === readiness.headSha
        ? {
            kind: "wait",
            status: "checking",
            headSha: readiness.headSha,
            reason: "queue-confirmation-missing",
          }
        : state.queueIntentHeadSha === readiness.headSha
          ? { kind: "queue", headSha: readiness.headSha }
          : { kind: "wait", status: "checking", headSha: readiness.headSha, reason: "queue-intent-required" };
    case "armed":
      return {
        kind: "wait",
        status: "armed",
        headSha: readiness.headSha,
        reason: "auto-merge-armed-not-enrolled",
      };
    case "queue-hold":
      return {
        kind: "wait",
        status: readiness.event.kind === "removed" ? "removed" : "checking",
        headSha: readiness.headSha,
        reason: readiness.event.reason,
      };
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
      // GitHub has not decided yet (BI-0EDCF2EC): never a stop. Past the
      // budget the room backs off (nextUnknownObservation) and keeps looking.
      return {
        kind: "wait",
        status: "checking",
        headSha: readiness.headSha,
        reason: consecutiveUnknownObservations(state, readiness.headSha) + 1 >= MAX_UNKNOWN_OBSERVATIONS
          ? `observation-deferred:${readiness.reason}`
          : readiness.reason,
      };
  }
}

export type BuildPrReconcilerMode = "off" | "shadow" | "enforce";

export function resolveBuildPrReconcilerMode(value = process.env.DPF_BUILD_PR_DELIVERY_RECONCILER_MODE): BuildPrReconcilerMode {
  const normalized = (value ?? "shadow").trim().toLowerCase();
  return normalized === "shadow" || normalized === "enforce" ? normalized : "off";
}

export type DispatchPrRepair = (packet: PrRepairPacket) => Promise<PrRepairDispatchResult>;

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
    if (dispatched === "repair-identity-unavailable" || dispatched === "repair-identity-refused") {
      return {
        decision: {
          kind: "attention",
          target: "process-overseer",
          reason: dispatched,
          headSha: decision.headSha,
          followThrough: {
            ...decision.followThrough,
            hold: "awaiting-person",
            attempts: input.prior.attempts,
            attentionKey: attentionKeyFor(dispatched, decision.headSha),
          },
        },
        actuated: false,
        note: dispatched,
      };
    }
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

/** Verify the result of our accepted provider update; an author's replacement inherits no intent. */
export function carryQueueIntentAcrossAcceptedUpdate(
  state: BuildPrDeliveryStateV1,
  observation: GithubPrObservation,
): BuildPrDeliveryStateV1 | null {
  const pending = state.pendingQueueUpdate;
  if (!pending || state.queueIntentHeadSha !== pending.fromHeadSha
    || state.lastObservedHeadSha !== pending.fromHeadSha || observation.headSha === pending.fromHeadSha
    || observation.headParentShas?.length !== 2
    || observation.headParentShas[0] !== pending.fromHeadSha
    || observation.headParentShas[1] !== pending.baseSha) return null;
  return {
    ...state, status: "checking", queueIntentHeadSha: observation.headSha,
    pendingQueueUpdate: null, lastObservedHeadSha: observation.headSha,
    lastObservedAt: new Date().toISOString(), lastReadiness: null, lastError: null,
  };
}

/** Only a removal tied to the previous exact head may be ignored after a verified head change. */
export function projectBuildPrDeliveryReadiness(
  state: BuildPrDeliveryStateV1,
  observation: GithubPrObservation,
): GithubPrReadiness {
  const readiness = projectGithubPrReadiness(observation);
  const removal = state.lastQueueRemoval;
  const event = observation.queueEvent;
  const staleArm = state.queueHold?.reason === "armed-for-previous-head" ? state.queueHold : null;
  if (readiness.kind === "armed" && staleArm
    && !(Date.parse(observation.autoMergeEnabledAt ?? "") > Date.parse(staleArm.eventAt))) {
    return { kind: "queue-hold", headSha: observation.headSha, event: {
      kind: "entry-unconfirmed", id: staleArm.eventId, at: staleArm.eventAt,
      reason: staleArm.reason, groupHeadSha: null, failingChecks: [],
    } };
  }
  if (readiness.kind === "armed" && state.status === "armed" && state.lastObservedHeadSha
    && state.lastObservedHeadSha !== observation.headSha
    && !(Date.parse(observation.autoMergeEnabledAt ?? "") > Date.parse(state.lastActuatedAt ?? state.lastObservedAt ?? ""))) {
    return { kind: "queue-hold", headSha: observation.headSha, event: {
      kind: "entry-unconfirmed", id: `armed-for-previous-head:${state.lastObservedHeadSha}`,
      at: observation.autoMergeEnabledAt ?? state.lastActuatedAt ?? state.lastObservedAt ?? "",
      reason: "armed-for-previous-head", groupHeadSha: null, failingChecks: [],
    } };
  }
  if (!observation.autoMergeEnabled && event?.kind === "removed" && removal?.eventId === event.id
    && removal.headSha !== observation.headSha) {
    return projectGithubPrReadiness({ ...observation, queueEvent: null });
  }
  return readiness;
}

/** The worker checks this before refreshing hosted review status or taking any other GitHub action. */
export function holdsPrQueueAttempt(state: BuildPrDeliveryStateV1, readiness: GithubPrReadiness): boolean {
  return observeQueueHold(state, readiness, "") !== null;
}

function observeQueueHold(
  state: BuildPrDeliveryStateV1,
  readiness: GithubPrReadiness,
  now: string,
): BuildPrQueueHold | null {
  const headSha = readiness.headSha;
  if (!headSha || readiness.kind === "armed" || readiness.kind === "queued"
    || readiness.kind === "merged" || readiness.kind === "closed") return null;
  const prior = state.queueHold?.headSha === headSha || state.queueHold?.reason === "disarmed"
    ? state.queueHold ?? null : null;
  if (prior?.reason === "disarmed" && (readiness.kind !== "queue-hold" || readiness.event.kind !== "disarmed")) {
    return { ...prior, headSha };
  }
  if (readiness.kind === "queue-hold") {
    const { event } = readiness;
    const sameEvent = prior?.eventId === event.id ? prior : null;
    const failed = event.kind === "removed" && event.reason === "failed_checks";
    return {
      headSha, eventId: event.id, reason: event.reason, eventAt: event.at,
      groupHeadSha: event.groupHeadSha ?? sameEvent?.groupHeadSha ?? null,
      failingChecks: event.failingChecks.length ? event.failingChecks : sameEvent?.failingChecks ?? [],
      owner: failed ? "hosted-ci-owner" : "workroom-owner",
      nextAction: failed
        ? "Inspect the removed merge group's failed checks. Route any source fix to the PR writer. After recovery, verify and explicitly authorize a current-head queue attempt."
        : "Confirm the current head and queue intent. Keep the prior attempt stopped unless an authorized owner explicitly starts another.",
      routeReportId: sameEvent?.routeReportId ?? null,
    };
  }
  if (prior) return { ...prior, headSha };
  if (state.lastActuatedHeadSha !== headSha
    && !(state.lastObservedHeadSha === headSha && (state.status === "armed" || (state.status === "queued" && state.lastReadiness === "queued" && state.confirmedQueueHeadSha === headSha)))) return null;
  return {
    headSha, eventId: `confirmation-missing:${headSha}`, reason: "queue-confirmation-missing",
    eventAt: state.lastObservedAt ?? now, groupHeadSha: null, failingChecks: [],
    owner: "workroom-owner",
    nextAction: "Verify what happened to the prior queue request. Do not resubmit an unconfirmed request.",
    routeReportId: null,
  };
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
  /** A durable, idempotent handoff. No report id leaves the worker responsible for retrying the route. */
  routeQueueHold?: (hold: BuildPrQueueHold) => Promise<string | null>;
  /** True when an eligible PR-only custody room can close cleanly as undelivered on provider closure. */
  prOnlyCustody?: boolean;
}): Promise<{
  state: BuildPrDeliveryStateV1;
  action: BuildPrDeliveryAction;
  actuated: boolean;
  followThrough: PrFollowThroughDecision;
}> {
  const readiness = input.readiness.kind === "queue-hold" || input.readiness.kind === "armed"
    ? projectBuildPrDeliveryReadiness(input.state, input.observation) : input.readiness;
  const plannedAction = decideBuildPrDeliveryAction({
    state: input.state,
    readiness,
    prOnlyCustody: input.prOnlyCustody,
  });
  const now = (input.now ?? new Date()).toISOString();
  const mayActuate = input.mode === "enforce" && input.actuationAllowed !== false;
  const queueHold = observeQueueHold(input.state, readiness, now);
  if (queueHold) {
    const action = {
      kind: "wait",
      status: (readiness.kind === "queue-hold" ? readiness.event.kind === "removed"
        : input.state.status === "removed") ? "removed" : "checking",
      headSha: queueHold.headSha,
      reason: queueHold.reason,
    } as const;
    if (!queueHold.routeReportId && mayActuate && input.repairAuthority !== "record" && input.routeQueueHold) {
      queueHold.routeReportId = await input.routeQueueHold(queueHold).catch(() => null);
    }
    return {
      action,
      // Routing an issue is not a GitHub queue mutation.
      actuated: false,
      followThrough: { kind: "none", followThrough: input.state.followThrough },
      state: {
        ...input.state,
        queueHold,
        ...(readiness.kind === "queue-hold" && readiness.event.kind === "removed"
          ? { lastQueueRemoval: { eventId: readiness.event.id, headSha: queueHold.headSha } } : {}),
        status: action.status,
        lastObservedAt: now,
        lastObservedHeadSha: queueHold.headSha,
        lastReadiness: readiness.kind,
        lastError: queueHold.reason,
        unknownObservations: 0,
        nextObservationAt: new Date(Date.parse(now) + QUEUE_HOLD_RECHECK_MS).toISOString(),
        reconciliationAttempts: input.state.reconciliationAttempts + 1,
      },
    };
  }
  const action = plannedAction;
  const effects = await applyFollowThroughEffects({
    decision: decidePrFollowThrough({
      followThrough: input.state.followThrough,
      readiness: readiness,
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
  const undecided = readiness.kind === "unknown"
    ? nextUnknownObservation(input.state, readiness.headSha, input.now ?? new Date())
    : { unknownObservations: 0, nextObservationAt: null };
  let next: BuildPrDeliveryStateV1 = {
    ...input.state,
    ...undecided,
    ...(readiness.kind === "queued" ? { confirmedQueueHeadSha: readiness.headSha } : {}),
    ...(input.state.pendingQueueUpdate && readiness.headSha && readiness.headSha !== input.state.pendingQueueUpdate.fromHeadSha
      ? { pendingQueueUpdate: null } : {}),
    ...(input.state.queueHold ? { queueHold: null } : {}),
    reconciliationAttempts: input.state.reconciliationAttempts + 1,
    lastObservedHeadSha: readiness.headSha,
    lastReadiness: readiness.kind,
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
    next = { ...next, status: action.status,
      ...(action.reason === "queue-intent-required" || action.reason === "changes-requested" ? { lastError: action.reason } : {}) };
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
      pendingQueueUpdate: result === "accepted" && input.state.queueIntentHeadSha === action.headSha
        && input.observation.baseSha
        ? { fromHeadSha: action.headSha, baseSha: input.observation.baseSha } : null,
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
    expectedHeadOid: action.headSha,
    token: input.token,
    fetchImpl: input.fetchImpl,
  });
  next = {
    ...next,
    status: "armed",
    queueIntentHeadSha: null,
    lastActuatedHeadSha: action.headSha,
    lastActuatedAt: (input.now ?? new Date()).toISOString(),
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
  /** The commit the PR was published at; binds the room's head to the PR. */
  publishedHeadSha?: string | null;
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
  // BI-085A37EC: a republish onto the same PR keeps that PR's repair budget, or the loop would never end.
  const prior = (await input.db.workroom.findMany({
    where: { featureBuildId: input.featureBuildId },
    select: { id: true, workspaceState: true, updatedAt: true },
  })).map((room) => readBuildPrDeliveryState(room.workspaceState)).find((state) => state?.prNumber === input.prNumber);
  if (prior) {
    initial.followThrough = { ...initial.followThrough, attempts: prior.followThrough.attempts };
    initial.lastQueueRemoval = prior.lastQueueRemoval ?? null;
    if (prior.queueHold?.reason === "disarmed") initial.queueHold = prior.queueHold;
  }
  if (input.eligible === true && input.publishedHeadSha && /^[a-f0-9]{40}$/.test(input.publishedHeadSha)) {
    initial.queueIntentHeadSha = input.publishedHeadSha;
  }
  const capture = await captureBuildPrOntoCapsule({
    db: input.db,
    featureBuildId: input.featureBuildId,
    repository,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    headSha: input.publishedHeadSha,
    initialDelivery: initial,
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
      publishedHeadSha: input.publishedHeadSha,
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
  if (input.publishedHeadSha && observation.headSha !== input.publishedHeadSha) {
    return { captured: capture.captured, state: initial, action: null, actuated: false };
  }
  const outcome = await executeBuildPrDeliveryAction({
    state: initial,
    observation,
    readiness: projectGithubPrReadiness(observation),
    // Only the worker can refresh review evidence and check the live room posture before arming.
    mode: (input.mode ?? resolveBuildPrReconcilerMode()) === "off" ? "off" : "shadow",
    token: input.token,
    owner: input.owner,
    repo: input.repo,
    fetchImpl: input.fetchImpl,
  });
  await persistBuildPrDeliveryStateForBuild({
    db: input.db,
    featureBuildId: input.featureBuildId,
    delivery: outcome.state,
    publishedHeadSha: input.publishedHeadSha,
  });
  return { captured: capture.captured, ...outcome };
}
