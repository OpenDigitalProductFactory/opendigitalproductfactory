import type { WorkCasePolicyInput } from "./policy-envelope";
import {
  buildWorkRoomCycle,
  evaluateWorkRoomCyclePolicy,
  type WorkRoomCycleCarrierCandidate,
} from "./room-cycle";
import {
  parseStoredWorkRoomCycle,
  parseStoredWorkRoomOutcome,
  WORK_ROOM_CYCLE_EVIDENCE_KIND,
  WORK_ROOM_OUTCOME_MESSAGE_TYPE,
  type WorkRoomCycleWorkItemRecord,
} from "./room-cycle-adapter";
import type { WorkRoomOutcomePacket } from "./room-types";

export interface WorkRoomCycleParentRecord {
  id: string;
  itemId: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string;
  queueId: string;
  teamId: string | null;
  urgency: string;
  effortClass: string;
  workerConstraint: unknown;
  assignedToUserId: string | null;
  assignedToAgentId: string | null;
}

export interface WorkRoomCycleStoreMessage {
  messageId: string;
  messageType: string;
  structuredPayload: unknown;
}

export interface WorkRoomCycleStoreTx {
  getRoom(workItemId: string): Promise<WorkRoomCycleParentRecord | null>;
  listCycles(workItemId: string): Promise<WorkRoomCycleWorkItemRecord[]>;
  listMessages(workItemId: string): Promise<WorkRoomCycleStoreMessage[]>;
  createCycle(data: Record<string, unknown>): Promise<WorkRoomCycleWorkItemRecord>;
  completeCycle(itemId: string, completedAt: Date): Promise<void>;
  appendMessage(data: Record<string, unknown>): Promise<{ messageId: string }>;
}

export interface WorkRoomCycleStoreDb {
  withinRoomLock<T>(workItemId: string, callback: (tx: WorkRoomCycleStoreTx) => Promise<T>): Promise<T>;
}

export interface OpenWorkRoomCycleInput {
  db: WorkRoomCycleStoreDb;
  roomWorkItemId: string;
  cycleKey: string;
  trigger: string;
  objective: string;
  accountablePrincipalRef: string;
  expectedReviewAt: Date | string;
  stopConditions: readonly string[];
  measureSummary: string;
  contextRefs: WorkRoomCycleCarrierCandidate["contextRefs"];
  actor: { type: "user" | "agent"; id: string };
  idempotencyKey: string;
  policy: Omit<WorkCasePolicyInput, "action">;
  now?: Date;
}

export class WorkRoomCycleStoreError extends Error {
  constructor(
    readonly reason: "room_not_found" | "finite_room" | "active_cycle_exists" | "policy_denied" | "cycle_not_found",
    message: string,
  ) {
    super(message);
    this.name = "WorkRoomCycleStoreError";
  }
}

function actorData(actor: OpenWorkRoomCycleInput["actor"]): Record<string, string> {
  return actor.type === "user"
    ? { senderType: "user", senderUserId: actor.id }
    : { senderType: "agent", senderAgentId: actor.id };
}

function storedBoundary(input: OpenWorkRoomCycleInput) {
  return {
    kind: WORK_ROOM_CYCLE_EVIDENCE_KIND,
    version: 1,
    cycleKey: input.cycleKey,
    trigger: input.trigger,
    objective: input.objective,
    accountablePrincipalRef: input.accountablePrincipalRef,
    expectedReviewAt: input.expectedReviewAt instanceof Date
      ? input.expectedReviewAt.toISOString()
      : input.expectedReviewAt,
    stopConditions: [...input.stopConditions],
    measureSummary: input.measureSummary,
    contextRefs: [...input.contextRefs],
  } as const;
}

function cycleCandidate(
  item: WorkRoomCycleWorkItemRecord,
  packet: WorkRoomOutcomePacket | null = null,
): WorkRoomCycleCarrierCandidate | null {
  const boundary = parseStoredWorkRoomCycle(item.evidence);
  if (!boundary) return null;
  return {
    cycleKey: boundary.cycleKey,
    carrierKind: "work-item",
    carrierId: item.itemId,
    trigger: boundary.trigger,
    objective: boundary.objective,
    accountablePrincipalRef: boundary.accountablePrincipalRef,
    openedAt: item.createdAt,
    expectedReviewAt: boundary.expectedReviewAt,
    stopConditions: boundary.stopConditions,
    measureSummary: boundary.measureSummary,
    contextRefs: boundary.contextRefs,
    status: item.status === "completed" ? "closed" : item.status === "verifying" ? "verifying" : "open",
    outcomePacket: packet,
    sourceRefs: [{ kind: "work-item", id: item.itemId, status: item.status, sourceType: item.sourceType }],
  };
}

function lifecycleReceipt(input: {
  operation: string;
  cycleKey: string;
  carrierId: string;
  idempotencyKey: string;
  enforcementMode: string;
  receiptKind: string;
}) {
  return {
    kind: "work-room-lifecycle-receipt",
    version: 1,
    ...input,
    status: "valid",
    policyRefs: ["work-case-policy-envelope", "work-room-cycle-boundary"],
  };
}

export async function openWorkRoomCycle(input: OpenWorkRoomCycleInput): Promise<{
  cycle: WorkRoomCycleWorkItemRecord;
  messageId: string | null;
  idempotent: boolean;
}> {
  return input.db.withinRoomLock(input.roomWorkItemId, async (tx) => {
    const room = await tx.getRoom(input.roomWorkItemId);
    if (!room) throw new WorkRoomCycleStoreError("room_not_found", "Work Room was not found.");
    const policy = evaluateWorkRoomCyclePolicy({ operation: "open-cycle", cycle: null, policy: input.policy });
    if (!policy.ok) throw new WorkRoomCycleStoreError("policy_denied", policy.message);

    const cycles = await tx.listCycles(room.id);
    const existing = cycles.find((item) => parseStoredWorkRoomCycle(item.evidence)?.cycleKey === input.cycleKey);
    if (existing) return { cycle: existing, messageId: null, idempotent: true };
    const active = cycles.find((item) => !["completed", "cancelled"].includes(item.status) && parseStoredWorkRoomCycle(item.evidence));
    if (active) {
      throw new WorkRoomCycleStoreError("active_cycle_exists", `Cycle '${parseStoredWorkRoomCycle(active.evidence)?.cycleKey}' is already active.`);
    }

    const boundary = storedBoundary(input);
    buildWorkRoomCycle({
      cycleKey: boundary.cycleKey,
      carrierKind: "work-item",
      carrierId: "pending",
      trigger: boundary.trigger,
      objective: boundary.objective,
      accountablePrincipalRef: boundary.accountablePrincipalRef,
      openedAt: input.now ?? new Date(),
      expectedReviewAt: boundary.expectedReviewAt,
      stopConditions: boundary.stopConditions,
      measureSummary: boundary.measureSummary,
      contextRefs: boundary.contextRefs,
      status: "open",
      sourceRefs: [{ kind: "work-item", id: room.itemId, sourceType: room.sourceType }],
    });

    const cycle = await tx.createCycle({
      sourceType: room.sourceType,
      sourceId: room.sourceId ?? room.itemId,
      title: `${room.title} — ${input.cycleKey}`,
      description: input.objective,
      urgency: room.urgency,
      effortClass: room.effortClass,
      workerConstraint: room.workerConstraint,
      teamId: room.teamId,
      queueId: room.queueId,
      status: "in-progress",
      assignedToUserId: room.assignedToUserId,
      assignedToAgentId: room.assignedToAgentId,
      dueAt: new Date(boundary.expectedReviewAt),
      evidence: { workRoomCycle: boundary },
      parentItemId: room.id,
    });
    const receipt = lifecycleReceipt({
      operation: "open-cycle",
      cycleKey: input.cycleKey,
      carrierId: cycle.itemId,
      idempotencyKey: input.idempotencyKey,
      enforcementMode: policy.enforcementMode,
      receiptKind: policy.requiredReceiptKind,
    });
    const message = await tx.appendMessage({
      workItemId: room.id,
      ...actorData(input.actor),
      messageType: "work-room-cycle-opened",
      body: `Opened cycle ${input.cycleKey}.`,
      structuredPayload: receipt,
      channel: "in-app",
    });
    return { cycle, messageId: message.messageId, idempotent: false };
  });
}

export async function completeWorkRoomCycle(input: {
  db: WorkRoomCycleStoreDb;
  roomWorkItemId: string;
  carrierId: string;
  packet: WorkRoomOutcomePacket;
  actor: OpenWorkRoomCycleInput["actor"];
  idempotencyKey: string;
  policy: Omit<WorkCasePolicyInput, "action">;
  now?: Date;
}): Promise<{ messageId: string | null; idempotent: boolean }> {
  return input.db.withinRoomLock(input.roomWorkItemId, async (tx) => {
    const room = await tx.getRoom(input.roomWorkItemId);
    if (!room) throw new WorkRoomCycleStoreError("room_not_found", "Work Room was not found.");
    const cycles = await tx.listCycles(room.id);
    const cycle = cycles.find((item) => item.itemId === input.carrierId);
    if (!cycle) throw new WorkRoomCycleStoreError("cycle_not_found", "Work Room cycle was not found.");
    const boundary = parseStoredWorkRoomCycle(cycle.evidence);
    if (!boundary) throw new WorkRoomCycleStoreError("cycle_not_found", "Work Item is not a Work Room cycle carrier.");
    const messages = await tx.listMessages(room.id);
    const existing = messages.find((message) => {
      const stored = parseStoredWorkRoomOutcome(message.structuredPayload);
      return stored?.cycleKey === boundary.cycleKey && stored.carrierId === cycle.itemId;
    });
    if (existing) return { messageId: existing.messageId, idempotent: true };

    const view = buildWorkRoomCycle(cycleCandidate(cycle)!);
    const policy = evaluateWorkRoomCyclePolicy({ operation: "complete-cycle", cycle: view, policy: input.policy });
    if (!policy.ok) throw new WorkRoomCycleStoreError("policy_denied", policy.message);
    const completedAt = input.now ?? new Date(input.packet.completedAt);
    await tx.completeCycle(cycle.id, completedAt);
    const message = await tx.appendMessage({
      workItemId: room.id,
      ...actorData(input.actor),
      messageType: WORK_ROOM_OUTCOME_MESSAGE_TYPE,
      body: input.packet.summary,
      structuredPayload: {
        kind: WORK_ROOM_OUTCOME_MESSAGE_TYPE,
        version: 1,
        cycleKey: boundary.cycleKey,
        carrierId: cycle.itemId,
        packet: input.packet,
        receipt: lifecycleReceipt({
          operation: "complete-cycle",
          cycleKey: boundary.cycleKey,
          carrierId: cycle.itemId,
          idempotencyKey: input.idempotencyKey,
          enforcementMode: policy.enforcementMode,
          receiptKind: policy.requiredReceiptKind,
        }),
      },
      channel: "in-app",
    });
    return { messageId: message.messageId, idempotent: false };
  });
}
