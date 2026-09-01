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
  buildWorkroomView,
  type WorkroomActivityInput,
} from "./room-read-model";
import {
  projectStoredWorkroomOutcomePackets,
  projectWorkItemCycleCarriers,
  WORKROOM_OUTCOME_MESSAGE_TYPE,
} from "./room-cycle-adapter";
import {
  selectCompletedWorkroomCycles,
  selectCurrentWorkroomCycle,
} from "./room-cycle";
import type { WorkroomStructure } from "./room-structure";
import type { WorkroomPostureContext } from "./room-posture";
import { readWorkroomShapeClaim } from "./workroom-shape-claim";
import { readWorkroomPostureClaim } from "./workroom-posture-claim";
import { deriveWorkroomShape } from "./derive-workroom-shape";
import type { WorkroomActivityKind, WorkroomParticipantView, WorkroomView } from "./room-types";
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

export type WorkspaceWorkCapsuleRecord = {
  /** The row the operator posture control writes back to. */
  id?: string;
  /** The WorkItem row this capsule is anchored to — lets the list loader group a
   *  batched capsule fetch by item so the list projects the SAME state the detail
   *  does (BI-2310EEE1). Optional so existing fakes/selects keep compiling. */
  workItemId?: string | null;
  capsuleId: string;
  status: string;
  title: string;
  // EP-WORK-POSTURE Slice D (BI-4F468192). Optional so existing test fakes and
  // callers that select only the original three fields keep compiling; a record
  // without them simply yields no shape and no declared posture.
  scopeClaims?: unknown;
  activityKind?: string | null;
  decisionScope?: string | null;
};

/** A capsule-activity row (WorkroomActivity, physical table WorkCapsuleActivity) —
 *  the coding carrier's own execution journal (BI-1CF7B600). */
export type WorkspaceWorkroomActivityRecord = {
  id: string;
  workCapsuleId: string;
  kind: string;
  summary: string;
  recordedAt: Date | string;
  recordedById?: string | null;
  recordedByAgentId?: string | null;
};

export type WorkspaceCasePrismaClient = {
  workItem: {
    findMany(args: unknown): Promise<WorkspaceWorkItemRecord[]>;
    findFirst(args: unknown): Promise<WorkspaceWorkItemRecord | null>;
  };
  workItemMessage: {
    findMany(args: unknown): Promise<WorkspaceWorkItemMessageRecord[]>;
  };
  workroom: {
    findMany(args: unknown): Promise<WorkspaceWorkCapsuleRecord[]>;
  };
  workroomActivity: {
    findMany(args: unknown): Promise<WorkspaceWorkroomActivityRecord[]>;
  };
};

export type WorkspaceRoomAuthContext = {
  principalId: string | null;
  sensitivityClearance: readonly string[];
  isSuperuser: boolean;
};

/**
 * Resolves the value-stream + lifecycle STRUCTURE of the room's subject. Injected
 * (like `participantLoader`) so this loader keeps its narrow prisma client and stays
 * off the CRM models — the caller wires a full-prisma resolver
 * (`resolveWorkroomStructureForCase`). Returns null for subjects with no binding.
 */
/**
 * EP-WORK-POSTURE Slice D (BI-4F468192). Resolves the parts of the room's
 * posture that need I/O, so `buildWorkroomView` stays pure — the same split
 * `WorkroomStructureLoader` already uses.
 */
export type WorkroomPostureContextLoader = (ref: {
  sourceType: string;
  sourceId: string;
  assignedToAgentId: string | null;
  now: Date;
}) => Promise<WorkroomPostureContext | null>;

export type WorkroomStructureLoader = (ref: {
  sourceType: string;
  sourceId: string;
}) => Promise<WorkroomStructure | null>;

export type WorkspaceRoomParticipantLoader = (input: {
  workItemId: string;
  assignedToUserId: string | null;
  assignedToAgentId: string | null;
  assignedThreadId: string | null;
  title: string;
  status: string;
  now: Date;
  policyParticipants: readonly WorkspaceRoomPolicyParticipant[];
}) => Promise<WorkroomParticipantView[]>;

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
  room?: WorkroomView;
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

function toListItem(
  item: WorkspaceWorkItemRecord,
  userId: string,
  now: Date,
  capsules: readonly WorkspaceWorkCapsuleRecord[] = [],
): WorkspaceWorkCaseListItem {
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
    // Feed the SAME capsule the detail loader projects from (BI-2310EEE1) — most
    // recent first, matching the detail's `updatedAt desc` order — so the list and
    // the room agree on one derived state instead of the list showing the raw
    // WorkItem status while the detail shows the capsule-projected state.
    capsules: capsules.map((capsule) => ({
      capsuleId: capsule.capsuleId,
      status: capsule.status,
      title: capsule.title,
    })),
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

  // BI-2310EEE1: batch-join the capsule(s) anchored to these items in ONE query
  // (not per-item) so the list projects the same capsule-derived state the room
  // detail does. Bounded by the item page above — no unbounded scan.
  const itemRowIds = items.map((item) => item.id).filter((id): id is string => Boolean(id));
  const capsuleRows = itemRowIds.length
    ? await prismaClient.workroom.findMany({
        where: { workItemId: { in: itemRowIds } },
        select: { workItemId: true, capsuleId: true, status: true, title: true },
        orderBy: [{ updatedAt: "desc" }],
      })
    : [];
  const capsulesByItem = new Map<string, WorkspaceWorkCapsuleRecord[]>();
  for (const capsule of capsuleRows) {
    const key = capsule.workItemId;
    if (!key) continue;
    const bucket = capsulesByItem.get(key);
    if (bucket) bucket.push(capsule);
    else capsulesByItem.set(key, [capsule]);
  }

  const cases = items
    .map((item) => toListItem(item, userId, now, item.id ? capsulesByItem.get(item.id) ?? [] : []))
    .sort(sortCases);

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
): WorkroomActivityInput[] {
  return messages.map((message) => ({
    sourceEventId: message.messageId,
    // Free text remains a message. Only the canonical structured lifecycle
    // journal can project a cycle boundary event.
    kind: message.messageType === WORKROOM_OUTCOME_MESSAGE_TYPE
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

// The WorkroomActivityKind values a capsule row's `kind` may already be; anything
// else degrades to a generic "external-event" so the entry still renders.
const KNOWN_ACTIVITY_KINDS = new Set<WorkroomActivityKind>([
  "message", "ask", "coworker-joined", "coworker-left", "coworker-handoff",
  "work-started", "work-paused", "work-completed", "decision-proposed",
  "decision-resolved", "artifact-added", "governed-action", "external-event",
  "verification", "receipt", "cycle-opened", "cycle-closed",
]);

/**
 * BI-1CF7B600: project the capsule's own execution journal (WorkroomActivity rows)
 * into the room activity feed, so a capsule-sourced room no longer reads "No activity
 * yet" while 20+ rows exist. `capsuleIdByRowId` maps the row's workCapsuleId (a Workroom
 * row id) back to the WC-* id for the source reference.
 */
function roomActivitiesFromCapsuleActivity(
  rows: readonly WorkspaceWorkroomActivityRecord[],
  capsuleIdByRowId: ReadonlyMap<string, string>,
): WorkroomActivityInput[] {
  return rows.map((row) => ({
    sourceEventId: row.id,
    kind: KNOWN_ACTIVITY_KINDS.has(row.kind as WorkroomActivityKind)
      ? (row.kind as WorkroomActivityKind)
      : "external-event",
    occurredAt: row.recordedAt,
    actorRef: {
      actorKind: row.recordedByAgentId ? "agent" : row.recordedById ? "person" : "system",
      actorId: row.recordedByAgentId ?? row.recordedById ?? undefined,
    },
    summary: row.summary,
    sourceRef: {
      kind: "work-capsule",
      id: capsuleIdByRowId.get(row.workCapsuleId) ?? row.workCapsuleId,
      status: row.kind,
    },
  }));
}

function roomReceiptsFromMessages(
  item: WorkspaceWorkItemRecord,
  messages: WorkspaceWorkItemMessageRecord[],
) {
  return messages.flatMap((message) => {
    if (!message.id || !message.structuredPayload) return [];
    if (!["work-room-cycle-opened", WORKROOM_OUTCOME_MESSAGE_TYPE].includes(message.messageType)) return [];
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
  structureLoader,
  postureContextLoader,
  now = new Date(),
}: {
  prismaClient: WorkspaceCasePrismaClient;
  caseKey: string;
  userId: string;
  authContext?: WorkspaceRoomAuthContext;
  participantLoader?: WorkspaceRoomParticipantLoader;
  structureLoader?: WorkroomStructureLoader;
  /**
   * EP-WORK-POSTURE Slice D (BI-4F468192). Resolves the asynchronous half of the
   * room's posture (operating clock, archetype value stream, inherited coworker
   * posture). Optional: when absent the room has no posture and every surface
   * behaves exactly as it did before this slice.
   */
  postureContextLoader?: WorkroomPostureContextLoader;
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

  const [messages, participants, capsules] = await Promise.all([
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
    // EP-WORK-CONVERGENCE (BI-650994D7): join the capsule(s) anchored to this WorkItem
    // so a coding carrier surfaces in its case instead of as a disjoint row.
    prismaClient.workroom.findMany({
      where: { workItemId: item.id },
      // EP-WORK-POSTURE Slice D (BI-4F468192): scopeClaims carries the room's
      // declared collaboration shape AND its declared posture; activityKind is
      // one of the four shape axes. Both ride the existing query — no extra
      // round trip for the posture.
      select: {
        // `id` is the row the operator control writes back to. Without it the
        // control would render with nothing to target — the write path would
        // exist and be unusable, which is the failure this whole epic is about.
        id: true,
        capsuleId: true,
        status: true,
        title: true,
        scopeClaims: true,
        activityKind: true,
        decisionScope: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);
  // BI-1CF7B600: the capsule's own execution journal (WorkroomActivity rows) so a
  // capsule-sourced room shows its activity instead of "No activity yet". Keyed on the
  // capsule row ids just fetched — one bounded query, newest first.
  const capsuleRowIds = capsules.map((capsule) => capsule.id).filter((id): id is string => Boolean(id));
  const capsuleActivityRows = capsuleRowIds.length
    ? await prismaClient.workroomActivity.findMany({
        where: { workCapsuleId: { in: capsuleRowIds } },
        orderBy: [{ recordedAt: "desc" }],
        take: 20,
      })
    : [];
  const capsuleIdByRowId = new Map<string, string>();
  for (const capsule of capsules) {
    if (capsule.id) capsuleIdByRowId.set(capsule.id, capsule.capsuleId);
  }
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
    capsules: capsules.map((capsule) => ({
      capsuleId: capsule.capsuleId,
      status: capsule.status,
      title: capsule.title,
    })),
    evidence,
  });
  const sourceRefs = detail.summary.sourceRefs;
  const cycleCandidates = projectWorkItemCycleCarriers({
    items: item.childItems ?? [],
    messages,
    scopeClaims: capsules[0]?.scopeClaims,
    capsuleId: capsules[0]?.capsuleId,
    openedAt: item.createdAt,
  });
  const sourceEntry = getWorkCaseSourceEntry(item.sourceType);
  const currentCycle = sourceEntry
    ? selectCurrentWorkroomCycle(item.sourceType, cycleCandidates)
    : null;
  const completedCycles = sourceEntry
    ? selectCompletedWorkroomCycles(item.sourceType, cycleCandidates)
    : [];
  const storedPackets = projectStoredWorkroomOutcomePackets(messages);
  const structure = structureLoader
    ? await structureLoader({ sourceType: source.sourceType, sourceId: source.sourceId })
    : null;
  const anchoredCapsule = capsules[0] ?? null;
  const postureContext = postureContextLoader
    ? await postureContextLoader({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        assignedToAgentId: item.assignedToAgentId ?? null,
        now,
      })
    : null;
  // The identity the operator control needs to write back. Only present when a
  // capsule actually anchors this case — a case with no room is not editable as
  // a room, and the control is then not rendered at all.
  const editablePosture = anchoredCapsule?.id
    ? {
        roomRowId: anchoredCapsule.id,
        caseKey,
        declaredShape: readWorkroomShapeClaim(anchoredCapsule.scopeClaims),
        hasDeclaration: readWorkroomPostureClaim(anchoredCapsule.scopeClaims) !== null,
      }
    : null;
  const room = buildWorkroomView({
    caseKey,
    detail,
    structure,
    postureContext: postureContext ? { ...postureContext, editable: editablePosture } : null,
    // A DECLARED shape always wins. Most rooms have never declared one
    // (0 of 330 on the reference install), so fall back to deriving from what
    // the room already is — and accept null when it does not say enough,
    // rather than inventing a shape the posture would then act on.
    shapeKey:
      readWorkroomShapeClaim(anchoredCapsule?.scopeClaims)
      ?? deriveWorkroomShape({
        activityKind: anchoredCapsule?.activityKind ?? null,
        decisionScope: anchoredCapsule?.decisionScope ?? null,
        mode: sourceEntry?.roomProjection.mode ?? "finite",
      })?.shape
      ?? null,
    activityKind: anchoredCapsule?.activityKind ?? null,
    scopeClaims: anchoredCapsule?.scopeClaims,
    now,
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
    activities: [
      ...roomActivitiesFromMessages(item, messages),
      ...roomActivitiesFromCapsuleActivity(capsuleActivityRows, capsuleIdByRowId),
    ].sort((a, b) => new Date(b.occurredAt ?? 0).getTime() - new Date(a.occurredAt ?? 0).getTime()),
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
    // Same derivation as the list (BI-2310EEE1) — feed the capsules this loader
    // already fetched so the room's headline state matches the list's instead of
    // falling back to the raw WorkItem status.
    summary: toListItem(item, userId, now, capsules),
    evidenceTimeline: detail.timeline,
    sourceRefs: detail.summary.sourceRefs,
    workItemId: item.id,
    workItemTitle: item.title,
    room,
  };
}
