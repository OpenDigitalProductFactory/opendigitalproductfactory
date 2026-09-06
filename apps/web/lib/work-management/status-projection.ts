import {
  WORK_CASE_STATES,
  type WorkCaseA2aStatus,
  type WorkCaseBlockingActorKind,
  type WorkCaseProjectionConfidence,
  type WorkCaseSourceRef,
  type WorkCaseSourceRefKind,
  type WorkCaseState,
  type WorkCaseStateProjection,
} from "./case-types";
import type { WorkUnit } from "./work-unit";

export { WORK_CASE_STATES };
export type { WorkCaseState, WorkCaseStateProjection };

export interface WorkCaseStatusProjectionInput {
  workItem?: {
    itemId: string;
    status: string;
  } | null;
  capsule?: {
    capsuleId: string;
    status: string;
  } | null;
  decision?: {
    decisionId: string;
    status?: string | null;
    phase?: string | null;
    outcome?: string | null;
    humanOutcome?: string | null;
  } | null;
  runtimeVerification?: {
    verificationId: string;
    status: string;
  } | null;
  coworkerEngagement?: {
    engagementId: string;
    status: string;
  } | null;
  source?: {
    sourceType: string;
    sourceId: string;
    status?: string | null;
  } | null;
}

const TERMINAL_STATES = new Set<WorkCaseState>([
  "resolved",
  "closed",
  "cancelled",
]);

function a2aStatusForState(state: WorkCaseState): WorkCaseA2aStatus {
  if (state === "intake" || state === "triage") return "submitted";
  if (state === "waiting-on-person" || state === "awaiting-decision") {
    return "input-required";
  }
  if (state === "resolved" || state === "closed") return "completed";
  if (state === "cancelled") return "canceled";
  return "working";
}

function projection(args: {
  state: WorkCaseState;
  reason: string;
  sourceRef: WorkCaseSourceRef;
  confidence?: WorkCaseProjectionConfidence;
  blockingActorKind?: WorkCaseBlockingActorKind;
  a2aStatus?: WorkCaseA2aStatus;
}): WorkCaseStateProjection {
  return {
    state: args.state,
    reason: args.reason,
    sourceRef: args.sourceRef,
    a2aStatus: args.a2aStatus ?? a2aStatusForState(args.state),
    terminal: TERMINAL_STATES.has(args.state),
    confidence: args.confidence ?? "high",
    blockingActorKind: args.blockingActorKind,
  };
}

function ref(kind: WorkCaseSourceRefKind, id: string, status?: string): WorkCaseSourceRef {
  return { kind, id, status };
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function projectDecision(
  decision: NonNullable<WorkCaseStatusProjectionInput["decision"]>,
): WorkCaseStateProjection | null {
  const status = normalized(decision.status ?? decision.phase ?? decision.outcome);
  const humanOutcome = normalized(decision.humanOutcome);
  const pending = ["pending", "pending-human", "awaiting-human", "awaiting-input", "open", "proposed"];
  if (pending.includes(status) && !humanOutcome) {
    return projection({
      state: "awaiting-decision",
      reason: "Decision interaction is waiting for human or policy judgment.",
      sourceRef: ref("decision-interaction", decision.decisionId, decision.status ?? undefined),
      blockingActorKind: "decision",
    });
  }
  return null;
}

function projectRuntimeVerification(
  verification: NonNullable<WorkCaseStatusProjectionInput["runtimeVerification"]>,
): WorkCaseStateProjection | null {
  const status = normalized(verification.status);
  if (["passed", "pass", "success", "succeeded"].includes(status)) {
    return projection({
      state: "resolved",
      reason: "Runtime verification passed.",
      sourceRef: ref("runtime-verification", verification.verificationId, verification.status),
    });
  }
  if (["failed", "fail", "error"].includes(status)) {
    return projection({
      state: "waiting-on-system",
      reason: "Runtime verification failed and needs system remediation.",
      sourceRef: ref("runtime-verification", verification.verificationId, verification.status),
      blockingActorKind: "runtime",
    });
  }
  if (["running", "verifying", "pending"].includes(status)) {
    return projection({
      state: "verifying",
      reason: "Runtime verification is still checking the result.",
      sourceRef: ref("runtime-verification", verification.verificationId, verification.status),
    });
  }
  return null;
}

function projectCapsule(
  capsule: NonNullable<WorkCaseStatusProjectionInput["capsule"]>,
): WorkCaseStateProjection | null {
  const status = normalized(capsule.status);
  if (status === "blocked") {
    return projection({
      state: "waiting-on-system",
      reason: "Work capsule is blocked on a system, provider, or runtime condition.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
      blockingActorKind: "system",
    });
  }
  if (status === "provider-blocked") {
    return projection({
      state: "waiting-on-system",
      reason: "Work capsule is provider-blocked.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
      blockingActorKind: "system",
    });
  }
  if (status === "verifying" || status === "ready-for-review") {
    return projection({
      state: "verifying",
      reason: "Work capsule is in verification or review.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
    });
  }
  if (status === "complete" || status === "ready-for-promotion") {
    return projection({
      state: "resolved",
      reason: "Work capsule reached a completed execution state.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
    });
  }
  if (status === "archived") {
    return projection({
      state: "closed",
      reason: "Work capsule is archived.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
    });
  }
  if (status === "abandoned") {
    return projection({
      state: "cancelled",
      reason: "Work capsule was abandoned.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
    });
  }
  if (status === "working") {
    return projection({
      state: "active",
      reason: "Work capsule is actively executing.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
    });
  }
  if (status === "ready" || status === "draft") {
    return projection({
      state: "triage",
      reason: "Work capsule is prepared but not yet actively executing.",
      sourceRef: ref("work-capsule", capsule.capsuleId, capsule.status),
      confidence: "medium",
    });
  }
  return null;
}

function projectWorkItem(
  workItem: NonNullable<WorkCaseStatusProjectionInput["workItem"]>,
): WorkCaseStateProjection | null {
  const status = normalized(workItem.status);
  if (status === "queued") {
    return projection({
      state: "intake",
      reason: "Work item is queued for intake.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
    });
  }
  if (status === "assigned" || status === "claimed") {
    return projection({
      state: "triage",
      reason: "Work item has an owner and is ready to be scoped.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
    });
  }
  if (status === "in-progress") {
    return projection({
      state: "active",
      reason: "Work item is in progress.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
    });
  }
  if (status === "awaiting-input") {
    return projection({
      state: "waiting-on-person",
      reason: "Work item is waiting on human input.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
      blockingActorKind: "person",
    });
  }
  if (status === "awaiting-approval") {
    return projection({
      state: "awaiting-decision",
      reason: "Work item is waiting on approval.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
      blockingActorKind: "decision",
    });
  }
  if (status === "completed") {
    return projection({
      state: "resolved",
      reason: "Work item completed.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
    });
  }
  if (status === "cancelled") {
    return projection({
      state: "cancelled",
      reason: "Work item was cancelled.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
    });
  }
  if (status === "failed" || status === "escalated") {
    return projection({
      state: "waiting-on-system",
      reason: "Work item failed or escalated and needs intervention.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
      blockingActorKind: "system",
    });
  }
  if (status === "deferred") {
    return projection({
      state: "waiting-on-person",
      reason: "Work item is deferred until a human or scheduling decision resumes it.",
      sourceRef: ref("work-item", workItem.itemId, workItem.status),
      blockingActorKind: "person",
    });
  }
  return null;
}

function projectTaskRun(taskRun: { taskRunId: string; status: string }): WorkCaseStateProjection {
  const status = normalized(taskRun.status);
  const sourceRef = ref("task-run", taskRun.taskRunId, taskRun.status);
  if (status === "input-required" || status === "auth-required") {
    return projection({
      state: "waiting-on-person",
      reason: status === "auth-required"
        ? "Task run is waiting for human authorization."
        : "Task run is waiting for human input.",
      sourceRef,
      blockingActorKind: "person",
      a2aStatus: status,
    });
  }
  if (status === "completed") {
    return projection({ state: "resolved", reason: "Task run completed.", sourceRef });
  }
  if (status === "canceled" || status === "rejected" || status === "archived") {
    return projection({ state: "cancelled", reason: "Task run stopped.", sourceRef });
  }
  if (status === "failed") {
    return projection({
      state: "waiting-on-system",
      reason: "Task run failed and needs remediation.",
      sourceRef,
      blockingActorKind: "system",
      a2aStatus: "failed",
    });
  }
  return projection({
    state: status === "submitted" ? "intake" : "active",
    reason: status === "submitted" ? "Task run is submitted." : "Task run is executing.",
    sourceRef,
  });
}

function projectCoworkerEngagement(
  engagement: NonNullable<WorkCaseStatusProjectionInput["coworkerEngagement"]>,
): WorkCaseStateProjection | null {
  const status = normalized(engagement.status);
  const sourceRef = ref("coworker-engagement", engagement.engagementId, engagement.status);
  if (status === "needs-approval") {
    return projection({
      state: "awaiting-decision",
      reason: "Coworker engagement is waiting for approval before work can continue.",
      sourceRef,
      blockingActorKind: "decision",
      a2aStatus: "input-required",
    });
  }
  if (status === "requested") {
    return projection({
      state: "intake",
      reason: "Coworker engagement has been requested.",
      sourceRef,
    });
  }
  if (status === "accepted") {
    return projection({
      state: "triage",
      reason: "Coworker engagement has been accepted and is ready to start.",
      sourceRef,
    });
  }
  if (status === "in-progress") {
    return projection({
      state: "active",
      reason: "Coworker engagement is in progress.",
      sourceRef,
    });
  }
  if (status === "completed") {
    return projection({
      state: "resolved",
      reason: "Coworker engagement completed.",
      sourceRef,
    });
  }
  if (status === "rejected") {
    return projection({
      state: "cancelled",
      reason: "Coworker engagement was rejected.",
      sourceRef,
      a2aStatus: "rejected",
    });
  }
  if (status === "cancelled" || status === "canceled") {
    return projection({
      state: "cancelled",
      reason: "Coworker engagement was cancelled.",
      sourceRef,
    });
  }
  return null;
}

/** Single projection entry point for every registered durable work carrier. */
export function projectWorkUnitState(workUnit: WorkUnit): WorkCaseStateProjection {
  const { carrier, carrierId } = workUnit.identity;
  const status = workUnit.currentState.status;
  if (carrier === "work-capsule") {
    return projectWorkCaseState({ capsule: { capsuleId: carrierId, status } });
  }
  if (carrier === "work-item") {
    return projectWorkCaseState({ workItem: { itemId: carrierId, status } });
  }
  if (carrier === "coworker-engagement") {
    return projectWorkCaseState({ coworkerEngagement: { engagementId: carrierId, status } });
  }
  return projectTaskRun({ taskRunId: carrierId, status });
}

export function projectWorkCaseState(
  input: WorkCaseStatusProjectionInput,
): WorkCaseStateProjection {
  if (input.decision) {
    const decisionProjection = projectDecision(input.decision);
    if (decisionProjection) return decisionProjection;
  }
  if (input.runtimeVerification) {
    const verificationProjection = projectRuntimeVerification(input.runtimeVerification);
    if (verificationProjection) return verificationProjection;
  }
  if (input.capsule) {
    const capsuleProjection = projectCapsule(input.capsule);
    if (capsuleProjection) return capsuleProjection;
  }
  if (input.workItem) {
    const workItemProjection = projectWorkItem(input.workItem);
    if (workItemProjection) return workItemProjection;
  }
  if (input.coworkerEngagement) {
    const engagementProjection = projectCoworkerEngagement(input.coworkerEngagement);
    if (engagementProjection) return engagementProjection;
  }
  if (input.source) {
    return projection({
      state: "intake",
      reason: "Source record is known but no work substrate state has been loaded yet.",
      sourceRef: {
        kind: "source",
        id: input.source.sourceId,
        sourceType: input.source.sourceType,
        status: input.source.status ?? undefined,
      },
      confidence: "low",
    });
  }
  return projection({
    state: "intake",
    reason: "No source state is available yet.",
    sourceRef: ref("source", "unknown"),
    confidence: "low",
  });
}
