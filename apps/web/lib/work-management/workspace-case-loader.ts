import type {
  WorkCaseA2aStatus,
  WorkCaseSourceRef,
  WorkCaseState,
  WorkCaseTimelineEvent,
} from "./case-types";
import {
  buildWorkCaseDetail,
  buildWorkCaseSummary,
  type WorkCaseReadModelEvidenceInput,
} from "./case-read-model";
import {
  buildWorkRoomView,
  type WorkRoomActivityInput,
} from "./room-read-model";
import {
  projectStoredWorkRoomOutcomePackets,
  projectWorkItemCycleCarriers,
  WORK_ROOM_OUTCOME_MESSAGE_TYPE,
} from "./room-cycle-adapter";
import {
  selectCompletedWorkRoomCycles,
  selectCurrentWorkRoomCycle,
} from "./room-cycle";
import type { WorkRoomParticipantView, WorkRoomView } from "./room-types";
import { getWorkCaseSourceEntry } from "./source-registry";
import { fromWorkItemMessage } from "./receipt-envelope";
import {
  authorizeWorkspaceRoomItem,
  readWorkspaceRoomPolicy,
  type WorkspaceRoomPolicyParticipant,
} from "./workspace-room-access";

const CLOSED_WORK_ITEM_STATUSES = ["completed", "cancelled"];

const URGENCY_ORDER: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  priority: 2,
  routine: 3,
};

const URGENCY_LABELS: Record<string, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  priority: "Priority",
  routine: "Routine",
};

const EFFORT_LABELS: Record<string, string> = {
  instant: "Quick",
  short: "Short",
  medium: "Medium",
  long: "Long",
  physical: "Physical",
};

type WorkspaceWorkItemRecord = {
  id: string;
  itemId: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string | null;
  urgency: string;
  effortClass: string;
  status: string;
  assignedToUserId: string | null;
  assignedToAgentId?: string | null;
  assignedThreadId?: string | null;
  dueAt: Date | string | null;
  evidence?: unknown;
  createdAt: Date | string;
  updatedAt?: Date | string;
  completedAt?: Date | string | null;
  childItems?: WorkspaceWorkItemRecord[];
};

type WorkspaceWorkItemMessageRecord = {
  id?: string;
  messageId: string;
  workItemId?: string;
  senderType: string;
  senderUserId?: string | null;
  senderAgentId?: string | null;
  messageType: string;
  body: string;
  structuredPayload?: unknown;
  createdAt: Date | string;
};

export type WorkspaceCasePrismaClient = {
  workItem: {
    findMany(args: unknown): Promise<WorkspaceWorkItemRecord[]>;
    findFirst(args: unknown): Promise<WorkspaceWorkItemRecord | null>;
  };
  workItemMessage: {
    findMany(args: unknown): Promise<WorkspaceWorkItemMessageRecord[]>;
  };
};

export type WorkspaceRoomAuthContext = {
  principalId: string | null;
  sensitivityClearance: readonly string[];
  isSuperuser: boolean;
};

export type WorkspaceRoomParticipantLoader = (input: {
  workItemId: string;
  assignedToUserId: string | null;
  assignedToAgentId: string | null;
  assignedThreadId: string | null;
  title: string;
  status: string;
  now: Date;
  policyParticipants: readonly WorkspaceRoomPolicyParticipant[];
}) => Promise<WorkRoomParticipantView[]>;

export type WorkspaceWorkCaseListItem = {
  caseId: string;
  href: string;
  title: string;
  sourceLabel: string;
  state: WorkCaseState;
  stateReason: string;
  a2aStatus: WorkCaseA2aStatus;
  terminal: boolean;
  nextAction: string;
  urgency?: string;
  urgencyLabel: string;
  effortLabel: string;
  dueAt: string | null;
  assignmentLabel: string;
  attentionRequired: boolean;
  attentionReason: string | null;
  description: string | null;
  sourceRefs: WorkCaseSourceRef[];
};

export type WorkspaceWorkCaseLensView = {
  generatedAt: string;
  stats: {
    total: number;
    needsAttention: number;
    active: number;
    unassigned: number;
    dueSoon: number;
  };
  cases: WorkspaceWorkCaseListItem[];
};

export type WorkspaceWorkCaseDetailView = {
  summary: WorkspaceWorkCaseListItem;
  evidenceTimeline: WorkCaseTimelineEvent[];
  sourceRefs: WorkCaseSourceRef[];
  // BI-B416B12A: the underlying WorkItem id/title, so the detail surface can post
  // a comment (WorkItemMessage.workItemId) with @mention notification.
  workItemId: string;
  workItemTitle: string;
  // Transitional compatibility seam. The loader always returns the room
  // projection; the optional marker lets the existing detail component remain
  // unchanged until BI-32E26F62 replaces its composition on the same route.
  room?: WorkRoomView;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function sourceForItem(item: WorkspaceWorkItemRecord): { sourceType: string; sourceId: string } {
  return {
    sourceType: item.sourceType || "manual-task",
    sourceId: item.sourceId || item.itemId,
  };
}

export function encodeWorkCaseKey(ref: { sourceType: string; sourceId: string }): string {
  return encodeURIComponent(`${ref.sourceType}:${ref.sourceId}`);
}

export function decodeWorkCaseKey(caseKey: string): { sourceType: string; sourceId: string } | null {
  const decoded = decodeURIComponent(caseKey);
  const separator = decoded.indexOf(":");
  if (separator <= 0 || separator === decoded.length - 1) return null;
  return {
    sourceType: decoded.slice(0, separator),
    sourceId: decoded.slice(separator + 1),
  };
}

function dueSoon(dueAt: string | null, now: Date): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return false;
  const horizon = now.getTime() + 48 * 60 * 60 * 1000;
  return due >= now.getTime() && due <= horizon;
}

function toListItem(item: WorkspaceWorkItemRecord, userId: string, now: Date): WorkspaceWorkCaseListItem {
  const source = sourceForItem(item);
  const summary = buildWorkCaseSummary({
    source,
    workItem: {
      itemId: item.itemId,
      title: item.title,
      status: item.status,
      urgency: item.urgency,
      dueAt: item.dueAt,
      assignedToUserId: item.assignedToUserId,
    },
  });
  const dueAt = iso(item.dueAt);
  const urgentAttention = item.urgency === "emergency" || item.urgency === "urgent";
  const attentionRequired = summary.attention.required || urgentAttention || dueSoon(dueAt, now);

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
    urgency: item.urgency,
    urgencyLabel: URGENCY_LABELS[item.urgency] ?? item.urgency,
    effortLabel: EFFORT_LABELS[item.effortClass] ?? item.effortClass,
    dueAt,
    assignmentLabel: item.assignedToUserId === userId
      ? "Assigned to you"
      : item.assignedToUserId
        ? "Assigned"
        : "Unassigned",
    attentionRequired,
    attentionReason: summary.attention.reason ?? (urgentAttention ? `${URGENCY_LABELS[item.urgency] ?? item.urgency} priority.` : null),
    description: item.description,
    sourceRefs: summary.sourceRefs,
  };
}

function sortCases(left: WorkspaceWorkCaseListItem, right: WorkspaceWorkCaseListItem): number {
  if (left.attentionRequired !== right.attentionRequired) {
    return left.attentionRequired ? -1 : 1;
  }
  const urgency = (URGENCY_ORDER[left.urgency ?? "routine"] ?? 99) - (URGENCY_ORDER[right.urgency ?? "routine"] ?? 99);
  if (urgency !== 0) return urgency;
  const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return leftDue - rightDue;
}

export async function loadWorkspaceWorkCaseLens({
  prismaClient,
  userId,
  now = new Date(),
  limit = 100,
}: {
  prismaClient: WorkspaceCasePrismaClient;
  userId: string;
  now?: Date;
  limit?: number;
}): Promise<WorkspaceWorkCaseLensView> {
  const items = await prismaClient.workItem.findMany({
    where: {
      OR: [
        { assignedToUserId: userId },
        { status: "queued", assignedToUserId: null },
      ],
      status: { notIn: CLOSED_WORK_ITEM_STATUSES },
    },
    orderBy: [{ createdAt: "asc" }],
    take: limit,
  });

  const cases = items.map((item) => toListItem(item, userId, now)).sort(sortCases);

  return {
    generatedAt: now.toISOString(),
    stats: {
      total: cases.length,
      needsAttention: cases.filter((item) => item.attentionRequired).length,
      active: cases.filter((item) => item.state === "active" || item.state === "verifying").length,
      unassigned: cases.filter((item) => item.assignmentLabel === "Unassigned").length,
      dueSoon: cases.filter((item) => dueSoon(item.dueAt, now)).length,
    },
    cases,
  };
}

function evidenceSummary(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["summary", "title", "label", "body", "message"]) {
    const maybe = record[key];
    if (typeof maybe === "string" && maybe.trim()) return maybe.trim();
  }
  return null;
}

function evidenceKind(value: unknown): string {
  if (!value || typeof value !== "object") return "evidence";
  const kind = (value as Record<string, unknown>).kind;
  return typeof kind === "string" && kind.trim() ? kind.trim() : "evidence";
}

function evidenceFromWorkItem(item: WorkspaceWorkItemRecord): WorkCaseReadModelEvidenceInput[] {
  const raw = item.evidence;
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.flatMap((value, index) => {
    const summary = evidenceSummary(value);
    if (!summary) return [];
    return [{
      evidenceId: `work-item:${item.itemId}:evidence:${index + 1}`,
      kind: evidenceKind(value),
      summary,
    }];
  });
}

function evidenceFromMessages(messages: WorkspaceWorkItemMessageRecord[]): WorkCaseReadModelEvidenceInput[] {
  return messages.map((message) => ({
    evidenceId: `work-item-message:${message.messageId}`,
    kind: message.messageType,
    summary: message.body,
  }));
}

function roomActivitiesFromMessages(
  item: WorkspaceWorkItemRecord,
  messages: WorkspaceWorkItemMessageRecord[],
): WorkRoomActivityInput[] {
  return messages.map((message) => ({
    sourceEventId: message.messageId,
    // Free text remains a message. Only the canonical structured lifecycle
    // journal can project a cycle boundary event.
    kind: message.messageType === WORK_ROOM_OUTCOME_MESSAGE_TYPE
      ? "cycle-closed"
      : message.messageType === "work-room-cycle-opened"
        ? "cycle-opened"
        : "message",
    occurredAt: message.createdAt,
    actorRef: {
      actorKind:
        message.senderType === "agent"
          ? "agent"
          : message.senderType === "user"
            ? "person"
            : "system",
      actorId:
        message.senderAgentId
        ?? message.senderUserId
        ?? undefined,
    },
    summary: message.body,
    sourceRef: {
      kind: "work-item",
      id: item.itemId,
      status: message.messageType,
    },
  }));
}

function roomReceiptsFromMessages(
  item: WorkspaceWorkItemRecord,
  messages: WorkspaceWorkItemMessageRecord[],
) {
  return messages.flatMap((message) => {
    if (!message.id || !message.structuredPayload) return [];
    if (!["work-room-cycle-opened", WORK_ROOM_OUTCOME_MESSAGE_TYPE].includes(message.messageType)) return [];
    return [fromWorkItemMessage({
      id: message.id,
      messageId: message.messageId,
      workItemId: message.workItemId ?? item.id,
      senderType: message.senderType,
      senderUserId: message.senderUserId,
      senderAgentId: message.senderAgentId,
      messageType: message.messageType,
      body: message.body,
      structuredPayload: message.structuredPayload,
      createdAt: message.createdAt,
    })];
  });
}

export async function loadWorkspaceWorkCaseDetail({
  prismaClient,
  caseKey,
  userId,
  authContext,
  participantLoader,
  now = new Date(),
}: {
  prismaClient: WorkspaceCasePrismaClient;
  caseKey: string;
  userId: string;
  authContext?: WorkspaceRoomAuthContext;
  participantLoader?: WorkspaceRoomParticipantLoader;
  now?: Date;
}): Promise<WorkspaceWorkCaseDetailView | null> {
  const decoded = decodeWorkCaseKey(caseKey);
  if (!decoded) return null;

  const item = await prismaClient.workItem.findFirst({
    where: {
      OR: [
        { sourceType: decoded.sourceType, sourceId: decoded.sourceId },
        { sourceType: decoded.sourceType, itemId: decoded.sourceId },
      ],
    },
    include: { childItems: true },
  });
  if (!item) return null;

  const access = authorizeWorkspaceRoomItem({
    requested: "content",
    item,
    userId,
    authContext,
  });
  if (access.level !== "content" && access.level !== "action") return null;
  const roomPolicy = readWorkspaceRoomPolicy(item.evidence);

  const [messages, participants] = await Promise.all([
    prismaClient.workItemMessage.findMany({
      where: { workItemId: { in: [item.id, ...(item.childItems ?? []).map((child) => child.id)] } },
      orderBy: [{ createdAt: "asc" }],
      take: 20,
    }),
    participantLoader?.({
      workItemId: item.id,
      assignedToUserId: item.assignedToUserId,
      assignedToAgentId: item.assignedToAgentId ?? null,
      assignedThreadId: item.assignedThreadId ?? null,
      title: item.title,
      status: item.status,
      now,
      policyParticipants: roomPolicy.participants ?? [],
    }) ?? Promise.resolve([]),
  ]);
  const source = sourceForItem(item);
  const evidence = [
    ...evidenceFromWorkItem(item),
    ...evidenceFromMessages(messages),
  ];
  const detail = buildWorkCaseDetail({
    source,
    workItem: {
      itemId: item.itemId,
      title: item.title,
      status: item.status,
      urgency: item.urgency,
      dueAt: item.dueAt,
      assignedToUserId: item.assignedToUserId,
    },
    evidence,
  });
  const sourceRefs = detail.summary.sourceRefs;
  const cycleCandidates = projectWorkItemCycleCarriers({
    items: item.childItems ?? [],
    messages,
  });
  const sourceEntry = getWorkCaseSourceEntry(item.sourceType);
  const currentCycle = sourceEntry
    ? selectCurrentWorkRoomCycle(item.sourceType, cycleCandidates)
    : null;
  const completedCycles = sourceEntry
    ? selectCompletedWorkRoomCycles(item.sourceType, cycleCandidates)
    : [];
  const storedPackets = projectStoredWorkRoomOutcomePackets(messages);
  const room = buildWorkRoomView({
    caseKey,
    detail,
    boundary: {
      purpose: item.description,
      outcome: null,
      scopeIncluded: [],
      scopeExcluded: [],
      accountablePrincipalRef: null,
      admittedRoleSummary: [],
      authoritySummary: [],
      sensitivityCeiling: null,
      measures: [],
      timeBoundary: {
        dueAt: iso(item.dueAt),
        reviewAt: null,
        stopConditionSummary: null,
      },
      closureRuleSummary: null,
      sourceRefs,
    },
    activities: roomActivitiesFromMessages(item, messages),
    currentCycle,
    completedCycles,
    outcomePacket: storedPackets[0] ?? null,
    receipts: roomReceiptsFromMessages(item, messages),
    participants,
    context: {
      refs: sourceRefs,
      digest: null,
      sensitivityCeiling: null,
    },
  });

  return {
    summary: toListItem(item, userId, now),
    evidenceTimeline: detail.timeline,
    sourceRefs: detail.summary.sourceRefs,
    workItemId: item.id,
    workItemTitle: item.title,
    room,
  };
}
