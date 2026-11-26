import type { GithubPrReadiness, GithubQueueFailure } from "@/lib/build/github-pr-readiness";
import { createPrFollowThrough, readPrFollowThrough, type PrFollowThroughV1 } from "./pr-follow-through";

/**
 * The room's PR delivery record. One shape for every room, whichever client
 * opened the PR (BI-88341B5D §3.2): it lives at `workspaceState.prDelivery`.
 * Rows written before that read from the legacy `buildStudio.delivery` key and
 * move on their next write, so no migration is needed.
 */

export const BUILD_PR_DELIVERY_STATUSES = [
  "created",
  "checking",
  "updating",
  "armed",
  "queued",
  "removed",
  "awaiting-release",
  "deployed",
  "escalated",
  "closed",
] as const;

export type BuildPrDeliveryStatus = (typeof BUILD_PR_DELIVERY_STATUSES)[number];

export type BuildPrQueueHold = {
  headSha: string;
  eventId: string;
  reason: string;
  eventAt: string;
  groupHeadSha: string | null;
  failingChecks: GithubQueueFailure[];
  owner: "hosted-ci-owner" | "workroom-owner";
  nextAction: string;
  routeReportId: string | null;
};

export type BuildPrDeliveryStateV1 = {
  schemaVersion: 1;
  status: BuildPrDeliveryStatus;
  repository: string;
  prNumber: number;
  prUrl: string;
  lastObservedHeadSha: string | null;
  lastActuatedHeadSha: string | null;
  staleUpdateAttempts: number;
  reconciliationAttempts: number;
  lastReadiness: GithubPrReadiness["kind"] | null;
  lastObservedAt: string | null;
  escalationKey: string | null;
  lastError: string | null;
  /**
   * Undecided merge-state observations of the same head in a row (BI-0EDCF2EC).
   * Any decisive observation or a new head resets it.
   */
  unknownObservations: number;
  /** Earliest time the room is observed again while backing off; null means the normal cadence. */
  nextObservationAt: string | null;
  /** CI follow-through: classification, holds and the reused recovery budget. */
  followThrough: PrFollowThroughV1;
  queueHold?: BuildPrQueueHold | null;
  /** Only a governed publication may write an intent for the commit it published. */
  queueIntentHeadSha?: string | null;
  pendingQueueUpdate?: { fromHeadSha: string; baseSha: string } | null;
  lastActuatedAt?: string;
  confirmedQueueHeadSha?: string;
  /** Bind the last removal event to the exact room head first observed with it. */
  lastQueueRemoval?: { eventId: string; headSha: string } | null;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

export function createBuildPrDeliveryState(input: {
  repository: string;
  prNumber: number;
  prUrl: string;
}): BuildPrDeliveryStateV1 {
  return {
    schemaVersion: 1,
    status: "created",
    repository: input.repository,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    lastObservedHeadSha: null,
    lastActuatedHeadSha: null,
    staleUpdateAttempts: 0,
    reconciliationAttempts: 0,
    lastReadiness: null,
    lastObservedAt: null,
    escalationKey: null,
    lastError: null,
    unknownObservations: 0,
    nextObservationAt: null,
    followThrough: createPrFollowThrough(),
  };
}

function readQueueHold(input: unknown): BuildPrQueueHold | null {
  const value = asObject(input);
  if (typeof value.headSha !== "string" || typeof value.eventId !== "string"
    || typeof value.reason !== "string" || typeof value.eventAt !== "string" || typeof value.nextAction !== "string"
    || (value.owner !== "hosted-ci-owner" && value.owner !== "workroom-owner")) return null;
  const failingChecks = (Array.isArray(value.failingChecks) ? value.failingChecks : []).slice(0, 12).flatMap((raw) => {
    const c = asObject(raw);
    return typeof c.name === "string" && typeof c.conclusion === "string"
      ? [{ name: c.name, conclusion: c.conclusion, url: typeof c.url === "string" ? c.url : null }] : [];
  });
  return {
    headSha: value.headSha, eventId: value.eventId, reason: value.reason, eventAt: value.eventAt,
    groupHeadSha: typeof value.groupHeadSha === "string" ? value.groupHeadSha : null,
    failingChecks, owner: value.owner, nextAction: value.nextAction,
    routeReportId: typeof value.routeReportId === "string" ? value.routeReportId : null,
  };
}

export function readBuildPrDeliveryState(workspaceState: unknown): BuildPrDeliveryStateV1 | null {
  const root = asObject(workspaceState);
  const value = root.prDelivery !== undefined
    ? asObject(root.prDelivery)
    : asObject(asObject(root.buildStudio).delivery);
  if (value.schemaVersion !== 1) return null;
  if (
    typeof value.status !== "string" ||
    !BUILD_PR_DELIVERY_STATUSES.includes(value.status as BuildPrDeliveryStatus) ||
    typeof value.repository !== "string" ||
    typeof value.prNumber !== "number" ||
    !Number.isInteger(value.prNumber) ||
    value.prNumber <= 0 ||
    typeof value.prUrl !== "string" ||
    !value.repository ||
    !value.prUrl
  ) {
    return null;
  }
  const removal = asObject(value.lastQueueRemoval);
  const pendingUpdate = asObject(value.pendingQueueUpdate);
  const integer = (candidate: unknown) =>
    typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
  return {
    schemaVersion: 1,
    status: value.status as BuildPrDeliveryStatus,
    repository: value.repository,
    prNumber: value.prNumber,
    prUrl: value.prUrl,
    lastObservedHeadSha: typeof value.lastObservedHeadSha === "string" ? value.lastObservedHeadSha : null,
    lastActuatedHeadSha: typeof value.lastActuatedHeadSha === "string" ? value.lastActuatedHeadSha : null,
    staleUpdateAttempts: integer(value.staleUpdateAttempts),
    reconciliationAttempts: integer(value.reconciliationAttempts),
    lastReadiness: typeof value.lastReadiness === "string"
      ? value.lastReadiness as GithubPrReadiness["kind"]
      : null,
    lastObservedAt: typeof value.lastObservedAt === "string" ? value.lastObservedAt : null,
    escalationKey: typeof value.escalationKey === "string" ? value.escalationKey : null,
    lastError: typeof value.lastError === "string" ? value.lastError : null,
    unknownObservations: integer(value.unknownObservations),
    nextObservationAt: typeof value.nextObservationAt === "string" ? value.nextObservationAt : null,
    followThrough: readPrFollowThrough(value.followThrough),
    ...(typeof value.lastActuatedAt === "string" ? { lastActuatedAt: value.lastActuatedAt } : {}),
    ...(typeof pendingUpdate.fromHeadSha === "string" && typeof pendingUpdate.baseSha === "string"
      ? { pendingQueueUpdate: { fromHeadSha: pendingUpdate.fromHeadSha, baseSha: pendingUpdate.baseSha } } : {}),
    ...(typeof value.confirmedQueueHeadSha === "string" ? { confirmedQueueHeadSha: value.confirmedQueueHeadSha } : {}),
    ...(typeof value.queueIntentHeadSha === "string" ? { queueIntentHeadSha: value.queueIntentHeadSha } : {}),
    ...(typeof removal.eventId === "string" && typeof removal.headSha === "string"
      ? { lastQueueRemoval: { eventId: removal.eventId, headSha: removal.headSha } } : {}),
    ...(value.queueHold !== undefined ? { queueHold: readQueueHold(value.queueHold) } : {}),
  };
}

export function writeBuildPrDeliveryState(
  workspaceState: unknown,
  delivery: BuildPrDeliveryStateV1,
): JsonObject {
  const root: JsonObject = { ...asObject(workspaceState), prDelivery: delivery };
  if (root.buildStudio !== undefined) {
    const { delivery: _legacy, ...buildStudio } = asObject(root.buildStudio);
    root.buildStudio = buildStudio;
  }
  return root;
}

/** Carry only the old queue binding across verified rebinding of the same PR. Never carry enqueue authority. */
export function restoreBuildPrQueueHistory(state: BuildPrDeliveryStateV1, workspaceState: unknown): BuildPrDeliveryStateV1 {
  const previous = readBuildPrDeliveryState({ prDelivery: asObject(workspaceState).prDeliveryPriorQueue });
  if (!previous || previous.repository.toLowerCase() !== state.repository.toLowerCase()
    || previous.prNumber !== state.prNumber) return state;
  return {
    ...state,
    ...(previous.status === "armed" && previous.lastObservedHeadSha ? {
      status: "armed", lastObservedHeadSha: previous.lastObservedHeadSha,
      lastObservedAt: previous.lastObservedAt,
      ...(previous.lastActuatedAt ? { lastActuatedAt: previous.lastActuatedAt } : {}),
    } : {}),
    ...(previous.lastQueueRemoval ? { lastQueueRemoval: previous.lastQueueRemoval } : {}),
    ...(previous.queueHold?.reason === "disarmed" ? { queueHold: previous.queueHold } : {}),
  };
}

/** Retire delivery state when a Workroom advances to a different authored head. */
export function clearBuildPrDeliveryState(workspaceState: unknown): JsonObject {
  const prior = readBuildPrDeliveryState(workspaceState);
  const { prDelivery: _current, ...root } = asObject(workspaceState);
  if (prior?.lastQueueRemoval || prior?.queueHold?.reason === "disarmed" || prior?.status === "armed") {
    const { repository, prNumber, prUrl, lastQueueRemoval, queueHold } = prior;
    root.prDeliveryPriorQueue = { schemaVersion: 1, status: prior.status === "armed" ? "armed" : "checking", repository, prNumber, prUrl,
      lastObservedHeadSha: prior.lastObservedHeadSha, lastObservedAt: prior.lastObservedAt,
      lastActuatedAt: prior.lastActuatedAt ?? null,
      lastQueueRemoval: lastQueueRemoval ?? null, queueHold: queueHold?.reason === "disarmed" ? queueHold : null };
  }
  if (root.buildStudio !== undefined) {
    const { delivery: _legacy, ...buildStudio } = asObject(root.buildStudio);
    root.buildStudio = buildStudio;
  }
  return root;
}
