import type {
  WorkCaseDetail,
  WorkCaseSourceRef,
  WorkCaseSummary,
  WorkCaseTimelineEvent,
} from "./case-types";
import { getWorkCaseSourceEntry } from "./source-registry";
import {
  projectWorkCaseState,
  type WorkCaseStatusProjectionInput,
} from "./status-projection";

export interface WorkCaseReadModelSourceInput {
  sourceType: string;
  sourceId: string;
  status?: string | null;
}

export interface WorkCaseReadModelWorkItemInput {
  itemId: string;
  title: string;
  status: string;
  urgency?: string;
  dueAt?: Date | string | null;
  assignedToUserId?: string | null;
}

export interface WorkCaseReadModelCapsuleInput {
  capsuleId: string;
  status: string;
  title?: string;
}

export interface WorkCaseReadModelDecisionInput {
  decisionId: string;
  status?: string | null;
  phase?: string | null;
  outcome?: string | null;
  humanOutcome?: string | null;
  question?: string;
}

export interface WorkCaseReadModelVerificationInput {
  verificationId: string;
  status: string;
}

export interface WorkCaseReadModelEvidenceInput {
  evidenceId: string;
  kind: string;
  summary: string;
}

export interface WorkCaseReadModelCoworkerEngagementInput {
  engagementId: string;
  requestedOutcome: string;
  status: string;
  priority?: string | null;
  providerDisplayName?: string | null;
  workCapsuleId?: string | null;
}

export interface BuildWorkCaseReadModelInput {
  source: WorkCaseReadModelSourceInput;
  workItem?: WorkCaseReadModelWorkItemInput | null;
  coworkerEngagement?: WorkCaseReadModelCoworkerEngagementInput | null;
  capsule?: WorkCaseReadModelCapsuleInput | null;
  runtimeVerification?: WorkCaseReadModelVerificationInput | null;
  capsules?: readonly WorkCaseReadModelCapsuleInput[];
  decisions?: readonly WorkCaseReadModelDecisionInput[];
  evidence?: readonly WorkCaseReadModelEvidenceInput[];
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function buildCaseId(input: BuildWorkCaseReadModelInput): string {
  return `${input.source.sourceType}:${input.source.sourceId}`;
}

function nextActionForState(state: WorkCaseSummary["state"]): string {
  switch (state) {
    case "intake":
      return "Triage case";
    case "triage":
      return "Assign owner";
    case "active":
      return "Continue work";
    case "waiting-on-person":
      return "Collect required input";
    case "waiting-on-system":
      return "Wait for system recovery";
    case "awaiting-decision":
      return "Resolve pending decision";
    case "verifying":
      return "Verify result";
    case "resolved":
      return "Review and close";
    case "closed":
    case "cancelled":
      return "No action";
  }
}

function attentionForProjection(projection: ReturnType<typeof projectWorkCaseState>): {
  required: boolean;
  reason: string | null;
} {
  const required =
    projection.state === "waiting-on-person" ||
    projection.state === "awaiting-decision" ||
    projection.state === "waiting-on-system";
  return {
    required,
    reason: required ? projection.reason : null,
  };
}

function sourceRefsForInput(input: BuildWorkCaseReadModelInput): WorkCaseSourceRef[] {
  const refs: WorkCaseSourceRef[] = [
    {
      kind: "source",
      id: input.source.sourceId,
      sourceType: input.source.sourceType,
      status: input.source.status ?? undefined,
    },
  ];
  if (input.workItem) {
    refs.push({
      kind: "work-item",
      id: input.workItem.itemId,
      status: input.workItem.status,
    });
  }
  if (input.coworkerEngagement) {
    refs.push({
      kind: "coworker-engagement",
      id: input.coworkerEngagement.engagementId,
      status: input.coworkerEngagement.status,
    });
    if (input.coworkerEngagement.workCapsuleId) {
      refs.push({
        kind: "work-capsule",
        id: input.coworkerEngagement.workCapsuleId,
      });
    }
  }
  if (input.capsule) {
    refs.push({
      kind: "work-capsule",
      id: input.capsule.capsuleId,
      status: input.capsule.status,
    });
  }
  if (input.runtimeVerification) {
    refs.push({
      kind: "runtime-verification",
      id: input.runtimeVerification.verificationId,
      status: input.runtimeVerification.status,
    });
  }
  return refs;
}

export function buildWorkCaseSummary(
  input: BuildWorkCaseReadModelInput,
): WorkCaseSummary {
  const sourceEntry = getWorkCaseSourceEntry(input.source.sourceType);
  const primaryDecision = input.decisions?.find((decision) => {
    const status = decision.status ?? decision.phase ?? decision.outcome ?? "";
    return ["pending", "pending-human", "awaiting-human", "open", "proposed"].includes(
      status.trim().toLowerCase(),
    );
  });
  const projectionInput: WorkCaseStatusProjectionInput = {
    source: input.source,
    workItem: input.workItem
      ? { itemId: input.workItem.itemId, status: input.workItem.status }
      : null,
    coworkerEngagement: input.coworkerEngagement
      ? {
          engagementId: input.coworkerEngagement.engagementId,
          status: input.coworkerEngagement.status,
        }
      : null,
    capsule: input.capsule ?? input.capsules?.[0] ?? null,
    decision: primaryDecision ?? null,
    runtimeVerification: input.runtimeVerification ?? null,
  };
  const projection = projectWorkCaseState(projectionInput);

  return {
    caseId: buildCaseId(input),
    title: input.workItem?.title
      ?? input.coworkerEngagement?.requestedOutcome
      ?? `${sourceEntry?.displayLabel ?? input.source.sourceType} ${input.source.sourceId}`,
    sourceLabel: sourceEntry?.displayLabel ?? input.source.sourceType,
    state: projection.state,
    stateReason: projection.reason,
    a2aStatus: projection.a2aStatus,
    terminal: projection.terminal,
    nextAction: nextActionForState(projection.state),
    urgency: input.workItem?.urgency ?? input.coworkerEngagement?.priority ?? undefined,
    dueAt: iso(input.workItem?.dueAt),
    assignedToUserId: input.workItem?.assignedToUserId ?? null,
    attention: attentionForProjection(projection),
    sourceRefs: sourceRefsForInput(input),
  };
}

function coworkerEngagementTimelineEvent(
  engagement: WorkCaseReadModelCoworkerEngagementInput,
): WorkCaseTimelineEvent {
  return {
    eventId: `coworker-engagement:${engagement.engagementId}`,
    label: engagement.providerDisplayName
      ? `${engagement.providerDisplayName}: ${engagement.requestedOutcome}`
      : engagement.requestedOutcome,
    sourceRef: {
      kind: "coworker-engagement",
      id: engagement.engagementId,
      status: engagement.status,
    },
  };
}

function capsuleTimelineEvent(
  capsule: WorkCaseReadModelCapsuleInput,
): WorkCaseTimelineEvent {
  return {
    eventId: `capsule:${capsule.capsuleId}`,
    label: capsule.title ?? "Work capsule",
    sourceRef: {
      kind: "work-capsule",
      id: capsule.capsuleId,
      status: capsule.status,
    },
  };
}

function decisionTimelineEvent(
  decision: WorkCaseReadModelDecisionInput,
): WorkCaseTimelineEvent {
  return {
    eventId: `decision:${decision.decisionId}`,
    label: decision.question ?? "Decision interaction",
    sourceRef: {
      kind: "decision-interaction",
      id: decision.decisionId,
      status: decision.status ?? decision.phase ?? decision.outcome ?? undefined,
    },
  };
}

function evidenceTimelineEvent(
  evidence: WorkCaseReadModelEvidenceInput,
): WorkCaseTimelineEvent {
  return {
    eventId: `evidence:${evidence.evidenceId}`,
    label: evidence.summary,
    sourceRef: {
      kind: "evidence",
      id: evidence.evidenceId,
      status: evidence.kind,
    },
  };
}

export function buildWorkCaseDetail(
  input: BuildWorkCaseReadModelInput,
): WorkCaseDetail {
  const capsules = input.capsules ?? (input.capsule ? [input.capsule] : []);
  const decisions = input.decisions ?? [];
  const evidence = input.evidence ?? [];
  return {
    summary: buildWorkCaseSummary(input),
    capsules,
    decisions,
    evidence,
    timeline: [
      ...(input.coworkerEngagement ? [coworkerEngagementTimelineEvent(input.coworkerEngagement)] : []),
      ...capsules.map(capsuleTimelineEvent),
      ...decisions.map(decisionTimelineEvent),
      ...evidence.map(evidenceTimelineEvent),
    ],
  };
}
