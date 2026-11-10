import { encodeWorkCaseKey } from "./case-key";
import {
  buildWorkCaseDetail,
  buildWorkCaseSummary,
  type WorkCaseReadModelEvidenceInput,
} from "./case-read-model";
import { buildWorkroomView } from "./room-read-model";
import type { WorkroomParticipantView } from "./room-types";
import type {
  WorkspaceRoomAuthContext,
  WorkspaceWorkCaseDetailView,
  WorkspaceWorkCaseListItem,
} from "./workspace-case-loader";

export const CLOSED_COWORKER_ENGAGEMENT_STATUSES = ["completed", "cancelled", "rejected"];

const COWORKER_ENGAGEMENT_PRIORITY_URGENCY: Record<string, string> = {
  emergency: "emergency",
  urgent: "urgent",
  high: "priority",
  normal: "routine",
  medium: "routine",
  low: "routine",
};

const COWORKER_ENGAGEMENT_URGENCY_LABELS: Record<string, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  priority: "Priority",
  routine: "Routine",
};

export type WorkspaceCoworkerEngagementRecord = {
  id: string;
  engagementId: string;
  offerId: string;
  serviceId: string;
  providerAgentId: string;
  requestedByUserId: string | null;
  requestedByAgentId: string | null;
  requestedOutcome: string;
  priority: string;
  status: string;
  approvalContext: unknown;
  auditRefs: unknown;
  metadata: unknown;
  workCapsuleId: string | null;
  toolExecutionId: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
  completedAt?: Date | string | null;
  provider?: { displayName: string | null; name: string | null } | null;
  offer?: { offerId: string; name: string } | null;
  service?: { serviceId: string; name: string } | null;
};

export type CoworkerEngagementCasePrismaClient = {
  coworkerEngagement?: {
    findMany(args: unknown): Promise<WorkspaceCoworkerEngagementRecord[]>;
    findFirst(args: unknown): Promise<WorkspaceCoworkerEngagementRecord | null>;
  };
};

function sourceForEngagement(engagement: WorkspaceCoworkerEngagementRecord): {
  sourceType: string;
  sourceId: string;
} {
  return { sourceType: "coworker-engagement", sourceId: engagement.engagementId };
}

function urgencyForEngagement(engagement: WorkspaceCoworkerEngagementRecord): string {
  return COWORKER_ENGAGEMENT_PRIORITY_URGENCY[engagement.priority] ?? "routine";
}

export function toCoworkerEngagementListItem(
  engagement: WorkspaceCoworkerEngagementRecord,
  userId: string,
): WorkspaceWorkCaseListItem {
  const source = sourceForEngagement(engagement);
  const urgency = urgencyForEngagement(engagement);
  const providerName = engagement.provider?.displayName ?? engagement.provider?.name ?? engagement.providerAgentId;
  const summary = buildWorkCaseSummary({
    source: { ...source, status: engagement.status },
    coworkerEngagement: {
      engagementId: engagement.engagementId,
      requestedOutcome: engagement.requestedOutcome,
      status: engagement.status,
      priority: urgency,
      providerDisplayName: providerName,
      workCapsuleId: engagement.workCapsuleId,
    },
  });
  const urgentAttention = urgency === "emergency" || urgency === "urgent";
  const urgencyLabel = COWORKER_ENGAGEMENT_URGENCY_LABELS[urgency] ?? urgency;
  return {
    caseId: summary.caseId,
    href: `/workspace/cases/${encodeWorkCaseKey(source)}`,
    title: summary.title,
    sourceLabel: summary.sourceLabel,
    state: summary.state,
    stateReason: summary.stateReason,
    a2aStatus: summary.a2aStatus,
    terminal: summary.terminal,
    nextAction: summary.nextAction,
    urgency,
    urgencyLabel,
    effortLabel: engagement.service?.name ?? engagement.offer?.name ?? "Coworker service",
    dueAt: null,
    assignmentLabel: engagement.requestedByUserId === userId
      ? "Requested by you"
      : engagement.requestedByAgentId
        ? "Requested by coworker"
        : "Requested",
    attentionRequired: summary.attention.required || urgentAttention,
    attentionReason: summary.attention.reason ?? (urgentAttention ? `${urgencyLabel} priority.` : null),
    description: engagement.offer?.name ?? engagement.service?.name ?? null,
    sourceRefs: summary.sourceRefs,
  };
}

function recordHasContent(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

function evidenceFromCoworkerEngagement(
  engagement: WorkspaceCoworkerEngagementRecord,
): WorkCaseReadModelEvidenceInput[] {
  const evidence: WorkCaseReadModelEvidenceInput[] = [];
  if (recordHasContent(engagement.approvalContext)) {
    evidence.push({
      evidenceId: `coworker-engagement:${engagement.engagementId}:approval-context`,
      kind: "approval-context",
      summary: "Approval context is attached to the coworker engagement.",
    });
  }
  if (recordHasContent(engagement.auditRefs)) {
    evidence.push({
      evidenceId: `coworker-engagement:${engagement.engagementId}:audit-refs`,
      kind: "audit-refs",
      summary: "Audit references are attached to the coworker engagement.",
    });
  }
  if (recordHasContent(engagement.metadata)) {
    evidence.push({
      evidenceId: `coworker-engagement:${engagement.engagementId}:metadata`,
      kind: "metadata",
      summary: "Metadata is attached to the coworker engagement.",
    });
  }
  return evidence;
}

function coworkerParticipant(
  engagement: WorkspaceCoworkerEngagementRecord,
): WorkroomParticipantView {
  const providerName = engagement.provider?.displayName ?? engagement.provider?.name ?? engagement.providerAgentId;
  return {
    principalRef: engagement.providerAgentId,
    displayName: providerName,
    kind: "agent",
    roles: ["contributor"],
    workState: engagement.status === "in-progress" ? "working" : "waiting",
    presence: "unknown",
    currentWorkSummary: engagement.requestedOutcome,
    enteredReason: "Requested through a coworker service engagement.",
    sponsorPrincipalRef: engagement.requestedByUserId ?? engagement.requestedByAgentId ?? null,
    authoritySummary: "Runs under the coworker service offer and engagement approval context.",
    sourceRefs: [{
      kind: "coworker-engagement",
      id: engagement.engagementId,
      status: engagement.status,
    }],
    assignmentSource: "explicit",
    coordinatorSource: "none",
  };
}

export async function loadCoworkerEngagementDetail({
  prismaClient,
  sourceId,
  userId,
  authContext,
  caseKey,
  now,
}: {
  prismaClient: CoworkerEngagementCasePrismaClient;
  sourceId: string;
  userId: string;
  authContext?: WorkspaceRoomAuthContext;
  caseKey: string;
  now: Date;
}): Promise<WorkspaceWorkCaseDetailView | null> {
  if (!prismaClient.coworkerEngagement) return null;
  const engagement = await prismaClient.coworkerEngagement.findFirst({
    where: authContext?.isSuperuser
      ? { engagementId: sourceId }
      : { engagementId: sourceId, requestedByUserId: userId },
    include: {
      provider: { select: { displayName: true, name: true } },
      offer: { select: { offerId: true, name: true } },
      service: { select: { serviceId: true, name: true } },
    },
  });
  if (!engagement) return null;
  if (!authContext?.isSuperuser && engagement.requestedByUserId !== userId) return null;

  const source = sourceForEngagement(engagement);
  const providerName = engagement.provider?.displayName ?? engagement.provider?.name ?? engagement.providerAgentId;
  const detail = buildWorkCaseDetail({
    source: { ...source, status: engagement.status },
    coworkerEngagement: {
      engagementId: engagement.engagementId,
      requestedOutcome: engagement.requestedOutcome,
      status: engagement.status,
      priority: urgencyForEngagement(engagement),
      providerDisplayName: providerName,
      workCapsuleId: engagement.workCapsuleId,
    },
    evidence: evidenceFromCoworkerEngagement(engagement),
  });
  const sourceRefs = detail.summary.sourceRefs;
  const room = buildWorkroomView({
    caseKey,
    detail,
    boundary: {
      purpose: engagement.requestedOutcome,
      outcome: engagement.requestedOutcome,
      scopeIncluded: [
        engagement.offer?.name ?? engagement.service?.name ?? "Coworker service engagement",
      ],
      sourceRefs,
    },
    participants: [coworkerParticipant(engagement)],
    activities: [{
      sourceEventId: engagement.engagementId,
      kind: engagement.status === "needs-approval" ? "ask" : "external-event",
      occurredAt: engagement.createdAt,
      actorRef: { actorKind: "agent", actorId: engagement.providerAgentId, displayName: providerName },
      summary: engagement.status === "needs-approval"
        ? "Approval is required before this coworker engagement can continue."
        : engagement.requestedOutcome,
      sourceRef: { kind: "coworker-engagement", id: engagement.engagementId, status: engagement.status },
    }],
    context: {
      refs: sourceRefs,
      digest: engagement.service?.name ?? engagement.offer?.name ?? null,
      sensitivityCeiling: null,
    },
    now,
  });

  return {
    summary: toCoworkerEngagementListItem(engagement, userId),
    evidenceTimeline: detail.timeline,
    sourceRefs,
    workItemId: null,
    workItemTitle: null,
    room,
  };
}
